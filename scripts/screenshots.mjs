#!/usr/bin/env node
/**
 * Screenshots for the README: headless Chrome over the DevTools protocol (like scripts/e2e.mjs),
 * own game server and Vite on free ports, a fresh database. Plays real scenes and saves JPEGs
 * to docs/screenshots/:
 *   lobby → beginner tutorial (sonar waterfall, TMA on the fire-control plot, 3D periscope) →
 *   a frigate match against the AI (ops room picture, bridge view).
 * Usage: node scripts/screenshots.mjs        (CHROME_PATH=/path/to/chrome to pick the browser)
 * Takes about four minutes (the tutorial needs sim time for a TMA solution).
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'screenshots');
/** SHOTS=frigate: only the frigate scenes (the tutorial part takes most of the time). */
const ONLY = process.env.SHOTS;
const TMP = mkdtempSync(join(tmpdir(), 'tk-shots-'));
const W = 1600;
const H = 1000;
const procs = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[shots]', ...a);

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

const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.unref();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => res(port));
  });
});

function run(cmd, args, opts) {
  const p = spawn(cmd, args, { ...opts, detached: true, stdio: 'ignore' });
  procs.push(p);
  return p;
}

function cleanup() {
  for (const p of procs) {
    try {
      process.kill(-p.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

async function waitFor(what, fn, timeoutMs = 30_000, everyMs = 300) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* not yet */
    }
    if (Date.now() > until) throw new Error(`timeout: ${what}`);
    await sleep(everyMs);
  }
}

async function openTab(cdpPort, url) {
  const t = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURI(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const wait = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wait.has(m.id)) {
      wait.get(m.id)(m);
      wait.delete(m.id);
    }
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
  await cmd('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await cmd('Emulation.setFocusEmulationEnabled', { enabled: true });
  const shot = async (name) => {
    await sleep(600);
    const r = await cmd('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
    writeFileSync(join(OUT, `${name}.jpg`), Buffer.from(r.result.data, 'base64'));
    log('saved', `${name}.jpg`);
  };
  return { ev, cmd, shot, close: () => ws.close() };
}

/** The page's own modules (same instances as the app in Vite dev). */
const HOOK = `(async () => {
  if (window.__tk) return true;
  window.__tk = { net: (await import('/src/net.ts')).net, store: (await import('/src/store.ts')).store };
  return true;
})()`;
const click = (sel) => `(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.getClientRects().length); el?.click(); return !!el; })()`;
const clickText = (re) => `(() => { const el = [...document.querySelectorAll('button')].find((b) => b.getClientRects().length && ${re}.test(b.textContent.trim())); el?.click(); return !!el; })()`;
const station = (re) => `(() => { const b = [...document.querySelectorAll('#tabs button')].find((x) => ${re}.test(x.textContent)); b?.click(); return !!b; })()`;
const step = `(() => [...document.querySelectorAll('.panel')].find((p) => /ERSTE FEINDFAHRT/i.test(p.textContent))?.innerText.split('\\n').find((l) => l.startsWith('▸')) ?? '')()`;

async function login(tab, name) {
  // Vite may reload the page once while it optimizes dependencies on a cold start: retry
  for (let i = 0; ; i++) {
    try {
      return await loginOnce(tab, name);
    } catch (e) {
      if (i >= 2) throw e;
      log('login retry', e.message);
      await tab.cmd('Page.reload');
      await sleep(3000);
    }
  }
}

async function loginOnce(tab, name) {
  await waitFor('page', () => tab.ev(`document.readyState === 'complete' && !!document.querySelector('[data-mode="guest"]')`), 60_000);
  await tab.ev(`localStorage.setItem('tk_lang', 'de'); true`);
  await tab.cmd('Page.reload');
  await waitFor('page after language', () => tab.ev(`document.readyState === 'complete' && !!document.querySelector('[data-mode="guest"]')`), 60_000);
  await tab.ev(`delete window.__tk; true`);
  await tab.ev(HOOK);
  await tab.ev(click('[data-mode="guest"]'));
  await waitFor('callsign field', () => tab.ev(`!!document.querySelector('#cs')`));
  await tab.ev(`(() => { const f = document.querySelector('#cs'); f.value = ${JSON.stringify(name)}; f.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await tab.ev(click('#go'));
  await waitFor('lobby', () => tab.ev(`!!document.querySelector('#create')`), 20_000);
}

async function closeBriefing(tab) {
  await waitFor('game screen', () => tab.ev(`document.querySelectorAll('#tabs button').length >= 4`), 30_000);
  await waitFor('briefing', () => tab.ev(click('#brief-go')), 8000).catch(() => undefined);
  await sleep(500);
}

async function tutorial(tab) {
  await tab.ev(clickText('/^Erste Feindfahrt/'));
  await closeBriefing(tab);
  await tab.ev(`__tk.net.send({ t: 'order', depth: 60 }); __tk.net.send({ t: 'order', speedKn: 3 }); true`);
  await waitFor('contact', () => tab.ev(`!!__tk.store.snap?.contacts.some((c) => c.label === 'S1')`), 30_000);
  await tab.ev(`__tk.store.selected = 'S1'; true`);
  log('tutorial: listening (3 sim-minutes)');
  await waitFor('bearing watched', () => tab.ev(`/Kurswechsel/.test(${step})`), 120_000, 1000);
  await tab.shot('02-horchraum-wasserfall');
  // Second leg away from the target, across the line of sight
  await tab.ev(`__tk.net.send({ t: 'order', speedKn: 5, heading: 210 }); true`);
  log('tutorial: second leg (about 5 sim-minutes)');
  await waitFor('leg run', () => tab.ev(`__tk.store.snap.time > 560`), 180_000, 1000);
  await tab.ev(station('/feuerleitung/i'));
  await sleep(800);
  for (let i = 0; i < 6; i++) {
    await tab.ev(clickText('/^Auto-TMA$/'));
    await sleep(1500);
    if (await tab.ev(`/Sehrohr|Torpedo|Draht|Ablaufen/.test(${step})`)) break;
    await sleep(8000);
  }
  await tab.shot('03-feuerleitung-tma');
  // Periscope: up to periscope depth, mast up, on the target
  await tab.ev(station('/sehrohr/i'));
  await sleep(800);
  await tab.ev(click('#peri'));
  // Up from 60 m takes a few sim-minutes; keep asking for the mast until it is out
  await waitFor('mast up', async () => (await tab.ev(`__tk.store.snap.own.mastUp`)) || (await tab.ev(click('#up')), false), 180_000, 3000);
  await sleep(3000);
  await tab.ev(click('#totgt'));
  await sleep(3500);
  await tab.shot('04-sehrohr');
}

async function frigate(tab) {
  await tab.ev(`document.querySelector('#mname').value = 'Geleitzug'; true`);
  await tab.ev(click('#create'));
  await waitFor('match lobby', () => tab.ev(`!!document.querySelector('#ready')`));
  await tab.ev(click('#ready'));
  await closeBriefing(tab);
  log('frigate: waiting for the picture to build up');
  await sleep(25_000);
  await tab.ev(station('/opz/i'));
  await sleep(1500);
  await tab.shot('05-fregatte-opz');
  if (await tab.ev(station('/brücke/i'))) {
    // Look at the convoy (behind the frigate at the start): select a merchant, then "Auf Kontakt"
    await tab.ev(`(() => { const c = __tk.store.snap.contacts.filter((x) => x.bearing > 190 && x.bearing < 240).sort((a, b) => b.se - a.se)[0]; if (c) __tk.store.selected = c.label; return true; })()`);
    await sleep(500);
    await tab.ev(clickText('/^Auf Kontakt$/i'));
    await sleep(800);
    await tab.ev(clickText('/^Fernglas/i'));
    await sleep(4000);
    await tab.shot('06-fregatte-bruecke');
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const [srvPort, vitePort, cdpPort] = [await freePort(), await freePort(), await freePort()];
  const BASE = `http://localhost:${vitePort}/`;
  const env = { ...process.env, PORT: String(srvPort), DB_PATH: join(TMP, 'shots.db'), MATCH_DIR: join(TMP, 'matches'), COOKIE_SECURE: '0', NODE_ENV: 'development' };
  const tsx = join(ROOT, 'node_modules', '.bin', 'tsx');
  const vite = join(ROOT, 'node_modules', '.bin', 'vite');
  run(tsx, ['src/index.ts'], { cwd: join(ROOT, 'apps/server'), env });
  run(vite, ['--port', String(vitePort), '--strictPort', '--host', 'localhost'], { cwd: join(ROOT, 'apps/client'), env: { ...process.env, API_PORT: String(srvPort) } });
  await waitFor('game server', async () => (await fetch(`http://127.0.0.1:${srvPort}/api/health`)).ok, 60_000, 500);
  await waitFor('vite', async () => (await fetch(BASE)).ok, 60_000, 500);
  await fetch(`${BASE}src/main.ts`).catch(() => undefined);
  run(chromePath(), [
    '--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${join(TMP, 'profile')}`, '--lang=de-DE',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--no-first-run', '--no-default-browser-check',
    `--window-size=${W},${H}`, 'about:blank', ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
  ], {});
  await waitFor('chrome', async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok, 30_000);

  const sub = await openTab(cdpPort, BASE);
  await login(sub, 'Kaleun');
  if (ONLY !== 'frigate') {
    await sub.shot('01-lobby');
    await tutorial(sub);
  }
  const esc = await openTab(cdpPort, BASE);
  await login(esc, 'Kommodore');
  await frigate(esc);
  sub.close();
  esc.close();
}

main()
  .then(() => {
    cleanup();
    process.exit(0);
  })
  .catch((e) => {
    console.error('[shots] failed:', e.message);
    cleanup();
    process.exit(1);
  });
