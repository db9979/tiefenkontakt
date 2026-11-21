/**
 * Load test: a full 6-vs-6 match with 8 merchants, all AI, on every mission.
 * Prints the cost of one server tick (10 Hz × time scale 3 sim steps + AI) and the
 * share spent in the sensor cycle. Usage: npx tsx scripts/load-test.ts [simMinutes]
 */
import { runSensors, stepWorld, type PlayerSlot } from '../packages/shared/src/index.js';
import { BotCrew } from '../apps/server/src/bots/index.js';
import { DEFAULT_SETTINGS, buildScenario, type ScenarioSettings } from '../apps/server/src/scenario.js';

const minutes = Number(process.argv[2] ?? 20);
const slots: PlayerSlot[] = [];
for (let i = 0; i < 6; i++) slots.push({ playerId: `bot-w${i}`, callsign: `W${i}`, team: 'west', cls: 'ffg', ready: true, bot: true });
for (let i = 0; i < 6; i++) slots.push({ playerId: `bot-e${i}`, callsign: `E${i}`, team: 'east', cls: i % 2 ? 'ssn' : 'ssk', ready: true, bot: true });

for (const mission of ['groenland', 'schelf', 'fjord'] as ScenarioSettings['mission'][]) {
  const settings = { ...DEFAULT_SETTINGS, mission };
  const w = buildScenario(slots, settings, 4242);
  const crew = new BotCrew('normal');
  for (const s of slots) crew.add(`p_${s.playerId}`);
  const steps = minutes * 60 * 10;
  let worst = 0;
  let sensorMs = 0;
  const t0 = performance.now();
  for (let i = 0; i < steps; i += settings.timeScale) {
    const a = performance.now();
    for (let k = 0; k < settings.timeScale; k++) {
      stepWorld(w);
      crew.step(w);
    }
    worst = Math.max(worst, performance.now() - a);
  }
  const total = performance.now() - t0;
  // Sensor cycle alone, measured separately on the end state
  const s0 = performance.now();
  for (let i = 0; i < 50; i++) runSensors({ ships: w.ships, env: w.env, time: w.time, rng: w.rng });
  sensorMs = (performance.now() - s0) / 50;
  const ticks = steps / settings.timeScale;
  const perTick = total / ticks;
  console.log(`${mission.padEnd(9)} Schiffe ${w.ships.length} | Tick Ø ${perTick.toFixed(2)} ms, max ${worst.toFixed(1)} ms | Sensorzyklus ${sensorMs.toFixed(2)} ms | ` +
    `Budget 100 ms → ca. ${Math.floor(100 / perTick)} Partien parallel`);
}

// Network side: a real Match with 12 connected players, measuring tick time incl. snapshots and bytes per player
import { Lobby } from '../apps/server/src/lobby.js';
{
  const lobby = new Lobby();
  const bytes: Record<string, number> = {};
  const conns = Array.from({ length: 12 }, (_, i) => ({
    playerId: `p${i}`, callsign: `P${i}`,
    // Same wire format as the server: two decimals
    send: (m: unknown) => { bytes[`p${i}`] = (bytes[`p${i}`] ?? 0) + JSON.stringify(m, (_k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v)).length; },
  }));
  for (const c of conns) { lobby.connect(c); lobby.resume(c); }
  lobby.handle(conns[0]!, { t: 'create_match', name: 'Last' });
  const m = lobby.matchOf('p0')!;
  conns.forEach((c, i) => { if (i) lobby.handle(c, { t: 'join', matchId: m.id, team: i < 6 ? 'west' : 'east' }); });
  conns.forEach((c, i) => { if (i >= 6) lobby.handle(c, { t: 'pick_class', cls: i % 2 ? 'ssn' : 'ssk' }); });
  for (const c of conns) lobby.handle(c, { t: 'ready', ready: true });
  m.stop();
  for (let i = 0; i < 3000; i++) m.tick(); // warm-up: contacts and histories fill up
  for (const k of Object.keys(bytes)) bytes[k] = 0;
  const t0 = performance.now();
  const N = 600;
  let worst = 0;
  for (let i = 0; i < N; i++) { const a = performance.now(); m.tick(); worst = Math.max(worst, performance.now() - a); }
  const per = (performance.now() - t0) / N;
  const kbps = Object.values(bytes).map((b) => (b / (N / 10)) / 1024);
  console.log(`Match 12 Spieler: Tick Ø ${per.toFixed(2)} ms, max ${worst.toFixed(1)} ms | Datenrate je Spieler Ø ${(kbps.reduce((a, b) => a + b, 0) / kbps.length).toFixed(0)} KB/s, max ${Math.max(...kbps).toFixed(0)} KB/s`);
}
