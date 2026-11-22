/**
 * Bot vs bot arena: plays full matches headless with AI on both sides and prints outcomes.
 * Usage: npx tsx scripts/bot-arena.ts [games] [skill]
 * The match logic lives in apps/server/src/arena.ts (also used by the in-game replay series).
 */
import { ArenaGame, DEFAULT_ARENA, type ArenaSetup } from '../apps/server/src/arena.js';
import { seriesStats } from '../apps/server/src/series.js';
import type { ScenarioSettings } from '../apps/server/src/scenario.js';

const games = Number(process.argv[2] ?? 6);
const skill = (process.argv[3] ?? 'normal') as ScenarioSettings['botSkill'];
const missions = (process.env.ARENA_MISSIONS?.split(',') ?? ['groenland', 'schelf', 'fjord']) as ScenarioSettings['mission'][];
// ARENA_MIX=1: the newer classes (VDS frigate, AIP boat) take the second slot of each side
const mix = !!process.env.ARENA_MIX;
const results = [];
for (let g = 0; g < games; g++) {
  const setup: ArenaSetup = { ...DEFAULT_ARENA, mission: missions[g % missions.length]!, botSkill: skill, west: ['ffg', mix ? 'ffv' : 'ffg'], east: [mix ? 'ssa' : 'ssk', 'ssn'] };
  const t0 = Date.now();
  const game = new ArenaGame(setup, 1000 + g);
  while (!game.step(1000));
  const r = game.summary();
  results.push(r);
  const shots = (what: string) => game.world.events.filter((e) => e.kind === 'weapon' && e.what === what).length;
  console.log(
    `${setup.mission.padEnd(9)} ${r.winner.padEnd(4)} ${String(r.minutes).padStart(4)} min | Frachter ${r.merchantsSunk} | U-Boote ${r.subsLost} | Eskorten ${r.escortsLost}` +
      ` | Torpedos ${r.torpedoes} Raketen ${shots('rocket')} Bojen ${shots('buoy')} Funk ${game.world.events.filter((e) => e.kind === 'transmission').length} | ${r.reason} | ${Date.now() - t0} ms`,
  );
}
const st = seriesStats(results);
console.log(`Bilanz: Westbund ${st.westWins} · Ostpakt ${st.eastWins} · Ø Ortung West ${st.avgDetectWest ?? '—'} m, Ost ${st.avgDetectEast ?? '—'} m`);
