/**
 * Bot vs bot arena: plays full matches headless with AI on both sides and prints outcomes.
 * Usage: npx tsx scripts/bot-arena.ts [games] [skill]
 * The match logic lives in apps/server/src/arena.ts (also used by the in-game replay series).
 */
import { ArenaGame, DEFAULT_ARENA, type ArenaSetup } from '../apps/server/src/arena.js';
import { seriesStats } from '../apps/server/src/series.js';
import { CLASSES, isConvoyShip, orderResults } from '../packages/shared/src/index.js';
import type { ScenarioSettings } from '../apps/server/src/scenario.js';

const games = Number(process.argv[2] ?? 6);
const skill = (process.argv[3] ?? 'normal') as ScenarioSettings['botSkill'];
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
for (let g = 0; g < games; g++) {
  const setup: ArenaSetup = { ...DEFAULT_ARENA, mission: missions[g % missions.length]!, botSkill: skill, west: ['ffg', mixed === 'east' ? 'ffg' : mixed ? 'ssw' : mix ? 'ffv' : 'ffg'], east: [mix ? 'ssa' : 'ssk', mixed === 'west' ? 'ssn' : mixed ? 'ffk' : 'ssn'],
    // ARENA_VAR=aus|leicht|stark: per-match variation of positions, route and sea state
    ...(process.env.ARENA_VAR ? { variation: process.env.ARENA_VAR as ArenaSetup['variation'] } : {}),
    // ARENA_SEASON=winter|fruehling|sommer|herbst: fix the month (default: drawn per match)
    ...(process.env.ARENA_SEASON ? { season: process.env.ARENA_SEASON as ArenaSetup['season'] } : {}),
    // ARENA_SCALE=1|2|3: the lobby's time scale (sea time = 40 min × scale; default 1× real time)
    ...(process.env.ARENA_SCALE ? { timeScale: Number(process.env.ARENA_SCALE) } : {}) };
  const t0 = Date.now();
  const game = new ArenaGame(setup, seedBase + g);
  // ARENA_NO_ORDERS=1: without fleet command's FLASH orders (to measure them separately)
  if (process.env.ARENA_NO_ORDERS) game.world.env.orders = undefined;
  // First contact per side (sim minutes): the boats on anything of the convoy, the escorts on an enemy unit
  const first: { west?: number; east?: number } = {};
  while (!game.step(100)) {
    const w = game.world;
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
    `${setup.mission.padEnd(9)} ${r.winner.padEnd(4)} ${String(r.minutes).padStart(4)} min | Erstkontakt W ${first.west ?? '—'} O ${first.east ?? '—'} | Frachter ${r.merchantsSunk} (FK ${ssmSunk}) | U-Boote ${r.subsLost} | Eskorten ${r.escortsLost}` +
      ` | Torpedos ${r.torpedoes} Raketen ${shots('rocket')} Bojen ${shots('buoy')} SSM ${shots('ssm')}/${game.world.events.filter((e) => e.kind === 'hit' && game.world.ships.find((x) => x.id === e.byId)?.cls === 'ffk' && !CLASSES[game.world.ships.find((x) => x.id === e.shipId)?.cls ?? 'ssn'].submarine).length} Funk ${game.world.events.filter((e) => e.kind === 'transmission').length}` +
      ` | FK ${game.world.events.filter((e) => e.kind === 'airdef' && e.what === 'launch').length}/${game.world.events.filter((e) => e.kind === 'airdef' && e.what === 'kill').length} Minen ${game.world.env.mines?.mines.length ?? 0}/${game.world.events.filter((e) => e.kind === 'mine' && e.what === 'detonated').length}/F${mineHits} | Befehle W ${of('west')} O ${of('east')} | ${r.reason} | ${Date.now() - t0} ms`,
  );
}
const st = seriesStats(results);
console.log(`Bilanz: Westbund ${st.westWins} · Ostpakt ${st.eastWins} · Ø Ortung West ${st.avgDetectWest ?? '—'} m, Ost ${st.avgDetectEast ?? '—'} m | Befehle erfüllt/nicht: W ${ordersTally.west.join('/')} O ${ordersTally.east.join('/')}`);
const median = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : undefined; };
const within = (a: number[], m: number) => a.filter((x) => x <= m).length;
console.log(`Erstkontakt (Seeminuten) Median W ${median(firstAll.west)} O ${median(firstAll.east)} · innerhalb 10 min W ${within(firstAll.west, 10)}/${firstAll.west.length} O ${within(firstAll.east, 10)}/${firstAll.east.length}`);
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
