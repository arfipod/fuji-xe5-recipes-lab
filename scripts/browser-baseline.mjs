import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const targetUrl = process.argv[2] || 'http://127.0.0.1:4173/?baseline=source';
const chromeBinary = process.env.CHROME_BIN || 'google-chrome';
const profile = await mkdtemp(join(tmpdir(), 'xe5-browser-baseline-'));
const chromeErrors = [];
let chrome;
let socket;

try {
  chrome = spawn(chromeBinary, [
    '--headless=new',
    '--disable-gpu',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-sync',
    '--metrics-recording-only',
    '--no-first-run',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--window-size=1440,900',
    targetUrl,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.setEncoding('utf8');
  chrome.stderr.on('data', (chunk) => chromeErrors.push(chunk));

  const [portText, browserPath] = (await waitForDevTools(profile)).trim().split('\n');
  socket = new WebSocket(`ws://127.0.0.1:${portText}${browserPath}`);
  await once(socket, 'open');
  const cdp = createCdp(socket);
  const { targetInfos } = await cdp.send('Target.getTargets');
  const page = targetInfos.find((item) => item.type === 'page');
  if (!page) throw new Error('Chrome did not expose a page target.');
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  const errors = [];
  const failedRequests = [];
  cdp.on('Runtime.exceptionThrown', (params) => errors.push(params.exceptionDetails?.text || 'Runtime exception'), sessionId);
  cdp.on('Runtime.consoleAPICalled', (params) => {
    if (params.type === 'error' || params.type === 'assert') errors.push(params.args?.map((arg) => arg.value ?? arg.description).join(' ') || params.type);
  }, sessionId);
  cdp.on('Log.entryAdded', (params) => {
    if (params.entry?.level === 'error') errors.push(params.entry.text);
  }, sessionId);
  cdp.on('Network.loadingFailed', (params) => failedRequests.push({ errorText: params.errorText, type: params.type }));
  await Promise.all([
    cdp.send('Runtime.enable', {}, sessionId),
    cdp.send('Page.enable', {}, sessionId),
    cdp.send('Log.enable', {}, sessionId),
    cdp.send('Network.enable', {}, sessionId),
  ]);
  await waitFor(async () => (await evaluate(cdp, sessionId, 'document.readyState')).value === 'complete');
  await waitFor(async () => (await evaluate(cdp, sessionId, 'Boolean(document.querySelector("[data-action=connect-mock]"))')).value === true);

  const initial = await inspectPage(cdp, sessionId);
  await evaluate(cdp, sessionId, 'document.querySelector("[data-action=connect-mock]").click()');
  await waitFor(async () => (await evaluate(cdp, sessionId, 'document.querySelectorAll(".slot-card").length')).value === 10);

  const headings = {};
  for (const tab of ['camera', 'import', 'library', 'backups', 'preview', 'system']) {
    await evaluate(cdp, sessionId, `document.querySelector('[data-action="tab"][data-tab="${tab}"]').click()`);
    headings[tab] = (await evaluate(cdp, sessionId, 'document.querySelector("h1")?.textContent?.trim()')).value;
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  }, sessionId);
  await evaluate(cdp, sessionId, 'document.querySelector(\'[data-action="tab"][data-tab="camera"]\').click()');
  const mobile = await inspectPage(cdp, sessionId);
  const { product } = await cdp.send('Browser.getVersion');

  const result = {
    browser: product,
    initial,
    mock: {
      slotCount: (await evaluate(cdp, sessionId, 'document.querySelectorAll(".slot-card").length')).value,
      headings,
    },
    mobile,
    consoleErrors: [...new Set(errors)],
    failedRequests,
    chromeWarnings: chromeErrors.join('').split('\n').filter((line) => /ERROR|WARNING/i.test(line)),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (
    initial.footer !== 'Made with 💙 by arrf'
    || !initial.sourceRevision
    || initial.horizontalOverflow
    || mobile.horizontalOverflow
    || result.mock.slotCount !== 10
    || Object.values(headings).some((heading) => !heading)
    || result.consoleErrors.length
    || result.failedRequests.length
  ) process.exitCode = 1;
} finally {
  try { socket?.close(); } catch { /* Already closed. */ }
  try {
    chrome?.kill('SIGTERM');
    if (chrome) await Promise.race([childExit(chrome), delay(2000)]);
  } catch { /* Already closed. */ }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function createCdp(webSocket) {
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  webSocket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result ?? {});
      return;
    }
    for (const listener of listeners) {
      if (listener.method === message.method && (!listener.sessionId || listener.sessionId === message.sessionId)) listener.callback(message.params ?? {});
    }
  });
  return {
    send(method, params = {}, sessionId = undefined) {
      const id = nextId++;
      webSocket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    on(method, callback, sessionId = undefined) { listeners.push({ method, callback, sessionId }); },
  };
}

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || `Evaluation failed: ${expression}`);
  return result.result ?? {};
}

async function inspectPage(cdp, sessionId) {
  return (await evaluate(cdp, sessionId, `({
    title: document.title,
    language: document.documentElement.lang,
    heading: document.querySelector('h1')?.textContent?.trim() ?? null,
    footer: document.querySelector('.global-footer')?.textContent?.trim() ?? null,
    sourceRevision: document.querySelector('.camera-dock .panel-code')?.getAttribute('title') ?? null,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    viewportWidth: document.documentElement.clientWidth,
  })`)).value;
}

async function waitForDevTools(directory) {
  const path = join(directory, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { return await readFile(path, 'utf8'); } catch { await delay(50); }
  }
  throw new Error(`Chrome did not create ${path}.`);
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await predicate()) return;
    await delay(25);
  }
  throw new Error('Browser baseline timed out.');
}

function once(target, type) {
  return new Promise((resolve, reject) => {
    target.addEventListener(type, resolve, { once: true });
    target.addEventListener('error', reject, { once: true });
  });
}

function childExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once('exit', resolve));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
