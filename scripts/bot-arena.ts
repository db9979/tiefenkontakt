/**
 * Bot vs bot arena: plays full matches headless with AI on both sides and prints outcomes.
 * Usage: npx tsx scripts/bot-arena.ts [games] [skill]
 */
import { orderResults, stepWorld, type PlayerSlot, type World } from '../packages/shared/src/index.js';
import { BotCrew } from '../apps/server/src/bots/index.js';
import { evaluate } from '../apps/server/src/rules.js';
import { DEFAULT_SETTINGS, buildScenario, simTimeLimit, type ScenarioSettings } from '../apps/server/src/scenario.js';

const games = Number(process.argv[2] ?? 6);
const skill = (process.argv[3] ?? 'normal') as ScenarioSettings['botSkill'];
const missions = (process.env.ARENA_MISSIONS?.split(',') ?? ['groenland', 'schelf', 'fjord']) as ScenarioSettings['mission'][];
const slots: PlayerSlot[] = [
  { playerId: 'bot-w1', callsign: 'W1', team: 'west', cls: 'ffg', ready: true, bot: true },
  // ARENA_MIX=1: the newer classes (VDS frigate, AIP boat) take the second slot of each side
  { playerId: 'bot-w2', callsign: 'W2', team: 'west', cls: process.env.ARENA_MIX ? 'ffv' : 'ffg', ready: true, bot: true },
  { playerId: 'bot-e1', callsign: 'E1', team: 'east', cls: process.env.ARENA_MIX ? 'ssa' : 'ssk', ready: true, bot: true },
  { playerId: 'bot-e2', callsign: 'E2', team: 'east', cls: 'ssn', ready: true, bot: true },
];
const tally = { west: 0, east: 0 };
const ordersTally = { west: [0, 0], east: [0, 0] };
for (let g = 0; g < games; g++) {
  const settings = { ...DEFAULT_SETTINGS, mission: missions[g % missions.length]!, botSkill: skill };
  const w: World = buildScenario(slots, settings, 1000 + g);
  // ARENA_NO_ORDERS=1: without fleet command's FLASH orders (to measure them separately)
  if (process.env.ARENA_NO_ORDERS) w.env.orders = undefined;
  const crew = new BotCrew(skill);
  for (const s of slots) crew.add(`p_${s.playerId}`);
  const limit = simTimeLimit(settings);
  let result;
  const t0 = Date.now();
  while (!(result = evaluate(w, limit))) {
    stepWorld(w);
    crew.step(w);
  }
  const ev = (k: string) => w.events.filter((e) => e.kind === k).length;
  const subsSunk = w.ships.filter((s) => s.team === 'east' && !s.alive).length;
  const escortsSunk = w.ships.filter((s) => s.cls === 'ffg' && !s.alive).length;
  const merchSunk = w.ships.filter((s) => s.cls === 'merchant' && !s.alive).length;
  const shots = w.events.filter((e) => e.kind === 'weapon');
  tally[result.winner]++;
  const orders = () => {
    const r = orderResults(w).list;
    const f = (team: string) => `${r.filter((o) => o.team === team && o.status === 'done').length}/${r.filter((o) => o.team === team).length}`;
    for (const o of r) ordersTally[o.team][o.status === 'done' ? 0 : 1]++;
    return `W ${f('west')} O ${f('east')}`;
  };
  console.log(
    `${settings.mission.padEnd(9)} ${result.winner.padEnd(4)} ${(w.time / 60).toFixed(0).padStart(4)} min | Frachter ${merchSunk} | U-Boote ${subsSunk} | Eskorten ${escortsSunk}` +
      ` | Torpedos ${shots.filter((e) => e.kind === 'weapon' && e.what === 'torpedo').length} Raketen ${shots.filter((e) => e.kind === 'weapon' && e.what === 'rocket').length}` +
      ` Bojen ${shots.filter((e) => e.kind === 'weapon' && e.what === 'buoy').length} Funk ${ev('transmission')} | Befehle ${orders()} | ${result.reason} | ${Date.now() - t0} ms`,
  );
}
console.log(`Bilanz: Westbund ${tally.west} · Ostpakt ${tally.east} | Befehle erfüllt/nicht: W ${ordersTally.west.join('/')} O ${ordersTally.east.join('/')}`);
