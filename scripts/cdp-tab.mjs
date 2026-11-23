/**
 * Helpers for the browser tests over the Chrome DevTools protocol (no extra dependencies):
 * a tiny tab client with real mouse clicks, a hook into the page's own modules, main-thread
 * stall reports, and a Vite warm-up for cold starts. Used by scripts/tutorial-e2e.mjs.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';

const T0 = performance.now();
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const log = (who, ...a) => console.log(`[tut ${((performance.now() - T0) / 1000).toFixed(1).padStart(5)}s] ${who}`, ...a);
export function chromePath() {
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

export const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.unref();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => res(port));
  });
});

export async function waitFor(what, fn, timeoutMs = 30_000, everyMs = 250) {
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
  // One last look: a page busy for a long time (software WebGL) answers only after the deadline
  try {
    const v = await fn();
    if (v) return v;
  } catch (e) {
    last = e;
  }
  throw new Error(`timeout waiting for ${what}${last ? `: ${last.message}` : ''}`);
}

/** One browser tab with a tiny DevTools client. */
export async function openTab(cdpPort, url, name) {
  const t = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURI(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const wait = new Map();
  const errors = [];
  const tab = { name, reloads: 0, errors };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wait.has(m.id)) {
      wait.get(m.id)(m);
      wait.delete(m.id);
    } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
    else if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId && tab.loaderId && m.params.frame.loaderId !== tab.loaderId) {
      // The page was loaded again (Vite reload, or a retry): say so, and hook the new page
      tab.loaderId = m.params.frame.loaderId;
      tab.reloads++;
      log(name, `page reloaded (${tab.reloads}×)`);
      void rehook(tab);
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
  await cmd('Page.enable');
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cmd('Emulation.setFocusEmulationEnabled', { enabled: true });
  const mouse = async (x, y, button = 'left', hold = 0) => {
    const base = { x, y, button, clickCount: 1 };
    await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
    if (hold) await sleep(hold);
    await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
  };
  // The first load of the page is no reload: remember it once it is there
  await waitFor(`${name}: page loaded`, () => ev(`location.href !== 'about:blank' && document.readyState !== 'loading'`), 120_000, 200);
  tab.loaderId = (await cmd('Page.getFrameTree')).result.frameTree.frame.loaderId;
  /** Real mouse click in the middle of the first visible element matching the selector (and text). */
  const click = async (sel, match) => {
    const text = match instanceof RegExp ? match.source : match;
    const t0 = Date.now();
    let why = '';
    const box = await waitFor(`visible ${sel}${text ? ` "${text}"` : ''}`, () => ev(`(() => {
      const re = ${text ? `new RegExp(${JSON.stringify(text)})` : 'null'};
      const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.getClientRects().length && !e.disabled && (!re || re.test(e.textContent.trim())));
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      // Only click what is really on top (no overlay in the way)
      const top = document.elementFromPoint(x, y);
      if (top && (el === top || el.contains(top))) return { x, y };
      throw new Error('covered by ' + (top ? top.tagName + '.' + top.className + ' ' + (top.textContent ?? '').slice(0, 40) : 'nothing') + ' at ' + Math.round(x) + ',' + Math.round(y));
    })()`).catch((e) => void (why = e.message)), 15_000);
    if (Date.now() - t0 > 3000) log('slow click', sel, `${Date.now() - t0} ms`, why.slice(-160));
    await mouse(box.x, box.y);
  };
  return Object.assign(tab, { ev, cmd, click, mouse, close: () => ws.close() });
}

/** Hook the page's own modules (same instances as the app in Vite dev) to observe traffic. */
export const HOOK = `(async () => {
  if (window.__tk) return true;
  const net = (await import('/src/net.ts')).net;
  const store = (await import('/src/store.ts')).store;
  window.__tk = { net, store, msgs: [], long: [] };
  net.on((m) => { if (m.t !== 'snap' && m.t !== 'voice') __tk.msgs.push(m); });
  // Main-thread stalls (e.g. shader compiles in software WebGL): reported when a step is slow
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => __tk.long.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: 'longtask', buffered: true });
  } catch { /* no long-task timing */ }
  return true;
})()`;

export async function rehook(tab) {
  try {
    await waitFor(`${tab.name}: page loaded again`, () => tab.ev(`document.readyState === 'complete'`), 60_000);
    await tab.ev(HOOK);
  } catch (e) {
    log(tab.name, 'could not hook the reloaded page:', e.message);
  }
}

/** Main-thread stalls of at least `minMs` since the last call (text, or '' if none). */
export async function stalls(tab, minMs = 2000) {
  const l = await tab.ev(`__tk.long.splice(0).filter(([, d]) => d >= ${minMs})`).catch(() => []);
  return l.length ? `main thread blocked ${l.map(([at, d]) => `${(d / 1000).toFixed(1)} s at ${(at / 1000).toFixed(0)} s`).join(', ')}` : '';
}

/** Lazily imported modules of the client: loaded once before the test so Vite has compiled them all. */
const LAZY = ['/src/screens/game.ts', '/src/widgets/periscope3d.ts', '/src/widgets/recog-render.ts', '/src/widgets/sea3d/underwater.ts', '/src/voice/sfu.ts'];
const VITE_REOPT = /new dependencies optimized|optimized dependencies changed|reloading/i;

/**
 * Cold start (fresh .vite cache, as in CI): let Vite pre-bundle and compile every module in a
 * throwaway tab first, until a round passes without Vite discovering new dependencies (which
 * reloads open pages). The game tabs then start on a settled dev server.
 */
export async function prewarmVite(cdpPort, base, viteOut) {
  const t0 = Date.now();
  for (let round = 1; ; round++) {
    const mark = viteOut().length;
    const tab = await openTab(cdpPort, base, 'warm-up');
    await waitFor('warm-up page', () => tab.ev(`document.readyState === 'complete' && !!document.querySelector('[data-mode="guest"]')`), 120_000, 500);
    await tab.ev(`Promise.all(${JSON.stringify(LAZY)}.map((m) => import(m))).then(() => true)`);
    await sleep(1500);
    await tab.cmd('Page.close').catch(() => undefined);
    tab.close();
    const fresh = viteOut().slice(mark);
    if (!VITE_REOPT.test(fresh)) break;
    if (round >= 4) throw new Error(`Vite keeps optimizing dependencies: ${fresh.slice(-300)}`);
    log('setup', `Vite optimized dependencies during warm-up round ${round}, once more`);
  }
  log('setup', `Vite warmed up in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

