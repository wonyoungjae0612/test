import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const token = 'extension-test-token-not-for-production-12345';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAHgAAABkCAIAAADCEmNlAAAA9UlEQVR4nO3SMQ0AIADEQMAiG0qQjwo63Rn4pPm57xn8t4INhO54dEToiNARoSNCR4SOCB0ROiJ0ROiI0BGhI0JHhI4IHRE6InRE6IjQEaEjQkeEjggdEToidEToiNARoSNCR4SOCB0ROiJ0ROiI0BGhI0JHhI4IHRE6InRE6IjQEaEjQkeEjggdEToidEToiNARoSNCR4SOCB0ROiJ0ROiI0BGhI0JHhI4IHRE6InRE6IjQEaEjQkeEjggdEToidEToiNARoSNCR4SOCB0ROiJ0ROiI0BGhI0JHhI4IHRE6InRE6IjQEaEjQkeEjggdEToi9Gg8Eo4B7a0rivoAAAAASUVORK5CYII=', 'base64');
let remoteTokenSeen = false;
const web = createServer((req, res) => {
  if (req.headers.authorization) remoteTokenSeen = true;
  if (req.url.startsWith('/image')) { res.writeHead(200, {'Content-Type':'image/png'}); res.end(png); return; }
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
  res.end('<!doctype html><title>AI-Guard extension fixture</title><h1>Test images</h1><img id="one" src="/image.png" width="240" height="200"><div style="height:1500px"></div><img id="below" src="/image-2.png" width="240" height="200">');
});
await new Promise((done, reject) => { web.once('error', reject); web.listen(8890, '127.0.0.1', done); });
let context, apiProcess;
let apiLogs = '';
const report = message => console.log(`PASS ${message}`);
try {
  // Refuse to replace or stop a user's already-running service.
  let occupied = false;
  try { await fetch('http://127.0.0.1:8765/health', {signal:AbortSignal.timeout(700)}); occupied = true; } catch {}
  if (occupied) throw Error('Port 8765 is occupied. Stop the local service before running this test.');
  const profile = await mkdtemp(join(tmpdir(), 'ai-guard-extension-test-'));
  const extensionPath = resolve('extension');
  context = await chromium.launchPersistentContext(profile, {channel:'chromium', headless:true,
    args:[`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]});
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const python = process.env.PYTHON_PATH || (process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  apiProcess = spawn(python, ['-m','uvicorn','backend_tests.extension_server:create_test_app','--factory','--host','127.0.0.1','--port','8765','--no-access-log'], {
    windowsHide:true, env:{...process.env, AI_GUARD_TOKEN:token, AI_GUARD_ALLOWED_ORIGINS:`chrome-extension://${id}`}, stdio:['ignore','pipe','pipe'],
  });
  apiProcess.on('error', failure => { apiLogs += failure.message; });
  apiProcess.stderr.on('data', data => { apiLogs += data; });
  await expect.poll(async () => {
    try { return (await fetch('http://127.0.0.1:8765/health')).status; } catch { return 0; }
  }, {timeout:15000}).toBe(200);
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:8890/');
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  const tabId = await popup.evaluate(async () => (await chrome.tabs.query({url:'http://127.0.0.1:8890/*'}))[0].id);
  const message = data => popup.evaluate(data => chrome.runtime.sendMessage(data), data);
  const saved = await message({type:'SAVE_TOKEN',token});
  assert.equal(saved.ready, false, JSON.stringify(saved));
  report('extension authenticates to actual FastAPI and reports model disconnected');
  assert.equal((await message({type:'START_TAB',tabId})).ok, true);
  await page.bringToFront();
  await expect(page.locator('[data-ai-guard] button').filter({hasText:'모델 미연결'})).toHaveCount(1);
  assert.equal(await page.evaluate(() => chrome.runtime), undefined);
  report('visible image receives honest model-missing badge; offscreen image not analyzed');
  assert.equal((await message({type:'STOP_TAB',tabId})).ok, true);
  await expect(page.locator('[data-ai-guard]')).toHaveCount(0);
  report('OFF removes badges and stops observers');

  async function mode(value) {
    await fetch(`http://127.0.0.1:8765/_test/model/${value}`, {method:'POST',headers:{Authorization:`Bearer ${token}`}});
  }
  for (const [probability, label] of [['0.91','AI'],['0.1','REAL'],['0.72','UNKNOWN']]) {
    await mode(probability);
    await message({type:'START_TAB',tabId});
    await expect(page.locator(`[data-ai-guard] button[data-label="${label}"]`)).toHaveCount(1);
    if (label === 'AI') {
      await page.evaluate(() => { const img=document.createElement('img'); img.src='/image-copy.png'; img.width=240; img.height=200; document.body.prepend(img); });
      await expect(page.locator('[data-ai-guard] button[data-label="AI"]')).toHaveCount(2);
      const calls = await (await fetch('http://127.0.0.1:8765/_test/calls',{headers:{Authorization:`Bearer ${token}`}})).json();
      assert.equal(calls.calls,1);
      report('dynamic image is detected and equal image bytes reuse server inference cache');
      await page.evaluate(() => document.body.firstElementChild.remove());
      await expect(page.locator('[data-ai-guard] button[data-label="AI"]')).toHaveCount(1);
      await page.locator('#one').evaluate(img => { img.src = '/broken.png'; });
      await expect(page.locator('[data-ai-guard] button[data-label="AI"]')).toHaveCount(0);
      await page.locator('#one').evaluate(img => { img.src = '/image.png'; });
      await expect(page.locator('[data-ai-guard] button[data-label="AI"]')).toHaveCount(1);
      report('broken or replaced images never retain stale classification badges');
    }
    report(`test-only model fixture renders ${label} without altering production model adapter`);
    await message({type:'STOP_TAB',tabId});
  }
  assert.equal(remoteTokenSeen,false);
  report('image origin never receives local API token');
  await mode('0.91');
  await message({type:'START_TAB',tabId});
  await page.goto('http://localhost:8890/');
  await expect.poll(async () => (await message({type:'STATUS',tabId})).enabled).toBe(false);
  report('navigation to a different origin disables detection');
  console.log('ALL EXTENSION CHECKS PASSED');
} catch (failure) {
  console.error(apiLogs);
  throw failure;
} finally {
  await context?.close();
  if (apiProcess && apiProcess.exitCode === null) {
    await new Promise(resolve => { apiProcess.once('exit',resolve); apiProcess.kill(); });
  }
  await new Promise(resolve => web.close(resolve));
}
