#!/usr/bin/env node
/**
 * Every screen in both themes: headless Chrome over the DevTools protocol, own game server and
 * Vite on free ports, a fresh database. For each scene it saves a screenshot to
 * artifacts/theme-shots/<theme>/ and measures the contrast of every visible text against its
 * background. Fails when a text falls below MIN_CONTRAST (default 3:1) in either theme.
 *   node scripts/theme-check.mjs            THEMES=light to check one theme only
 * CI uploads the folder as an artifact, so layout and colour regressions show at a glance.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOOK, chromePath, freePort, log, openTab, prewarmVite, sleep, waitFor } from './cdp-tab.mjs';
import { CONTRAST, fakeDebrief } from './theme-probe.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'artifacts', 'theme-shots');
const TMP = mkdtempSync(join(tmpdir(), 'tk-theme-'));
const THEMES = (process.env.THEMES ?? 'dark,light').split(',');
const MIN = Number(process.env.MIN_CONTRAST ?? 3);
const procs = [];
const problems = [];

function run(cmd, args, opts) {
  const p = spawn(cmd, args, { ...opts, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = [];
  p.stdout.on('data', (d) => out.push(d));
  p.stderr.on('data', (d) => out.push(d));
  procs.push({ p, out });
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

/** Screenshot plus contrast check of the current screen. */
async function scene(tab, theme, name) {
  await sleep(700);
  const r = await tab.cmd('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
  mkdirSync(join(OUT, theme), { recursive: true });
  writeFileSync(join(OUT, theme, `${name}.jpg`), Buffer.from(r.result.data, 'base64'));
  const low = await tab.ev(`(${CONTRAST})(${MIN})`);
  for (const l of low) problems.push({ theme, scene: name, ...l });
  log(theme, `${name}: ${low.length ? `${low.length} text(s) below ${MIN}:1` : 'ok'}`);
}

const station = (re) => `(() => { const b = [...document.querySelectorAll('#tabs button')].find((x) => ${re}.test(x.textContent)); b?.click(); return !!b; })()`;
const clickJs = (sel) => `(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.getClientRects().length); el?.click(); return !!el; })()`;

async function prepare(tab, theme) {
  await waitFor('page', () => tab.ev(`document.readyState === 'complete' && !!document.querySelector('[data-mode="guest"], #create')`), 60_000);
  // Still signed in from the previous pass: sign out first
  await tab.ev(`fetch('/api/logout', { method: 'POST' }).then(() => true)`);
  await tab.ev(`localStorage.setItem('tk_lang', 'de'); localStorage.setItem('tk_theme', ${JSON.stringify(theme)}); true`);
  await tab.cmd('Page.reload');
  await waitFor('page (theme)', () => tab.ev(`document.readyState === 'complete' && document.documentElement.dataset.theme === ${JSON.stringify(theme)} && !!document.querySelector('[data-mode="guest"]')`), 60_000);
  await tab.ev(HOOK);
}

async function stations(tab, theme, prefix, names) {
  for (const [re, name] of names) {
    if (!(await tab.ev(station(re)))) continue;
    await sleep(1200);
    await scene(tab, theme, `${prefix}-${name}`);
  }
}

async function startMatch(tab, team) {
  await tab.ev(`document.querySelector('#mname').value = 'Prüfung'; true`);
  await tab.ev(clickJs('#create'));
  await waitFor('match lobby', () => tab.ev(`!!document.querySelector('#ready')`));
  if (team === 'east') {
    await tab.ev(clickJs('[data-switch="east"]'));
    await sleep(800);
  }
  return async () => {
    await tab.ev(clickJs('#ready'));
    await waitFor('game screen', () => tab.ev(`document.querySelectorAll('#tabs button').length >= 4`), 60_000);
    await waitFor('briefing', () => tab.ev(clickJs('#brief-go')), 8000).catch(() => undefined);
    await sleep(8000);
  };
}

async function leave(tab) {
  await tab.ev(`__tk.net.send({ t: 'leave' }); true`);
  await waitFor('back in the lobby', () => tab.ev(`!!document.querySelector('#create')`), 20_000).catch(async () => {
    await tab.cmd('Page.reload');
    await waitFor('lobby after reload', () => tab.ev(`!!document.querySelector('#create')`), 30_000);
  });
  await tab.ev(`delete window.__tk; true`);
  await tab.ev(HOOK);
}

async function themePass(cdpPort, base, theme, n) {
  const tab = await openTab(cdpPort, base, theme);
  await prepare(tab, theme);
  await scene(tab, theme, '01-anmeldung');
  // An account, so the campaign and the service record show too
  const cs = `Pruefer${n}`;
  await tab.ev(`fetch('/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ callsign: ${JSON.stringify(cs)}, email: ${JSON.stringify(`${cs.toLowerCase()}@example.invalid`)}, password: 'geheim-pruefung-123', faction: 'east' }) }).then((r) => r.status)`);
  await tab.ev(`fetch('/api/campaign/new', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cls: 'ssk' }) }).then((r) => r.status)`);
  await tab.cmd('Page.reload');
  await waitFor('lobby', () => tab.ev(`document.readyState === 'complete' && !!document.querySelector('#create')`), 30_000);
  await tab.ev(HOOK);
  await sleep(1500);
  await scene(tab, theme, '02-lobby');
  await tab.ev(`(() => { const c = document.querySelector('.campaign'); c?.scrollIntoView(); return !!c; })()`);
  await scene(tab, theme, '03-kampagne');
  await tab.ev(`window.scrollTo(0, 0); true`);

  // Frigate against the AI
  const goW = await startMatch(tab, 'west');
  await scene(tab, theme, '04-partie-lobby');
  await goW();
  await stations(tab, theme, '10-fregatte', [['/opz/i', 'opz'], ['/sonar/i', 'sonar'], ['/waffen/i', 'waffen'], ['/radar/i', 'radar-esm'], ['/brücke/i', 'bruecke']]);
  if (await tab.ev(clickJs('.gear'))) {
    await sleep(400);
    await scene(tab, theme, '18-einstellungen');
    await tab.ev(clickJs('.gear'));
  }
  // Debrief and the shared replay page, from a synthetic match
  await tab.ev(`(async () => { const m = await import('/src/screens/debrief.ts'); m.debriefOverlay(${fakeDebrief()}, () => {}); return true; })()`);
  await sleep(1500);
  await scene(tab, theme, '19-auswertung');
  await tab.ev(clickJs('#db-close'));
  await tab.ev(`(async () => { const m = await import('/src/screens/debrief.ts'); m.debriefOverlay(${fakeDebrief()}, () => {}, false, true); return true; })()`);
  await sleep(1500);
  await scene(tab, theme, '20-wiederholung');
  await tab.ev(clickJs('#db-close'));
  await leave(tab);

  // Submarine
  const goE = await startMatch(tab, 'east');
  await goE();
  await stations(tab, theme, '30-uboot', [['/horch/i', 'horchraum'], ['/sehrohr/i', 'sehrohr'], ['/feuer/i', 'feuerleitung'], ['/zentrale/i', 'zentrale']]);
  if (await tab.ev(`(() => { const b = [...document.querySelectorAll('#side-tabs button')].find((x) => /schaden|lecks/i.test(x.textContent)); b?.click(); return !!b; })()`)) {
    await sleep(600);
    await scene(tab, theme, '35-uboot-schaden');
  }
  await leave(tab);
  await tab.cmd('Page.close').catch(() => undefined);
  tab.close();
}

async function main() {
  const [srvPort, vitePort, cdpPort] = [await freePort(), await freePort(), await freePort()];
  const BASE = `http://localhost:${vitePort}/`;
  const env = { ...process.env, PORT: String(srvPort), DB_PATH: join(TMP, 'theme.db'), MATCH_DIR: join(TMP, 'matches'), COOKIE_SECURE: '0', NODE_ENV: 'development' };
  run(join(ROOT, 'node_modules', '.bin', 'tsx'), ['src/index.ts'], { cwd: join(ROOT, 'apps/server'), env });
  const vite = run(join(ROOT, 'node_modules', '.bin', 'vite'), ['--port', String(vitePort), '--strictPort', '--host', 'localhost'], { cwd: join(ROOT, 'apps/client'), env: { ...process.env, API_PORT: String(srvPort) } });
  const viteOut = () => Buffer.concat(procs.find((x) => x.p === vite).out).toString();
  await waitFor('game server', async () => (await fetch(`http://127.0.0.1:${srvPort}/api/health`)).ok, 60_000, 500);
  await waitFor('vite', async () => (await fetch(BASE)).ok, 60_000, 500);
  run(chromePath(), [
    '--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${join(TMP, 'profile')}`, '--lang=de-DE',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--no-first-run', '--no-default-browser-check',
    'about:blank', ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
  ], {});
  await waitFor('chrome', async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok, 30_000);
  await prewarmVite(cdpPort, BASE, viteOut);
  for (const [i, theme] of THEMES.entries()) await themePass(cdpPort, BASE, theme, i + 1);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'contrast.json'), JSON.stringify(problems, null, 1));
  if (problems.length) {
    // One line per distinct text and colour pair
    const seen = new Set();
    for (const p of problems) {
      const k = `${p.theme}|${p.sel}|${p.fg}|${p.bg}`;
      if (seen.has(k)) continue;
      seen.add(k);
      console.log(`  ${p.theme.padEnd(5)} ${p.ratio.toFixed(2)}:1  ${p.sel}  „${p.text}“  ${p.fg} auf ${p.bg}  (${p.scene})`);
    }
    throw new Error(`${seen.size} text(s) below ${MIN}:1 contrast`);
  }
  log('done', `all screens readable in ${THEMES.join(' and ')}; screenshots in artifacts/theme-shots/`);
}

main()
  .then(() => {
    cleanup();
    process.exit(0);
  })
  .catch((e) => {
    console.error('[theme] failed:', e.message);
    cleanup();
    process.exit(1);
  });
