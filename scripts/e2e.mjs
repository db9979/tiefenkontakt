#!/usr/bin/env node
/**
 * End-to-end browser test: headless Chrome driven over the DevTools protocol (no extra
 * dependencies). Starts its own game server and Vite dev server on free ports, then plays
 * through the real UI with two tabs:
 *   guest login → create a match → second guest joins the same team → start against the AI →
 *   snapshots arrive → switch stations → give helm orders → sandbox truth view refused in a
 *   normal match → voice radio between the tabs (fake microphones, push-to-talk) → leave → sign out.
 * Usage: npm run e2e            (CHROME_PATH=/path/to/chrome to pick the browser, E2E_KEEP=1 keeps logs)
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = mkdtempSync(join(tmpdir(), 'tk-e2e-'));
const procs = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let step = 'start';
const log = (...a) => console.log(`[e2e ${((performance.now() - T0) / 1000).toFixed(1).padStart(5)}s]`, ...a);
const T0 = performance.now();

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
    : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  for (const c of candidates) {
    if (c.startsWith('/')) {
      if (existsSync(c)) return c;
      continue;
    }
    try {
      return execFileSync('which', [c]).toString().trim();
    } catch {
      /* next */
    }
  }
  throw new Error('Chrome not found: set CHROME_PATH');
}

function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.unref();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

function run(name, cmd, args, opts) {
  const out = join(TMP, `${name}.log`);
  const p = spawn(cmd, args, { ...opts, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks = [];
  p.stdout.on('data', (d) => chunks.push(d));
  p.stderr.on('data', (d) => chunks.push(d));
  p.on('exit', () => writeFileSync(out, Buffer.concat(chunks)));
  procs.push({ name, p, chunks });
  return p;
}

function cleanup() {
  for (const { p } of procs) {
    try {
      process.kill(-p.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

async function waitFor(what, fn, timeoutMs = 30_000, everyMs = 250) {
  const until = Date.now() + timeoutMs;
  let last;
  while (Date.now() < until) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await sleep(everyMs);
  }
  throw new Error(`timeout waiting for ${what}${last ? `: ${last.message}` : ''}`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
  log('ok ·', msg);
}

/** One browser tab with a tiny DevTools client. */
async function openTab(cdpPort, url) {
  const t = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURI(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const wait = new Map();
  const errors = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wait.has(m.id)) {
      wait.get(m.id)(m);
      wait.delete(m.id);
    } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
  };
  const cmd = (method, params = {}) => new Promise((r) => {
    const i = ++id;
    wait.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = async (expr) => {
    const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(`${expr.slice(0, 80)} → ${JSON.stringify(r.result.exceptionDetails).slice(0, 300)}`);
    return r.result?.result?.value;
  };
  await cmd('Runtime.enable');
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cmd('Emulation.setFocusEmulationEnabled', { enabled: true });
  /** Real mouse click in the middle of the first visible element matching the selector. */
  const click = async (sel, hold = 0) => {
    const box = await waitFor(`visible ${sel}`, () => ev(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.getClientRects().length && !e.disabled);
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      // Only click what is really on top (no overlay in the way)
      const top = document.elementFromPoint(x, y);
      return top && (el === top || el.contains(top)) ? { x, y } : null;
    })()`), 15_000);
    const base = { x: box.x, y: box.y, button: 'left', clickCount: 1 };
    await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
    if (hold) await sleep(hold);
    await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
  };
  const type = async (sel, text) => {
    await click(sel);
    await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.value = ''; return true; })()`);
    await cmd('Input.insertText', { text });
  };
  return { ev, cmd, click, type, errors, close: () => ws.close() };
}

/** Hook the page's own modules (same instances as the app in Vite dev) to observe traffic. */
const HOOK = `(async () => {
  if (window.__tk) return true;
  const net = (await import('/src/net.ts')).net;
  const store = (await import('/src/store.ts')).store;
  const voice = (await import('/src/voice/voice.ts')).voice;
  window.__tk = { net, store, voice, snaps: 0, msgs: [] };
  net.on((m) => {
    if (m.t === 'snap') __tk.snaps++;
    else if (m.t !== 'voice') __tk.msgs.push(m);
  });
  return true;
})()`;

async function main() {
  const [srvPort, vitePort, cdpPort] = [await freePort(), await freePort(), await freePort()];
  const BASE = `http://localhost:${vitePort}/`;
  log('ports', { server: srvPort, vite: vitePort, chrome: cdpPort }, 'tmp', TMP);

  step = 'servers';
  const env = { ...process.env, PORT: String(srvPort), DB_PATH: join(TMP, 'e2e.db'), MATCH_DIR: join(TMP, 'matches'), COOKIE_SECURE: '0', NODE_ENV: 'development' };
  const tsx = join(ROOT, 'node_modules', '.bin', 'tsx');
  const vite = join(ROOT, 'node_modules', '.bin', 'vite');
  run('server', existsSync(tsx) ? tsx : 'npx', existsSync(tsx) ? ['src/index.ts'] : ['tsx', 'src/index.ts'], { cwd: join(ROOT, 'apps/server'), env });
  run('vite', existsSync(vite) ? vite : 'npx', [...(existsSync(vite) ? [] : ['vite']), '--port', String(vitePort), '--strictPort', '--host', 'localhost'], {
    cwd: join(ROOT, 'apps/client'), env: { ...process.env, VITE_PORT: String(vitePort), API_PORT: String(srvPort) },
  });
  await waitFor('game server', async () => (await fetch(`http://127.0.0.1:${srvPort}/api/health`)).ok, 60_000, 500);
  await waitFor('vite', async () => (await fetch(BASE)).ok, 60_000, 500);
  // Warm up Vite's dependency optimizer so the first page load does not reload mid-test
  await fetch(`${BASE}src/main.ts`).catch(() => undefined);
  log('servers up');

  step = 'chrome';
  const chrome = chromePath();
  const args = [
    '--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${join(TMP, 'profile')}`,
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--no-first-run', '--no-default-browser-check',
    '--window-size=1440,900', 'about:blank',
  ];
  if (process.platform === 'linux') args.push('--no-sandbox', '--disable-dev-shm-usage');
  run('chrome', chrome, args, {});
  await waitFor('chrome devtools', async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok, 30_000, 300);

  step = 'guest login';
  const A = await openTab(cdpPort, BASE);
  const B = await openTab(cdpPort, BASE);
  const login = async (tab, name) => {
    await waitFor('page ready', () => tab.ev(`document.readyState === 'complete' && !!document.querySelector('[data-mode="guest"]')`), 60_000);
    await tab.ev(HOOK);
    await tab.click('[data-mode="guest"]');
    await tab.type('#cs', name);
    await tab.click('#go');
    await waitFor(`${name} in the lobby`, () => tab.ev(`!!document.querySelector('#create')`));
    return tab.ev(`__tk.store.playerId`);
  };
  const idA = await login(A, 'Alfa');
  const idB = await login(B, 'Bravo');
  assert(idA && idB && idA !== idB, `two guests signed in (${idA}, ${idB})`);

  step = 'create match';
  await A.type('#mname', 'E2E-Test');
  await A.click('#create');
  const matchId = await waitFor('match lobby', () => A.ev(`__tk.msgs.filter((m) => m.t === 'match').pop()?.match.id`));
  assert(await A.ev(`!!document.querySelector('#ready')`), `match ${matchId} created, lobby shown`);
  await B.click(`[data-join="${matchId}"][data-team="west"]`);
  await waitFor('B in the match', () => B.ev(`!!document.querySelector('#ready')`));
  const slots = await A.ev(`(() => { const m = __tk.msgs.filter((x) => x.t === 'match').pop().match; return m.slots.map((s) => s.team + ':' + s.callsign); })()`);
  assert(slots.length === 2 && slots.every((s) => s.startsWith('west:')), `both on the Westbund (${slots.join(', ')})`);

  step = 'start vs AI';
  await A.click('#ready');
  await B.click('#ready');
  await waitFor('game screen A', () => A.ev(`document.querySelectorAll('#tabs button').length >= 4`), 30_000);
  await waitFor('game screen B', () => B.ev(`document.querySelectorAll('#tabs button').length >= 4`), 30_000);
  // The mission briefing opens over the stations once per match
  for (const T of [A, B]) {
    await T.click('#brief-go');
    await waitFor('briefing closed', () => T.ev(`!document.querySelector('.overlay.briefing')`), 5000);
  }
  const s0 = await A.ev('__tk.snaps');
  await sleep(1500);
  const s1 = await A.ev('__tk.snaps');
  assert(s1 - s0 >= 8, `snapshots stream (${s1 - s0} in 1.5 s)`);
  const own = await A.ev(`(() => { const s = __tk.store.snap; return { cls: s.own.cls, team: s.own.team, alive: s.own.alive, t: s.time }; })()`);
  assert(own.team === 'west' && own.alive, `own ship ${own.cls} afloat at t=${own.t}`);
  const bots = await A.ev(`__tk.msgs.filter((m) => m.t === 'match').pop().match.slots.filter((s) => s.bot).length`);
  assert(bots >= 1, `${bots} AI captains on the other side`);

  step = 'switch stations';
  const tabCount = await A.ev(`document.querySelectorAll('#tabs button').length`);
  for (let i = 1; i < tabCount; i++) {
    await A.click(`#tabs button[data-i="${i}"]`);
    await waitFor(`station ${i}`, () => A.ev(`document.querySelector('#tabs button.on')?.dataset.i === '${i}' && document.querySelector('#station').children.length > 0`), 10_000);
  }
  await A.click('#tabs button[data-i="0"]');
  assert(true, `all ${tabCount} stations opened`);

  step = 'orders';
  await A.click('#h-steps button[data-s="3"]');
  await waitFor('speed order applied', () => A.ev(`__tk.store.snap.own.order.speedKn === 12`), 10_000);
  // Course: click the compass east of its centre (090)
  const c = await A.ev(`(() => { const r = document.querySelector('#h-compass').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) await A.cmd('Input.dispatchMouseEvent', { type, x: c.x + c.w * 0.35, y: c.y, button: 'left', clickCount: 1 });
  await waitFor('course order applied', () => A.ev(`Math.abs(__tk.store.snap.own.order.heading - 90) < 10`), 10_000);
  assert(true, 'helm orders (speed 12 kn, course 090) reached the server');
  await A.ev(`__tk.msgs.length = 0; __tk.net.send({ t: 'sandbox', op: 'truth', on: true }); true`);
  await waitFor('sandbox refusal', () => A.ev(`__tk.msgs.some((m) => m.t === 'error' && /Sandkasten/.test(m.msg))`), 5000);
  await sleep(1200);
  assert(await A.ev(`!__tk.msgs.some((m) => m.t === 'sandbox')`), 'truth view refused in a normal match');

  step = 'reload mid-match';
  // Lost link / page reload: the same ship comes back with its orders, snapshots stream again
  const before = await B.ev(`(() => { const s = __tk.store.snap; return { id: s.own.id, name: s.own.name, kn: s.own.order.speedKn }; })()`);
  await B.ev(`__tk.net.send({ t: 'order', speedKn: 7 }); true`);
  await waitFor('order before reload', () => B.ev(`__tk.store.snap.own.order.speedKn === 7`), 10_000);
  await B.cmd('Page.reload', { ignoreCache: false });
  await sleep(500);
  await waitFor('page back', () => B.ev(`document.readyState === 'complete'`).catch(() => false), 30_000);
  await waitFor('hook after reload', () => B.ev(HOOK).catch(() => false), 30_000);
  await waitFor('game screen after reload', () => B.ev(`document.querySelectorAll('#tabs button').length >= 4`), 30_000);
  if (await B.ev(`!!document.querySelector('#brief-go')`)) await B.click('#brief-go');
  await waitFor('snapshots after reload', () => B.ev(`__tk.snaps >= 10`), 15_000);
  const after = await B.ev(`(() => { const s = __tk.store.snap; return { id: s.own.id, name: s.own.name, kn: s.own.order.speedKn, alive: s.own.alive }; })()`);
  assert(after.id === before.id && after.name === before.name && after.kn === 7 && after.alive, `reload: same ship ${after.name} back with its orders (7 kn)`);

  step = 'voice radio';
  for (const T of [A, B]) {
    await T.click('[data-st="radio"]');
    await T.click('#vo-on');
  }
  await waitFor('voice joined', async () => (await A.ev('__tk.voice.joined')) && (await B.ev('__tk.voice.joined')), 20_000);
  const linkUp = (T) => T.ev(`[...__tk.voice.peers.values()].some((p) => p.pc?.connectionState === 'connected')`);
  await waitFor('peer connection', async () => (await linkUp(A)) && (await linkUp(B)), 20_000);
  const rx = () => B.ev(`(async () => { let n = 0; for (const p of __tk.voice.peers.values()) { const s = await p.pc?.getStats(); s?.forEach((r) => { if (r.type === 'inbound-rtp' && r.kind === 'audio') n += r.bytesReceived; }); } return n; })()`);
  const r0 = await rx();
  await A.click('#vo-ptt', 2500);
  const r1 = await rx();
  assert(r1 - r0 > 2000, `audio flowed A → B on push-to-talk (${r1 - r0} bytes)`);
  await sleep(1500);
  const r2 = await rx();
  await sleep(1500);
  const r3 = await rx();
  assert(r3 - r2 < (r1 - r0) / 2, `quiet after release (${r3 - r2} bytes)`);

  step = 'leave and sign out';
  await A.click('#quit');
  await A.click('#quit');
  await waitFor('back in the lobby', () => A.ev(`!!document.querySelector('#logout')`), 15_000);
  await A.click('#logout');
  await waitFor('sign-in screen', () => A.ev(`!!document.querySelector('[data-mode="guest"]') && !sessionStorage.getItem('tk_guest')`), 20_000);
  assert(true, 'signed out, back at the sign-in screen');
  const errs = [...A.errors, ...B.errors].filter((e) => !/AbortError|NotAllowedError|ResizeObserver/.test(e ?? ''));
  assert(errs.length === 0, `no uncaught page errors${errs.length ? `: ${errs.join(' | ')}` : ''}`);
  A.close();
  B.close();
}

const guard = setTimeout(() => {
  console.error(`[e2e] overall timeout in step "${step}"`);
  cleanup();
  process.exit(1);
}, Number(process.env.E2E_TIMEOUT_MS ?? 180_000));

try {
  await main();
  log('PASSED');
  clearTimeout(guard);
  cleanup();
  // Chrome may still be flushing its profile right after it was killed: retry, never fail a passed run on cleanup
  if (!process.env.E2E_KEEP) {
    try {
      rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch (e) {
      console.warn(`[e2e] could not remove ${TMP}: ${e.message}`);
    }
  }
  process.exit(0);
} catch (e) {
  console.error(`[e2e] FAILED in step "${step}":`, e.message);
  for (const { name, chunks } of procs) {
    if (name === 'chrome') continue;
    const text = Buffer.concat(chunks).toString().split('\n').slice(-25).join('\n');
    console.error(`--- ${name} (last lines) ---\n${text}`);
  }
  clearTimeout(guard);
  cleanup();
  process.exit(1);
}
