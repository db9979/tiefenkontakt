/**
 * Bot vs bot arena: plays full matches headless with AI on both sides and prints outcomes.
 * Usage: npx tsx scripts/bot-arena.ts [games] [skill]
 * ARENA_LEVEL=leicht|normal|veteran [ARENA_LEVEL_SIDE=subs|escorts]: the AI level, for one role against NORMAL.
 * The match logic lives in apps/server/src/arena.ts (also used by the in-game replay series).
 */
import { ArenaGame, DEFAULT_ARENA, type ArenaSetup } from '../apps/server/src/arena.js';
import { seriesStats } from '../apps/server/src/series.js';
import { CLASSES, isConvoyShip, orderResults } from '../packages/shared/src/index.js';
import type { ScenarioSettings } from '../apps/server/src/scenario.js';
import { setShotTrace, type ShotTrace } from '../apps/server/src/bots/common.js';

const games = Number(process.argv[2] ?? 6);
/** Lobby level names to the bots' keys (VETERAN is 'schwer' inside). */
const LEVEL: Record<string, ScenarioSettings['botSkill']> = { leicht: 'leicht', normal: 'normal', veteran: 'schwer', schwer: 'schwer' };
// ARENA_LEVEL=leicht|normal|veteran: the AI level (else the second argument, default normal); with
// ARENA_LEVEL_SIDE=subs|escorts only that role plays at the level, the other one at NORMAL
const level = process.env.ARENA_LEVEL ? LEVEL[process.env.ARENA_LEVEL.toLowerCase()] : undefined;
if (process.env.ARENA_LEVEL && !level) throw new Error(`ARENA_LEVEL ${process.env.ARENA_LEVEL}: leicht, normal oder veteran`);
const levelSide = process.env.ARENA_LEVEL_SIDE;
if (levelSide && levelSide !== 'subs' && levelSide !== 'escorts') throw new Error(`ARENA_LEVEL_SIDE ${levelSide}: subs oder escorts`);
const skill = (levelSide ? 'normal' : level ?? process.argv[3] ?? 'normal') as ScenarioSettings['botSkill'];
const roles = levelSide && level ? (levelSide === 'subs' ? { sub: level } : { escort: level }) : undefined;
if (level) console.log(`KI-Stufe ${process.env.ARENA_LEVEL!.toUpperCase()}${levelSide ? ` nur ${levelSide === 'subs' ? 'U-Boote' : 'Eskorten'}, Gegenseite NORMAL` : ''}`);
const missions = (process.env.ARENA_MISSIONS?.split(',') ?? ['groenland', 'schelf', 'fjord']) as ScenarioSettings['mission'][];
// ARENA_MIX=1: the newer classes (VDS frigate, AIP boat) take the second slot of each side
const mix = !!process.env.ARENA_MIX;
// ARENA_MIXED=1 (both sides), west or east: the mixed place (West hunter-killer boat, East patrol ship) instead of one ship
const mixed = process.env.ARENA_MIXED;
// ARENA_SEED=n: first match seed (default 1000), to sample other matches
const seedBase = Number(process.env.ARENA_SEED ?? 1000);
const results = [];
const ordersTally = { west: [0, 0], east: [0, 0] };
/** Per mission: wins West/East and mines that hit convoy merchants. */
const firstAll = { west: [] as number[], east: [] as number[] };
const perMission = new Map<string, { w: number; e: number; mineHits: number }>();
// Pacing: every AI weapon release (bots/common.ts traceShot), the first one per side and game
let trace: ShotTrace[] = [];
const allShots: (ShotTrace & { game: number; mission: string })[] = [];
setShotTrace((r) => trace.push(r));
const firstShot = { west: [] as number[], east: [] as number[] };
const contactToShot = { west: [] as number[], east: [] as number[] };
/** Wake homers (east SSN): each run's trail locks, lost trails and end (hit on what, or ran out). */
interface WakeRun { id: string; game: number; owner: string; locks: string[]; lost: number; end?: string; ignoreAt?: number }
const wakeRuns: WakeRun[] = [];
for (let g = 0; g < games; g++) {
  const setup: ArenaSetup = { ...DEFAULT_ARENA, mission: missions[g % missions.length]!, botSkill: skill, ...(roles ? { roles } : {}), west: ['ffg', mixed === 'east' ? 'ffg' : mixed ? 'ssw' : mix ? 'ffv' : 'ffg'], east: [mix ? 'ssa' : 'ssk', mixed === 'west' ? 'ssn' : mixed ? 'ffk' : 'ssn'],
    // ARENA_VAR=aus|leicht|stark: per-match variation of positions, route and sea state
    ...(process.env.ARENA_VAR ? { variation: process.env.ARENA_VAR as ArenaSetup['variation'] } : {}),
    // ARENA_SEASON=winter|fruehling|sommer|herbst: fix the month (default: drawn per match)
    ...(process.env.ARENA_SEASON ? { season: process.env.ARENA_SEASON as ArenaSetup['season'] } : {}),
    // ARENA_TOD=tag|daemmerung|nacht: time of day (default day)
    ...(process.env.ARENA_TOD ? { timeOfDay: process.env.ARENA_TOD as ArenaSetup['timeOfDay'] } : {}),
    // ARENA_SEA=1..6: the lobby's sea state (weather then held stabil so it doesn't drift away)
    ...(process.env.ARENA_SEA ? { seaState: Number(process.env.ARENA_SEA), weather: 'stabil' as const } : {}),
    // ARENA_SCALE=1|2|3: the lobby's time scale (sea time = 40 min × scale; default 1× real time)
    ...(process.env.ARENA_SCALE ? { timeScale: Number(process.env.ARENA_SCALE) } : {}) };
  const t0 = Date.now();
  trace = [];
  const game = new ArenaGame(setup, seedBase + g);
  // ARENA_NO_ORDERS=1: without fleet command's FLASH orders (to measure them separately)
  if (process.env.ARENA_NO_ORDERS) game.world.env.orders = undefined;
  // First contact per side (sim minutes): the boats on anything of the convoy, the escorts on an enemy unit
  const first: { west?: number; east?: number } = {};
  const live = new Map<string, WakeRun>();
  while (!game.step(100)) {
    const w = game.world;
    // Follow every wake homer: which trail it takes, when it loses one, how it ends
    const torps = w.weapons?.torpedoes ?? [];
    for (const t of torps) {
      if (t.mode !== 'wake') continue;
      let r = live.get(t.id);
      if (!r) live.set(t.id, (r = { id: t.id, game: g, owner: t.ownerId, locks: [], lost: 0 }));
      const on = t.wakeLock?.shipId;
      const cls = on ? w.ships.find((x) => x.id === on)?.cls ?? on : undefined;
      if (cls && r.locks[r.locks.length - 1] !== cls) r.locks.push(cls);
      if (t.wakeIgnore && t.wakeIgnore.untilRun !== r.ignoreAt) [r.lost, r.ignoreAt] = [r.lost + 1, t.wakeIgnore.untilRun];
    }
    for (const [id, r] of live) {
      if (torps.some((t) => t.id === id)) continue;
      const hit = w.events.filter((e) => e.kind === 'hit' && e.byId === r.owner && w.time - e.time < 15).pop();
      r.end = hit && hit.kind === 'hit' ? `Treffer ${w.ships.find((x) => x.id === hit.shipId)?.cls ?? hit.shipId}` : 'ohne Treffer';
      wakeRuns.push(r);
      live.delete(id);
    }
    for (const side of ['west', 'east'] as const) {
      if (first[side] !== undefined) continue;
      const held = w.ships.some((o) => o.alive && o.team === side && o.id.startsWith('p_') && [...(w.books.get(o.id)?.entries() ?? [])].some(([tid]) => {
        const t = w.ships.find((x) => x.id === tid);
        return !!t && t.team !== side && t.team !== 'neutral' || (!!t && side === 'east' && isConvoyShip(t));
      }));
      if (held) first[side] = Math.round(w.time / 6) / 10;
    }
  }
  for (const side of ['west', 'east'] as const) firstAll[side].push(first[side] ?? Infinity);
  const fs: { west?: number; east?: number } = {};
  for (const side of ['west', 'east'] as const) {
    const f = trace.find((x) => x.team === side);
    if (!f) continue;
    fs[side] = Math.round(f.t / 6) / 10;
    firstShot[side].push(fs[side]!);
    if (first[side] !== undefined) contactToShot[side].push(Math.round((f.t / 60 - first[side]!) * 10) / 10);
  }
  for (const x of trace) allShots.push({ ...x, game: g, mission: setup.mission });
  const ol = orderResults(game.world).list;
  for (const o of ol) ordersTally[o.team as 'west' | 'east'][o.status === 'done' ? 0 : 1]++;
  const of = (team: string) => `${ol.filter((o) => o.team === team && o.status === 'done').length}/${ol.filter((o) => o.team === team).length}`;
  const r = game.summary();
  results.push(r);
  const convoyHit = (id: string | undefined) => { const s = game.world.ships.find((x) => x.id === id); return !!s && isConvoyShip(s); };
  // events accumulate over the game; a Set counts each event object once
  const mineHits = new Set(game.world.events.filter((e) => e.kind === 'mine' && e.what === 'detonated' && convoyHit(e.shipId))).size;
  const pm = perMission.get(setup.mission) ?? { w: 0, e: 0, mineHits: 0 };
  pm[r.winner === 'west' ? 'w' : 'e']++;
  pm.mineHits += mineHits;
  perMission.set(setup.mission, pm);
  // Convoy merchants sunk by a surface ship (the patrol ship's missiles), not by the boats
  const byShip = (id: string | undefined) => game.world.ships.find((x) => x.id === id);
  const ssmSunk = game.world.events.filter((e) => e.kind === 'sunk' && convoyHit(e.shipId) && byShip(e.byId)?.team === 'east' && !CLASSES[byShip(e.byId)!.cls].submarine).length;
  const shots = (what: string) => game.world.events.filter((e) => e.kind === 'weapon' && e.what === what).length;
  console.log(
    `${setup.mission.padEnd(9)} ${r.winner.padEnd(4)} ${String(r.minutes).padStart(4)} min | Erstkontakt W ${first.west ?? '—'} O ${first.east ?? '—'} | Erster Schuss W ${fs.west ?? '—'} O ${fs.east ?? '—'} | Frachter ${r.merchantsSunk} (FK ${ssmSunk}) | U-Boote ${r.subsLost} | Eskorten ${r.escortsLost}` +
      ` | Torpedos ${r.torpedoes} Raketen ${shots('rocket')} Bojen ${shots('buoy')} SSM ${shots('ssm')}/${game.world.events.filter((e) => e.kind === 'hit' && game.world.ships.find((x) => x.id === e.byId)?.cls === 'ffk' && !CLASSES[game.world.ships.find((x) => x.id === e.shipId)?.cls ?? 'ssn'].submarine).length} Funk ${game.world.events.filter((e) => e.kind === 'transmission').length}` +
      ` | FK ${game.world.events.filter((e) => e.kind === 'airdef' && e.what === 'launch').length}/${game.world.events.filter((e) => e.kind === 'airdef' && e.what === 'kill').length} Minen ${game.world.env.mines?.mines.length ?? 0}/${game.world.events.filter((e) => e.kind === 'mine' && e.what === 'detonated').length}/F${mineHits} | Befehle W ${of('west')} O ${of('east')} | ${r.reason} | ${Date.now() - t0} ms`,
  );
}
const st = seriesStats(results);
console.log(`Bilanz: Westbund ${st.westWins} · Ostpakt ${st.eastWins} · Ø Ortung West ${st.avgDetectWest ?? '—'} m, Ost ${st.avgDetectEast ?? '—'} m | Befehle erfüllt/nicht: W ${ordersTally.west.join('/')} O ${ordersTally.east.join('/')}`);
const median = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : undefined; };
const within = (a: number[], m: number) => a.filter((x) => x <= m).length;
console.log(`Erstkontakt (Seeminuten) Median W ${median(firstAll.west)} O ${median(firstAll.east)} · innerhalb 10 min W ${within(firstAll.west, 10)}/${firstAll.west.length} O ${within(firstAll.east, 10)}/${firstAll.east.length}`);
const mean = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : undefined);
console.log(`Erster Schuss (Seeminuten) Ø W ${mean(firstShot.west)} O ${mean(firstShot.east)} · Median W ${median(firstShot.west)} O ${median(firstShot.east)} · ohne Schuss W ${results.length - firstShot.west.length} O ${results.length - firstShot.east.length} · Kontakt→Schuss Median W ${median(contactToShot.west)} O ${median(contactToShot.east)}`);
for (const wpn of ['torpedo', 'rocket', 'mortar', 'helo', 'ssm'] as const) {
  const l = allShots.filter((x) => x.weapon === wpn);
  if (!l.length) continue;
  const med = (f: (x: ShotTrace) => number | undefined) => { const v = median(l.map(f).filter((x): x is number => x !== undefined)); return v === undefined ? '—' : Math.round(v); };
  const bases = [...new Set(l.map((x) => x.basis))].map((b) => `${b} ${l.filter((x) => x.basis === b).length}`).join(', ');
  console.log(`  ${wpn.padEnd(7)} ${String(l.length).padStart(4)} Schüsse (${bases}) · Median Güte ${med((x) => x.q)} · Entf. ${med((x) => x.range)} m · gehalten ${med((x) => x.held)} s · Plot ${med((x) => x.span)} s · Lösung stabil ${med((x) => x.settled)} s`);
}
const modes = [...new Set(allShots.filter((x) => x.mode).map((x) => `${x.mode}→${x.target ?? '?'}`))];
if (modes.length) console.log(`  Torpedo-Modi: ${modes.map((k) => `${k} ${allShots.filter((x) => `${x.mode}→${x.target ?? '?'}` === k).length}`).join(', ')}`);
if (wakeRuns.length) {
  console.log(`  Kielwassertorpedos ${wakeRuns.length}: ${wakeRuns.filter((r) => r.end?.startsWith('Treffer')).length} Treffer, ${wakeRuns.filter((r) => r.locks.length).length} auf einer Spur, ${wakeRuns.reduce((a, r) => a + r.lost, 0)} Spuren verloren`);
  for (const r of wakeRuns) console.log(`    Partie ${r.game} ${r.id} von ${r.owner}: Spur ${r.locks.join(' → ') || '—'} · verloren ${r.lost} · ${r.end}`);
}
// ARENA_TRACE=file: every AI weapon release as JSON lines
if (process.env.ARENA_TRACE) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.env.ARENA_TRACE, allShots.map((x) => JSON.stringify(x)).join('\n') + '\n');
}
console.log(`Missionen: ${[...perMission].map(([m, p]) => `${m} ${p.w}:${p.e} (Minentreffer Frachter ${p.mineHits})`).join(' · ')}`);
// ARENA_BAND=0.35: fail (exit 1) when the West's share of wins leaves [band, 1 − band] — for the nightly CI run
const band = Number(process.env.ARENA_BAND ?? 0);
const share = results.length ? st.westWins / results.length : 0.5;
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Bot-Arena (${results.length} Partien, ${skill})\n\nWestbund ${st.westWins} : Ostpakt ${st.eastWins} (West ${Math.round(share * 100)} %)${band ? `, erlaubt ${Math.round(band * 100)}–${Math.round((1 - band) * 100)} %` : ''}\n`);
}
if (band && (share < band || share > 1 - band)) {
  console.error(`Balance außerhalb des Bands: West ${Math.round(share * 100)} %`);
  process.exit(1);
}
