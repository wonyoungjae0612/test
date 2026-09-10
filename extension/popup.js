const statusText = document.getElementById('status');
const toggle = document.getElementById('toggle');
let tabId;
let enabled = false;
document.getElementById('extension-id').textContent = chrome.runtime.id;

async function refresh() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  if (!tab?.url || !/^https?:/.test(tab.url)) {
    statusText.textContent = '일반 웹페이지에서 확장 프로그램을 열어주세요.';
    toggle.disabled = true; return;
  }
  const state = await chrome.runtime.sendMessage({ type: 'STATUS', tabId });
  enabled = state.enabled;
  statusText.textContent = state.message;
  toggle.disabled = !state.ok && !enabled;
  toggle.textContent = enabled ? '이 탭에서 감지 끄기' : '이 탭에서 감지 켜기';
}

toggle.addEventListener('click', async () => {
  toggle.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: enabled ? 'STOP_TAB' : 'START_TAB', tabId });
    if (!result.ok) { statusText.textContent = result.message; return; }
    await refresh();
  } catch { statusText.textContent = '확장 프로그램을 다시 열어주세요.'; }
  finally { toggle.disabled = false; }
});

document.getElementById('save').addEventListener('click', async () => {
  const input = document.getElementById('token');
  try {
    const result = await chrome.runtime.sendMessage({ type: 'SAVE_TOKEN', token: input.value.trim() });
    input.value = '';
    statusText.textContent = result.message;
    if (result.ok) await refresh();
  } catch { statusText.textContent = '토큰을 저장하지 못했습니다.'; }
});

for (const [id, grant] of [['allow-host', true], ['remove-host', false]]) {
  document.getElementById(id).addEventListener('click', async () => {
    try {
      const url = new URL(document.getElementById('image-host').value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error();
      const origins = [`${url.origin}/*`];
      const accepted = grant ? await chrome.permissions.request({ origins }) : await chrome.permissions.remove({ origins });
      statusText.textContent = accepted ? '권한을 변경했습니다. 감지를 껐다 켜면 다시 확인합니다.' : '권한을 변경하지 않았습니다.';
    } catch { statusText.textContent = '올바른 http 또는 https 호스트 주소를 입력하세요.'; }
  });
}

refresh().catch(() => { statusText.textContent = '연결을 확인하지 못했습니다.'; });
