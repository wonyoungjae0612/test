(() => {
  if (globalThis.__aiGuardLoaded) return;
  globalThis.__aiGuardLoaded = true;
  let enabled = false;
  let generation = 0;
  let queue = [];
  let processing = false;
  let scheduled = 0;
  let host, shadow, mutation, intersection, resize;
  const items = new Map();
  const MAX_IMAGES = 120;
  const LABELS = { AI: 'AI 생성 의심', REAL: '실제 이미지 추정', UNKNOWN: '판별 불확실' };

  function sourceOf(img) { return img.currentSrc || img.src; }
  function eligible(img) { return img.complete && img.naturalWidth >= 80 && img.naturalHeight >= 80 && sourceOf(img); }

  function position() {
    scheduled = 0;
    for (const [img, item] of items) {
      const rect = img.getBoundingClientRect();
      const visible = img.isConnected && eligible(img) && rect.width >= 50 && rect.height >= 50 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
      item.badge.hidden = !visible;
      if (visible) {
        item.badge.style.left = `${Math.max(4, Math.min(rect.right - item.badge.offsetWidth - 6, innerWidth - item.badge.offsetWidth - 4))}px`;
        item.badge.style.top = `${Math.max(4, rect.top + 6)}px`;
      }
    }
  }
  function schedule() { if (!scheduled) scheduled = requestAnimationFrame(position); }

  function enqueue(img) {
    const item = items.get(img);
    if (!enabled || !item) return;
    const source = sourceOf(img);
    if (!eligible(img)) {
      item.source = null;
      item.badge.hidden = true;
      item.badge.dataset.label = '';
      return;
    }
    if (item.source === source) return;
    item.source = source;
    item.attempts = 0;
    item.badge.textContent = 'AI-Guard · 대기';
    item.badge.dataset.label = '';
    queue = queue.filter(job => job.img !== img);
    queue.push({ img, source, generation });
    run();
  }

  async function run() {
    if (processing) return;
    processing = true;
    try {
      while (enabled && queue.length) {
        const job = queue.shift();
        const item = items.get(job.img);
        if (!item || !job.img.isConnected || job.generation !== generation || item.source !== job.source) continue;
        item.badge.textContent = 'AI-Guard · 확인 중';
        schedule();
        let result;
        try { result = await chrome.runtime.sendMessage({ type: 'PREDICT', source: job.source, requestId: crypto.randomUUID() }); }
        catch { result = { ok: false, code: 'OFFLINE', message: '확장 프로그램 연결이 끊어졌습니다.' }; }
        if (!enabled || job.generation !== generation || items.get(job.img) !== item || item.source !== job.source) continue;
        if (!result?.ok && result?.code === 'BUSY' && item.attempts++ < 2) {
          await new Promise(resolve => setTimeout(resolve, 1200));
          queue.push(job);
          continue;
        }
        if (result?.ok) {
          const { label, ai_probability, model_version, latency_ms } = result.data;
          item.badge.dataset.label = label;
          item.badge.textContent = `${label} · ${Math.round(ai_probability * 100)}%`;
          item.badge.title = `${LABELS[label]}\nAI 생성 가능성: ${(ai_probability * 100).toFixed(1)}%\n모델: ${model_version ?? '미제공'}\n처리 시간: ${latency_ms ?? '미제공'}ms\n이미지 내용의 사실 여부를 판정하지 않습니다.`;
        } else {
          item.badge.dataset.label = 'ERROR';
          item.badge.textContent = result?.code === 'MODEL_NOT_READY' ? 'AI-Guard · 모델 미연결' : 'AI-Guard · 분석 불가';
          item.badge.title = result?.message || '분석 결과가 없습니다.';
        }
        item.badge.setAttribute('aria-label', item.badge.title);
        schedule();
      }
    } finally { processing = false; }
  }

  function scan() {
    if (!enabled) return;
    for (const [img, item] of items) {
      if (!img.isConnected) { intersection.unobserve(img); resize.unobserve(img); item.badge.remove(); items.delete(img); }
    }
    queue = queue.filter(job => items.has(job.img));
    for (const img of document.images) {
      if (!items.has(img) && items.size < MAX_IMAGES && (!img.complete || eligible(img))) {
        const badge = document.createElement('button');
        badge.type = 'button';
        badge.hidden = true;
        badge.textContent = 'AI-Guard · 대기';
        badge.title = '화면에 표시되는 이미지를 확인합니다.';
        badge.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          // Native tooltip is accessible by hover; click also exposes details inline.
          const previous = shadow.querySelector('.details');
          if (previous) previous.remove();
          const detail = document.createElement('div');
          detail.className = 'details';
          detail.setAttribute('role', 'status');
          detail.textContent = badge.title;
          const close = document.createElement('button');
          close.className = 'close'; close.textContent = '닫기'; close.addEventListener('click', () => detail.remove());
          detail.append(close); shadow.append(detail);
        });
        shadow.append(badge);
        items.set(img, { badge, source: null, visible: false, attempts: 0 });
        intersection.observe(img); resize.observe(img);
      }
      const item = items.get(img);
      if (item?.visible) enqueue(img);
    }
    schedule();
  }

  function stop() {
    enabled = false; generation++; queue = [];
    mutation?.disconnect(); intersection?.disconnect(); resize?.disconnect();
    cancelAnimationFrame(scheduled); scheduled = 0;
    removeEventListener('scroll', schedule, true); removeEventListener('resize', schedule);
    document.removeEventListener('load', scan, true);
    document.removeEventListener('error', scan, true);
    host?.remove(); items.clear();
  }

  function start() {
    if (enabled) return;
    enabled = true; generation++;
    host = document.createElement('div');
    host.dataset.aiGuard = 'overlay';
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646';
    shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ':host{all:initial}button{position:fixed;pointer-events:auto;max-width:240px;border:1px solid #526558;border-radius:7px;padding:7px 9px;color:#fff;background:#284537;font:11px/1.4 system-ui;box-shadow:0 2px 8px #0003;cursor:pointer}button[hidden]{display:none}button[data-label="AI"]{background:#7d382a}button[data-label="REAL"]{background:#245c46}button[data-label="UNKNOWN"]{background:#685125}button[data-label="ERROR"]{background:#4c5650}.details{position:fixed;pointer-events:auto;bottom:20px;right:20px;max-width:min(320px,80vw);padding:18px;color:#eaf0e6;background:#203b2f;border:1px solid #59735b;border-radius:12px;font:13px/1.8 system-ui;white-space:pre-line;box-shadow:0 5px 30px #0004}.close{position:static;display:block;margin-top:12px}';
    shadow.append(style); document.documentElement.append(host);
    intersection = new IntersectionObserver(entries => {
      for (const entry of entries) { const item = items.get(entry.target); if (item) { item.visible = entry.isIntersecting; if (item.visible) enqueue(entry.target); } }
      schedule();
    });
    resize = new ResizeObserver(schedule);
    let scanPending = false;
    mutation = new MutationObserver(() => { if (!scanPending) { scanPending = true; queueMicrotask(() => { scanPending = false; scan(); }); } });
    mutation.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'sizes'] });
    addEventListener('scroll', schedule, true); addEventListener('resize', schedule);
    document.addEventListener('load', scan, true);
    document.addEventListener('error', scan, true);
    scan();
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message.type === 'START') start();
    if (message.type === 'STOP') stop();
  });
  addEventListener('pagehide', stop);
})();
