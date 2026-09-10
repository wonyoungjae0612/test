const API = 'http://127.0.0.1:8765';
const MAX_BYTES = 10 * 1024 * 1024;
const active = new Map();
let inflight = 0;
const initialized = Promise.all([
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
]);

const error = (code, message) => ({ ok: false, code, message });
const allowedType = type => ['image/jpeg', 'image/png', 'image/webp'].includes(type);
const tabKey = id => `tab:${id}`;

async function config(id) {
  const result = await chrome.storage.session.get(tabKey(id));
  return result[tabKey(id)];
}

async function api(path, { token, signal, ...options }) {
  const response = await fetch(`${API}${path}`, {
    ...options, signal, credentials: 'omit', cache: 'no-store', redirect: 'error',
    headers: { ...options.headers, Authorization: `Bearer ${token}` },
  });
  const body = await response.json();
  if (!response.ok) return error(body.detail?.code || 'API_ERROR', body.detail?.message || '로컬 서비스 요청에 실패했습니다.');
  return { ok: true, data: body };
}

async function status() {
  const { token } = await chrome.storage.local.get('token');
  if (!token) return error('TOKEN_REQUIRED', '먼저 연결 토큰을 저장하세요.');
  try {
    const response = await api('/model/info', { token, signal: AbortSignal.timeout(4000) });
    if (!response.ok) return response;
    return { ok: true, ready: response.data.ready, model: response.data.version,
      message: response.data.ready ? '모델 연결됨' : '서버 연결됨 · 모델 미연결' };
  } catch { return error('SERVICE_OFFLINE', '로컬 서버를 실행하고 연결 설정을 확인하세요.'); }
}

async function stop(id) {
  await chrome.storage.session.remove(tabKey(id));
  for (const job of active.values()) if (job.tabId === id) job.controller.abort();
  await chrome.tabs.sendMessage(id, { type: 'STOP' }).catch(() => {});
  await chrome.action.setBadgeText({ tabId: id, text: '' }).catch(() => {});
}

async function start(id) {
  const tab = await chrome.tabs.get(id);
  const origin = new URL(tab.url).origin;
  if (!/^https?:/.test(tab.url)) return error('UNSUPPORTED_PAGE', '일반 웹페이지에서 사용하세요. Chrome 설정 페이지는 지원하지 않습니다.');
  const state = await status();
  if (!state.ok) return state;
  await chrome.storage.session.set({ [tabKey(id)]: { origin, enabled: true } });
  try {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(id, { type: 'START' });
    await chrome.action.setBadgeText({ tabId: id, text: 'ON' });
    await chrome.action.setBadgeBackgroundColor({ tabId: id, color: '#297459' });
    return state;
  } catch {
    await stop(id);
    return error('PAGE_ACCESS_DENIED', '이 페이지에는 접근할 수 없습니다. 일반 웹페이지에서 다시 켜주세요.');
  }
}

async function imageBytes(source, pageOrigin, signal) {
  if (typeof source !== 'string' || source.length > MAX_BYTES * 1.4) throw Error('INVALID_SOURCE');
  const url = new URL(source);
  if (url.protocol === 'data:') {
    if (!/^data:image\/(png|jpeg|webp);base64,/i.test(source)) throw Error('UNSUPPORTED_FORMAT');
  } else {
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Error('UNSUPPORTED_SOURCE');
    if (url.origin !== pageOrigin && !await chrome.permissions.contains({ origins: [`${url.origin}/*`] })) {
      throw Error('IMAGE_PERMISSION_REQUIRED');
    }
  }
  // Never send the local API token or browser cookies to an image server.
  const response = await fetch(source, { signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw Error('IMAGE_FETCH_FAILED');
  const type = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
  if (!allowedType(type)) throw Error('UNSUPPORTED_FORMAT');
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw Error('FILE_TOO_LARGE');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw Error('FILE_TOO_LARGE');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (!size) throw Error('EMPTY_IMAGE');
  return new Blob(chunks, { type });
}

const messages = {
  IMAGE_PERMISSION_REQUIRED: '이미지 출처 접근 권한이 필요합니다. 확장 팝업에서 해당 이미지 호스트를 허용하세요.',
  UNSUPPORTED_FORMAT: 'JPG, PNG, WEBP만 지원합니다.',
  UNSUPPORTED_SOURCE: '이 이미지 주소 형식은 아직 지원하지 않습니다.',
  FILE_TOO_LARGE: '10MB를 초과한 이미지입니다.',
};

async function predict(message, sender) {
  const id = sender.tab?.id;
  const state = await config(id);
  if (!state?.enabled || sender.frameId !== 0 || new URL(sender.url).origin !== state.origin) return error('DISABLED', '감지가 꺼져 있습니다.');
  if (inflight >= 2) return error('BUSY', '다른 이미지를 처리 중입니다.');
  const key = `${id}:${message.requestId}`;
  if (active.has(key)) return error('BUSY', '이미지를 처리 중입니다.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  active.set(key, { tabId: id, controller });
  inflight++;
  try {
    const { token } = await chrome.storage.local.get('token');
    if (!token) return error('TOKEN_REQUIRED', '연결 토큰을 설정하세요.');
    const health = await api('/model/info', { token, signal: controller.signal });
    if (!health.ok) return health;
    if (!health.data.ready) return error('MODEL_NOT_READY', '학습 모델 미연결 · 분석하지 않았습니다.');
    const blob = await imageBytes(message.source, state.origin, controller.signal);
    if (!(await config(id))?.enabled || controller.signal.aborted) return error('DISABLED', '감지가 꺼졌습니다.');
    const result = await api('/predict', { token, signal: controller.signal, method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
    if (result.ok && (!['AI', 'REAL', 'UNKNOWN'].includes(result.data.label) || !Number.isFinite(result.data.ai_probability) || result.data.ai_probability < 0 || result.data.ai_probability > 1)) {
      return error('INVALID_RESULT', '서버 응답 형식이 올바르지 않습니다.');
    }
    return result;
  } catch (failure) {
    return error(failure.message in messages ? failure.message : 'REQUEST_FAILED', messages[failure.message] || '연결 실패 또는 시간 초과 · 분석하지 않았습니다.');
  } finally { clearTimeout(timeout); active.delete(key); inflight--; }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  (async () => {
    await initialized;
    const popup = sender.url === chrome.runtime.getURL('popup.html');
    if (message.type === 'PREDICT' && sender.tab) return predict(message, sender);
    if (!popup) return error('FORBIDDEN', '허용되지 않은 요청입니다.');
    if (message.type === 'STATUS') return { ...await status(), enabled: Boolean((await config(message.tabId))?.enabled) };
    if (message.type === 'SAVE_TOKEN') {
      if (typeof message.token !== 'string' || message.token.length < 32 || message.token.length > 256) return error('INVALID_TOKEN', '32자 이상의 연결 토큰을 입력하세요.');
      await chrome.storage.local.set({ token: message.token });
      return status();
    }
    if (message.type === 'START_TAB') return start(message.tabId);
    if (message.type === 'STOP_TAB') { await stop(message.tabId); return { ok: true }; }
    return error('UNKNOWN_MESSAGE', '알 수 없는 요청입니다.');
  })().then(respond).catch(() => respond(error('INTERNAL_ERROR', '요청을 처리하지 못했습니다.')));
  return true;
});

chrome.tabs.onRemoved.addListener(id => { stop(id); });
chrome.tabs.onUpdated.addListener((id, change, tab) => {
  (async () => {
    const state = await config(id);
    if (!state?.enabled) return;
    if (tab.url && new URL(tab.url).origin !== state.origin) { await stop(id); return; }
    if (change.status === 'complete') {
      try {
        await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] });
        await chrome.tabs.sendMessage(id, { type: 'START' });
      } catch { await stop(id); }
    }
  })().catch(() => {});
});
