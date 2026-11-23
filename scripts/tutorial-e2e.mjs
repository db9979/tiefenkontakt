#!/usr/bin/env node
/**
 * Tutorial end-to-end test: headless Chrome over the DevTools protocol (no extra dependencies,
 * helpers in scripts/cdp-tab.mjs). Own game server and Vite on free ports, a fresh
 * database. Two guests play the two guided beginner lessons at the same time, through the
 * real UI (buttons, helm, contact list, map right-click menu):
 *   "Erste Feindfahrt" (submarine) and "Erste Geleitfahrt" (frigate).
 * Asserts for each: every step ticks itself off (✓, never skipped with „Weiter“), the lesson
 * ends with success, and no uncaught page errors.
 * Usage: npm run e2e:tutorials     (CHROME_PATH=/path/to/chrome, ONLY=feindfahrt|geleitfahrt, E2E_KEEP=1 keeps logs)
 * Takes about five minutes: both lessons run side by side at the normal 3× time scale (a missed
 * torpedo or rocket is fired again, as the lesson tells the player; each repeat adds a few minutes).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOOK, chromePath, freePort, log, openTab, prewarmVite, sleep, stalls, waitFor } from './cdp-tab.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = mkdtempSync(join(tmpdir(), 'tk-tut-'));
const procs = [];
const ONLY = process.env.ONLY;

function run(name, cmd, args, opts) {
  const p = spawn(cmd, args, { ...opts, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks = [];
  p.stdout.on('data', (d) => chunks.push(d));
  p.stderr.on('data', (d) => chunks.push(d));
  p.on('exit', () => writeFileSync(join(TMP, `${name}.log`), Buffer.concat(chunks)));
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

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
  log('ok ·', msg);
}

async function login(tab, name) {
  // Vite may reload the page once while it optimizes dependencies on a cold start: retry
  for (let i = 0; ; i++) {
    try {
      await waitFor('page ready', () => tab.ev(`document.readyState === 'complete' && !!document.querySelector('[data-mode="guest"]')`), 60_000);
      await tab.ev(`localStorage.setItem('tk_lang', 'de'); true`);
      await tab.ev(HOOK);
      await tab.click('[data-mode="guest"]');
      await waitFor('callsign field', () => tab.ev(`!!document.querySelector('#cs')`));
      await tab.ev(`(() => { const f = document.querySelector('#cs'); f.value = ${JSON.stringify(name)}; f.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      await tab.click('#go');
      await waitFor(`${name} in the lobby`, () => tab.ev(`!!document.querySelector('#create')`), 20_000);
      // The lobby compiles the 3D shaders in the background; in headless Chrome (software WebGL)
      // that blocks the page for many seconds. Let it finish before the lesson's clock runs
      const t0 = Date.now();
      await tab.ev(`(async () => { const p = (await import('/src/prefetch.ts')).warmUpDone(); await Promise.race([p, new Promise((r) => setTimeout(r, 120000))]); return true; })()`);
      log(name, `lobby warm-up done in ${((Date.now() - t0) / 1000).toFixed(1)} s`, await stalls(tab, 1000));
      return true;
    } catch (e) {
      if (i >= 2) throw e;
      log(name, 'login retry:', e.message);
      await tab.cmd('Page.reload');
      await sleep(3000);
    }
  }
}

/** Lesson progress as the panel saved it (survives the end of the match). */
const progress = async (tab, lesson) => {
  const r = await tab.ev(`(() => {
    const key = 'tk_tut_' + (__tk.store.matchId ?? '') + '_${lesson}';
    const keys = Object.keys(sessionStorage).filter((k) => k.startsWith('tk_tut_') && k.endsWith('_${lesson}'));
    const p = JSON.parse(sessionStorage.getItem(keys.includes(key) || keys.length !== 1 ? key : keys[0]) ?? '{}');
    return { done: p.done ?? [], skipped: p.skipped ?? [], key, keys };
  })()`);
  // The panel keys its progress by the match id it saw when it mounted
  if (r.keys.length && !r.keys.includes(r.key) && !tab.warned) {
    tab.warned = true;
    log(lesson, 'progress saved under', r.keys.join(', '), 'but store.matchId gives', r.key);
  }
  return r;
};
// textContent, not innerText: the test folds the panel, and folded rows have no rendered text
const currentStep = (tab) => tab.ev(`document.querySelector('.tutorial .row.amber .dim')?.textContent ?? ''`);

/** Wait until the lesson has n steps ticked; fail at once if any was skipped. */
async function untilDone(tab, lesson, n, timeoutMs, what) {
  await waitFor(`${lesson}: step ${n} (${what})`, async () => {
    const p = await progress(tab, lesson);
    // A skipped step can never tick again: fail now instead of waiting for the timeout
    if (p.skipped.length) return { skipped: p.skipped };
    return p.done.length >= n;
  }, timeoutMs, 500).then((r) => {
    if (r.skipped) throw new Error(`step(s) ${r.skipped.map((i) => i + 1)} skipped with „Weiter“`);
  });
  log(lesson, `✓ ${n} ${what}`, await stalls(tab));
}

const station = (tab, re) => tab.click('#tabs button', re);
const simTime = (tab) => tab.ev(`__tk.store.snap?.time ?? 0`);
/** Click the helm compass at a course (the compass is a circle around its upper part). */
async function compass(tab, heading) {
  const c = await tab.ev(`(() => { const r = document.querySelector('#h-compass').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 85, w: r.width }; })()`);
  const a = (heading * Math.PI) / 180;
  await tab.mouse(c.x + Math.sin(a) * 50, c.y - Math.cos(a) * 50);
}
const slider = (tab, sel, v) => tab.ev(`(() => { const el = document.querySelector('${sel}'); el.value = '${v}'; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);

async function startLesson(tab, lesson) {
  await tab.click(`[data-lesson="${lesson}"]`);
  await waitFor('game screen', () => tab.ev(`document.querySelectorAll('#tabs button').length >= 4 && !!document.querySelector('.tutorial')`), 30_000);
  assert(await tab.ev(`__tk.store.snap?.lesson === '${lesson}'`), `${lesson}: lesson running, step panel shown`);
  // Fold the panel: its text grows and shrinks as steps change, and the helm below it would
  // move under the mouse (a click could land on „Weiter“). The rows stay in the page.
  await tab.click('#tut-min');
}

async function finish(tab, lesson, steps) {
  const end = await waitFor(`${lesson}: end of the lesson`, () => tab.ev(`__tk.msgs.find((m) => m.t === 'end') ?? null`), 240_000, 500);
  await sleep(800);
  const p = await progress(tab, lesson);
  assert(p.done.length === steps && p.skipped.length === 0, `${lesson}: all ${steps} steps ticked, none skipped`);
  const marks = await tab.ev(`[...document.querySelectorAll('.tutorial .row > span:first-child')].map((s) => s.textContent.trim()[0])`);
  assert(marks.length === steps && marks.every((m) => m === '✓'), `${lesson}: panel shows ✓ on every step (${marks.join('')})`);
  assert(/geschafft/.test(end.reason), `${lesson}: ended with success ("${end.reason}") at sim ${Math.round(await simTime(tab))} s`);
  const errs = tab.errors.filter((e) => !/AbortError|NotAllowedError|ResizeObserver/.test(e ?? ''));
  assert(errs.length === 0, `${lesson}: no uncaught page errors${errs.length ? `: ${errs.join(' | ')}` : ''}`);
}

/**
 * Fire control: take over the solution and fire (seeker on at half the computed distance for a
 * repeat shot). Returns the sim seconds after which a torpedo that has not found the target missed.
 */
async function torpedoShot(tab, early) {
  await tab.click('#calc');
  await sleep(500);
  // „Lösung übernehmen“ sets the seeker distance to 70 % of the solution's range
  const en = Number(await tab.ev(`document.querySelector('#t-en').value`));
  if (early) await tab.ev(`(() => { const f = document.querySelector('#t-en'); f.value = String(Math.max(500, Math.round(Number(f.value) / 2 / 250) * 250)); return true; })()`);
  const n = await tab.ev(`__tk.store.snap.own.loadout.tubes.filter((t) => t.loaded).length`);
  await tab.click('#fire');
  await waitFor('torpedo away', () => tab.ev(`__tk.store.snap.own.loadout.tubes.filter((t) => t.loaded).length < ${n}`), 30_000);
  // Run time to the solution's range at 40 kn (20.6 m/s), plus a margin for the search
  return ((en / 0.7) / 20.6) * 1.5 + 90;
}

/** "Erste Feindfahrt": the submarine sortie against a lone freighter. */
async function feindfahrt(tab) {
  const L = 'feindfahrt';
  await startLesson(tab, L);
  await slider(tab, '#h-depth', 60);
  await untilDone(tab, L, 1, 60_000, 'depth 60 m');
  await tab.click('#h-steps button[data-s="1"]');
  await untilDone(tab, L, 2, 20_000, 'creep speed');
  await station(tab, /Horchraum|Sonar/);
  const label = await waitFor('contact', () => tab.ev(`__tk.store.snap?.contacts.find((c) => c.sensors.includes('hull'))?.label`), 60_000);
  await tab.click(`#station [data-c="${label}"]`);
  await untilDone(tab, L, 3, 20_000, `contact ${label} selected`);
  await untilDone(tab, L, 4, 150_000, 'bearing watched 3 min');
  // Second leg away from the target, across the line of sight
  await tab.click('#h-steps button[data-s="2"]');
  await compass(tab, 210);
  await waitFor('course 210 ordered', () => tab.ev(`Math.abs(__tk.store.snap.own.order.heading - 210) < 15`), 10_000);
  await untilDone(tab, L, 5, 200_000, 'leg change');
  await station(tab, /Feuerleitung/);
  // Auto-TMA, again after more bearings on the new leg until the quality is good
  for (let i = 0; (await progress(tab, L)).done.length < 7; i++) {
    if (i > 30) throw new Error('TMA quality never above 60 %');
    await tab.click('#auto');
    await sleep(6000);
  }
  log(L, '✓ 7 solution with quality > 60 %');
  await station(tab, /Sehrohr/);
  await tab.click('#peri');
  // Up from 60 m takes a few sim-minutes; raise the mast as soon as the boat is there
  await waitFor('mast up', async () => (await tab.ev(`__tk.store.snap.own.mastUp`)) || (await tab.ev(`__tk.store.snap.own.depth < 20`) && (await tab.click('#up'), await sleep(1500)), false), 200_000, 2000);
  await tab.click('#totgt');
  await untilDone(tab, L, 8, 60_000, 'periscope range');
  await tab.click('#up');
  await waitFor('mast down', () => tab.ev(`!__tk.store.snap.own.mastUp`), 20_000);
  await station(tab, /Feuerleitung/);
  const firstRun = await torpedoShot(tab, false);
  await untilDone(tab, L, 9, 30_000, 'torpedo fired');
  // A shot can miss (most often: the solution's range is too long, so the seeker switches on
  // behind the target). The lesson tells the player to fire again with the seeker on earlier
  for (let shot = 1, runS = firstRun; ; shot++) {
    const t0 = await simTime(tab);
    const r = await waitFor(`${L}: hit or a missed torpedo (shot ${shot})`, async () => {
      if ((await progress(tab, L)).done.length >= 10) return 'hit';
      // A hit removes the torpedo before the panel (redrawn 4× a second) ticks the step: no miss then
      const { homing, running, sunk } = await tab.ev(`(({ torpedoes, score }) => ({ homing: torpedoes.some((t) => t.homing), running: torpedoes.length, sunk: score.sunkTons > 0 }))(__tk.store.snap)`);
      return !sunk && !homing && (!running || (await simTime(tab)) - t0 > runS) ? 'miss' : false;
    }, 300_000, 1000);
    if (r === 'hit') break;
    if (shot >= 3) throw new Error(`${shot} torpedoes missed`);
    log(L, `torpedo ${shot} missed (no target after ${Math.round(runS)} s): new solution, seeker on earlier, fire again`);
    await tab.click('#auto');
    await sleep(500);
    runS = await torpedoShot(tab, true);
  }
  log(L, '✓ 10 hit');
  // Evade: half speed, then deep
  await tab.click('#h-steps button[data-s="3"]');
  await slider(tab, '#h-depth', 80);
  await untilDone(tab, L, 11, 200_000, 'evading deep');
  await finish(tab, L, 11);
}

/** "Erste Geleitfahrt": the frigate screening a small convoy against one diesel boat. */
async function geleitfahrt(tab) {
  const L = 'geleitfahrt';
  await startLesson(tab, L);
  await tab.click('#h-steps button[data-s="3"]');
  await untilDone(tab, L, 1, 20_000, 'half speed');
  await station(tab, /Sonar/);
  await tab.click('[data-len="900"]');
  await untilDone(tab, L, 2, 20_000, 'array streaming');
  await untilDone(tab, L, 3, 150_000, 'array out and settled');
  // Sonobuoy: right-click the OPZ map 4 km east of the ship (centre of the plot), deep buoy
  await station(tab, /OPZ/);
  const p = await tab.ev(`(() => { const c = document.querySelector('#station canvas'); const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await tab.mouse(p.x + 4000 / 80, p.y, 'right');
  await tab.click('.ctxmenu button', '^Sonarboje tief');
  await untilDone(tab, L, 4, 120_000, 'sonobuoy in the water');
  // The new faint contact: not on the bearing of one of the own merchants (their positions are in
  // the picture), measured from where the contact was heard (own ship, or the buoy)
  await station(tab, /Sonar/);
  const label = await waitFor('contact that is no merchant', () => tab.ev(`(() => {
    const s = __tk.store.snap;
    const off = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
    const brg = (o, p) => (Math.atan2(p.x - o.x, p.y - o.y) * 180 / Math.PI + 360) % 360;
    const merchants = s.friendlies.filter((f) => f.cls === 'merchant');
    const isMerchant = (c) => {
      const o = c.originX !== undefined ? { x: c.originX, y: c.originY } : s.own;
      return merchants.some((m) => [c.bearing, c.bearingAlt].some((b) => b !== undefined && off(b, brg(o, m)) < 15));
    };
    return s.contacts.find((c) => c.sensors.includes('towed') && s.time - c.lastSeen < 10 && !isMerchant(c))?.label;
  })()`), 240_000, 1000);
  await tab.click(`#station [data-c="${label}"]`);
  await untilDone(tab, L, 5, 20_000, `contact ${label} selected`);
  // The contact list re-renders while clicking: make sure the class goes to the contact we found
  await tab.ev(`__tk.store.selected = ${JSON.stringify(label)}; true`);
  await tab.click('#station [data-cls="submarine"]');
  await untilDone(tab, L, 6, 20_000, 'classified as submarine');
  const wrong = await tab.ev(`__tk.store.snap.contacts.filter((c) => c.assigned === 'submarine' && c.label !== ${JSON.stringify(label)}).map((c) => c.label)`);
  if (wrong.length) throw new Error(`classified the wrong contact (${wrong.join(', ')} instead of ${label})`);
  await station(tab, /OPZ/);
  await tab.click('[data-detour="3000"]');
  await untilDone(tab, L, 7, 20_000, 'convoy diverted');
  await station(tab, /Sonar/);
  await tab.click('[data-pulse="lfm"]');
  await tab.click('#ping');
  await untilDone(tab, L, 8, 120_000, 'range from the LFM ping');
  await tab.click('#ping');
  await station(tab, /Waffen/);
  await waitFor('sub selected', () => tab.ev(`__tk.store.selectedContact()?.assigned === 'submarine' || (__tk.store.selected = __tk.store.snap.contacts.find((c) => c.assigned === 'submarine')?.label, false)`), 10_000);
  await tab.click('#rocket');
  await untilDone(tab, L, 9, 20_000, 'ASW rocket away');
  // The lightweight can miss: the lesson says to ping again and fire another rocket
  for (let shot = 1; ; shot++) {
    const t0 = await simTime(tab);
    const r = await waitFor(`${L}: hit or a missed rocket (shot ${shot})`, async () => {
      if ((await progress(tab, L)).done.length >= 10) return 'hit';
      return (await simTime(tab)) - t0 > 240 ? 'miss' : false;
    }, 200_000, 1000);
    if (r === 'hit') break;
    if (shot >= 3) throw new Error(`${shot} rockets missed`);
    log(L, `rocket ${shot} missed (no hit after 240 s): ping again, another rocket`);
    const rockets = await tab.ev(`__tk.store.snap.own.loadout.rockets`);
    await station(tab, /Sonar/);
    await tab.click('#ping');
    await waitFor('fresh ping fix', () => tab.ev(`(() => { const s = __tk.store.snap; const c = s.contacts.find((x) => x.assigned === 'submarine'); return !!c && c.sensors.includes('active') && c.range !== undefined && s.time - c.lastSeen < 10; })()`), 120_000, 500);
    if (await tab.ev(`!!__tk.store.snap.own.activeSonar`)) await tab.click('#ping');
    await station(tab, /Waffen/);
    await waitFor('sub selected', () => tab.ev(`__tk.store.selectedContact()?.assigned === 'submarine' || (__tk.store.selected = __tk.store.snap.contacts.find((c) => c.assigned === 'submarine')?.label, false)`), 10_000);
    await tab.click('#rocket');
    await waitFor('rocket away', () => tab.ev(`__tk.store.snap.own.loadout.rockets < ${rockets}`), 20_000);
  }
  log(L, '✓ 10 hit');
  await finish(tab, L, 10);
}

async function main() {
  const [srvPort, vitePort, cdpPort] = [await freePort(), await freePort(), await freePort()];
  const BASE = `http://localhost:${vitePort}/`;
  log('setup', 'ports', { server: srvPort, vite: vitePort, chrome: cdpPort }, 'tmp', TMP);
  const env = { ...process.env, PORT: String(srvPort), DB_PATH: join(TMP, 'tut.db'), MATCH_DIR: join(TMP, 'matches'), COOKIE_SECURE: '0', NODE_ENV: 'development' };
  const tsx = join(ROOT, 'node_modules', '.bin', 'tsx');
  const vite = join(ROOT, 'node_modules', '.bin', 'vite');
  run('server', existsSync(tsx) ? tsx : 'npx', existsSync(tsx) ? ['src/index.ts'] : ['tsx', 'src/index.ts'], { cwd: join(ROOT, 'apps/server'), env });
  run('vite', existsSync(vite) ? vite : 'npx', [...(existsSync(vite) ? [] : ['vite']), '--port', String(vitePort), '--strictPort', '--host', 'localhost'], {
    cwd: join(ROOT, 'apps/client'), env: { ...process.env, VITE_PORT: String(vitePort), API_PORT: String(srvPort) },
  });
  await waitFor('game server', async () => (await fetch(`http://127.0.0.1:${srvPort}/api/health`)).ok, 60_000, 500);
  await waitFor('vite', async () => (await fetch(BASE)).ok, 60_000, 500);
  await fetch(`${BASE}src/main.ts`).catch(() => undefined);
  const args = [
    '--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${join(TMP, 'profile')}`, '--lang=de-DE', '--mute-audio',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--no-first-run', '--no-default-browser-check',
    '--window-size=1440,900', 'about:blank', ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
  ];
  run('chrome', chromePath(), args, {});
  await waitFor('chrome devtools', async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok, 30_000, 300);
  log('setup', 'servers and Chrome up');
  const viteProc = procs.find((p) => p.name === 'vite');
  await prewarmVite(cdpPort, BASE, () => Buffer.concat(viteProc.chunks).toString());

  const plays = [['feindfahrt', 'Kaleun', feindfahrt], ['geleitfahrt', 'Kommodore', geleitfahrt]].filter(([l]) => !ONLY || ONLY === l);
  const tabs = [];
  for (const [, name] of plays) {
    const tab = await openTab(cdpPort, BASE, name);
    await login(tab, name);
    tabs.push(tab);
  }
  // Both lessons at once (separate private matches on the same server)
  const results = await Promise.allSettled(plays.map(([lesson, , play], i) => play(tabs[i]).catch(async (e) => {
    const step = await currentStep(tabs[i]).catch(() => '?');
    log(lesson, 'state:', await tabs[i].ev(`JSON.stringify({ matchId: __tk.store.matchId, keys: Object.keys(sessionStorage), panel: [...document.querySelectorAll('.tutorial .row > span:first-child')].map((s) => s.textContent.trim()[0]).join(''),
      own: (({ heading, x, y, speedKn }) => ({ heading, x, y, speedKn }))(__tk.store.snap.own), selected: __tk.store.selected, time: __tk.store.snap.time,
      torpedoes: __tk.store.snap.torpedoes.map((t) => ({ id: t.id, heading: Math.round(t.heading), homing: t.homing, wire: t.wire, run: Math.round(t.run), x: Math.round(t.x), y: Math.round(t.y) })),
      contacts: __tk.store.snap.contacts.map((c) => [c.label, Math.round(c.bearing), c.bearingAlt === undefined ? null : Math.round(c.bearingAlt), c.sensors.join('+'), c.assigned ?? '', c.range === undefined ? null : Math.round(c.range), Math.round(__tk.store.snap.time - c.lastSeen)]) })`).catch((x) => x.message));
    log(lesson, 'stalls:', await stalls(tabs[i], 500) || 'none', '· reloads:', tabs[i].reloads);
    throw new Error(`${lesson} at step "${step}" (sim ${Math.round(await simTime(tabs[i]).catch(() => 0))} s): ${e.message}`);
  })));
  for (const t of tabs) t.close();
  const reloaded = tabs.filter((t) => t.reloads);
  if (reloaded.length) log('note', 'pages reloaded during the test:', reloaded.map((t) => `${t.name} ${t.reloads}×`).join(', '));
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length) throw new Error(failed.map((r) => r.reason.message).join('\n'));
}

const guard = setTimeout(() => {
  console.error('[tut] overall timeout');
  cleanup();
  process.exit(1);
}, Number(process.env.E2E_TIMEOUT_MS ?? 900_000));

try {
  await main();
  log('PASSED', `in ${(performance.now() / 1000).toFixed(0)} s`);
  clearTimeout(guard);
  cleanup();
  if (!process.env.E2E_KEEP) {
    try {
      rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch (e) {
      console.warn(`[tut] could not remove ${TMP}: ${e.message}`);
    }
  }
  process.exit(0);
} catch (e) {
  console.error('[tut] FAILED:', e.message);
  for (const { name, chunks } of procs) {
    if (name === 'chrome') continue;
    console.error(`--- ${name} (last lines) ---\n${Buffer.concat(chunks).toString().split('\n').slice(-25).join('\n')}`);
  }
  clearTimeout(guard);
  cleanup();
  process.exit(1);
}
