import { describe, expect, it } from 'vitest';
import {
  KN, PERISCOPE_DEPTH, createShip, createWorld, crewOf, crewPerformance, emergencyBlow, fireTorpedo, installAir, installBoats,
  installWeapons, runSensors, Rng, sendMad, sourceLevel, stepWorld, type Environment,
} from '../src/index.js';

const env: Environment = { layerDepth: 0, layerLoss: 0, seaState: 2, light: 1 };
const run = (w: ReturnType<typeof createWorld>, secs: number) => { for (let i = 0; i < secs * 10; i++) stepWorld(w); };

function world(depth = 100, cls: 'ssk' | 'ssn' = 'ssk') {
  const u = createShip({ id: 'u', cls, name: 'U', pos: { x: 0, y: 0 }, heading: 0, speedKn: 4, depth, team: 'east' });
  const f = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 8000, y: 0 }, heading: 0, speedKn: 10, team: 'west' });
  const w = createWorld([u, f], 5, env);
  installWeapons(w);
  installAir(w);
  installBoats(w);
  return { w, u, f };
}

describe('crew and boat systems', () => {
  it('battle stations sharpen the crew but tire it out', () => {
    const { w, u } = world();
    crewOf(u).battle = true;
    const fresh = crewPerformance(u);
    expect(fresh).toBeGreaterThan(1);
    run(w, 5400);
    expect(crewOf(u).fatigue).toBeGreaterThan(0.8);
    expect(crewPerformance(u)).toBeLessThan(fresh * 0.85);
  });

  it('air goes foul in a closed-up diesel boat; stores and snorkeling help', () => {
    const { w, u } = world();
    const a = u.air!;
    a.scrubbers = 0;
    a.candles = 0;
    const co2 = a.co2;
    run(w, 3600);
    expect(u.air!.co2).toBeGreaterThan(co2 + 0.8);
    // Nuclear boats make their own air
    expect(world(100, 'ssn').u.air).toBeUndefined();
  });

  it('dead reckoning drifts while deep and is corrected by a fix at the mast', () => {
    const { w, u } = world();
    w.env.current = { x: 0.15, y: 0 };
    run(w, 1800);
    const err = Math.hypot(u.drErr!.x, u.drErr!.y);
    expect(err).toBeGreaterThan(150);
    u.order.depth = PERISCOPE_DEPTH;
    u.depth = PERISCOPE_DEPTH;
    u.mastUp = true;
    run(w, 90);
    expect(Math.hypot(u.drErr!.x, u.drErr!.y)).toBeLessThan(err * 0.2);
  });

  it('an emergency blow costs a bottle and brings the boat up fast and loud', () => {
    const { w, u } = world(150);
    expect(emergencyBlow(w, u)).toBe(true);
    expect(u.hpAir).toBe(2);
    run(w, 20);
    expect(u.depth).toBeLessThan(90);
    expect(w.events.some((e) => e.kind === 'transient' && e.what === 'blow')).toBe(true);
  });

  it('below test depth things start to break', () => {
    const { w, u } = world(300 * 1.3);
    u.order.depth = 300 * 1.3;
    run(w, 600);
    expect(w.events.some((e) => e.kind === 'boat' && (e.what === 'hull' || e.what === 'crush'))).toBe(true);
  });

  it('a hard turn at speed leaves a knuckle that returns a false echo', () => {
    const { w, f } = world();
    f.speed = 20 * KN;
    f.order.speedKn = 20;
    f.order.heading = 120;
    run(w, 20);
    const k = w.weapons!.decoys.find((d) => d.knuckle);
    expect(k).toBeDefined();
    const pinger = createShip({ id: 'p', cls: 'ffg', name: 'P', pos: { x: k!.pos.x - 2000, y: k!.pos.y }, heading: 90, team: 'west' });
    const dets = runSensors({ ships: [pinger], env, time: 1, rng: new Rng(2), knuckles: [k!] });
    void dets;
    pinger.activeSonar = true;
    const echoes = runSensors({ ships: [pinger], env, time: 100, rng: new Rng(3), knuckles: [k!] }).filter((d) => d.targetId === k!.id);
    expect(echoes[0]?.dopplerKn).toBe(0);
  });

  it('MAD finds a boat right under the helicopter', () => {
    const { w, u, f } = world(60);
    u.order.speedKn = 0;
    u.speed = 0;
    expect(sendMad(w, f, { x: 0, y: 0 })).toBe(true);
    run(w, 400);
    expect(w.books.get('f')?.entries().some(([id, tr]) => id === 'u' && tr.sensors.includes('mad'))).toBe(true);
  });

  it('silent running quiets the boat; a torpedo shot needs trimming', () => {
    const { w, u } = world();
    const before = u.trim ?? 0;
    const quiet = () => { const x = createShip({ id: 'x', cls: 'ssk', name: 'X', pos: { x: 0, y: 0 }, heading: 0, speedKn: 4, depth: 100 }); return x; };
    fireTorpedo(w, u, { heading: 90, enableAfter: 2000, mode: 'passive', searchDepth: 100, speedKn: 30 });
    run(w, 0.5);
    expect(u.trim!).toBeGreaterThan(before + 1);
    run(w, 70);
    expect(Math.abs(u.trim!)).toBeLessThan(0.1);
    const a = quiet();
    const b = quiet();
    crewOf(b).silent = true;
    expect(sourceLevel(b)).toBeLessThan(sourceLevel(a) - 2);
  });
});
