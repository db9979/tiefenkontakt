import { describe, expect, it } from 'vitest';
import {
  SAM_SPECS, airDefFor, callFighter, createShip, createWorld, fireSam, hitChance, inEnvelope, installAirspace, installWeapons,
  samsLeft, stepAirDefense, stepAirspace, FIGHTER_DELAY_S, type World,
} from '../src/index.js';

function scene(reconAt = { x: 0, y: 20_000 }, alt = 1500, seed = 5): World {
  const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0, speedKn: 12 });
  const kor = createShip({ id: 'k', cls: 'kor', name: 'K', pos: { x: 3000, y: 0 }, heading: 0, speedKn: 12 });
  const m = createShip({ id: 'm', cls: 'merchant', name: 'M', pos: { x: 0, y: 0 }, heading: 0, speedKn: 0 });
  const sub = createShip({ id: 'u', cls: 'ssk', name: 'U', team: 'east', pos: { x: 30_000, y: 0 }, heading: 0, speedKn: 0, depth: 60 });
  const w = createWorld([ffg, kor, m, sub], seed, { layerDepth: 120, layerLoss: 12, seaState: 2, light: 1 });
  installWeapons(w);
  installAirspace(w);
  w.env.airspace!.planes = [{ id: 'R1', kind: 'recon', team: 'east', pos: { ...reconAt }, alt, heading: 180, speedKn: 330, radar: true, orbit: { x: 0, y: 0 } }];
  w.env.airspace!.nextRecon = 1e9;
  w.env.airspace!.nextCivil = 1e9;
  return w;
}

const run = (w: World, s: number) => {
  for (let t = 0; t < s; t += 0.1) {
    w.time += 0.1;
    stepAirspace(w, 0.1);
    stepAirDefense(w, 0.1);
  }
};

describe('escort air defence', () => {
  it('envelopes: the F-12 reaches far and high, the corvette only close and low', () => {
    const ffg = SAM_SPECS.ffg!;
    const kor = SAM_SPECS.kor!;
    expect(inEnvelope(ffg, 25_000, 6000)).toBe(true);
    expect(inEnvelope(kor, 25_000, 1500)).toBe(false);
    expect(inEnvelope(kor, 8000, 6000)).toBe(false);
    expect(inEnvelope(kor, 8000, 1500)).toBe(true);
    expect(inEnvelope(ffg, 1000, 1500)).toBe(false);
  });

  it('hit chance falls with range, very low altitude and a jinking target', () => {
    const s = SAM_SPECS.ffg!;
    const close = hitChance(s, 8000, 1500, false);
    expect(close).toBeCloseTo(s.pk);
    expect(hitChance(s, 30_000, 1500, false)).toBeLessThan(close * 0.7);
    expect(hitChance(s, 8000, 100, false)).toBeLessThan(close);
    expect(hitChance(s, 8000, 1500, true)).toBeLessThan(close * 0.75);
    expect(hitChance(s, 50_000, 1500, false)).toBe(0);
  });

  it('needs the own radar track and a hostile target in the envelope', () => {
    const w = scene();
    const ffg = w.ships[0]!;
    expect(fireSam(w, ffg, 'R1')).toMatch(/Radar/);
    ffg.radarOn = true;
    const kor = w.ships[1]!;
    kor.radarOn = true;
    expect(fireSam(w, kor, 'R1')).toMatch(/Reichweite/);
    expect(fireSam(w, ffg, 'R1')).toBe(true);
    expect(samsLeft(w, ffg)).toBe(SAM_SPECS.ffg!.magazine - 1);
    expect(fireSam(w, ffg, 'R1')).toMatch(/Starter/);
    // The launch is a transient the boats can hear, and the aircraft breaks away
    expect(w.events.some((e) => e.kind === 'transient' && e.what === 'sam')).toBe(true);
    expect(w.env.airspace!.planes[0]!.evadeUntil).toBeGreaterThan(w.time);
    expect(airDefFor(w, ffg)!.missiles).toHaveLength(1);
  });

  it('the missile flies for a while, then hits or misses; a downed recon never reports and the next one stays far out', () => {
    let kills = 0;
    let shots = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const w = scene({ x: 0, y: 15_000 }, 1500, seed);
      // Convoy well behind the frigate: the recon is still short of its identification range
      w.ships[2]!.pos = { x: 0, y: -15_000 };
      const ffg = w.ships[0]!;
      ffg.radarOn = true;
      expect(fireSam(w, ffg, 'R1')).toBe(true);
      shots++;
      run(w, 5);
      // Time of flight: 15 km at 750 m/s takes about 20 s
      expect(w.events.some((e) => e.kind === 'airdef' && (e.what === 'kill' || e.what === 'miss'))).toBe(false);
      run(w, 60);
      const kill = w.events.some((e) => e.kind === 'airdef' && e.what === 'kill');
      const done = kill || w.events.some((e) => e.kind === 'airdef' && e.what === 'miss');
      expect(done).toBe(true);
      if (kill) {
        kills++;
        expect(w.env.airspace!.planes.some((p) => p.id === 'R1')).toBe(false);
        expect(w.env.airdef!.reconLosses).toBe(1);
        run(w, 1200);
        expect(w.events.some((e) => e.kind === 'recon')).toBe(false);
        // The next recon flight keeps a stand-off orbit, high up
        w.env.airspace!.nextRecon = 0;
        run(w, 1);
        const next = w.env.airspace!.planes.find((p) => p.kind === 'recon');
        if (next) {
          expect(next.standoff).toBeGreaterThan(20_000);
          expect(next.alt).toBeGreaterThanOrEqual(6000);
        }
      }
    }
    // Head-on, mid envelope, evading: roughly 0.45 per shot
    expect(kills / shots).toBeGreaterThan(0.2);
    expect(kills / shots).toBeLessThan(0.8);
  });

  it('interceptors take minutes, then catch the recon if it is still about', () => {
    const w = scene({ x: 0, y: 40_000 }, 6000);
    const ffg = w.ships[0]!;
    ffg.radarOn = true;
    expect(callFighter(w, ffg)).toBe(true);
    expect(callFighter(w, ffg)).toMatch(/Einsatz/);
    // Keep the aircraft in the area (orbiting far out)
    w.env.airspace!.planes[0]!.standoff = 40_000;
    w.env.airspace!.planes[0]!.orbitUntil = 1e9;
    run(w, FIGHTER_DELAY_S - 5);
    expect(w.env.airspace!.planes.some((p) => p.id === 'R1')).toBe(true);
    run(w, 400);
    expect(w.events.some((e) => e.kind === 'airdef' && e.what === 'fighter_kill')).toBe(true);
  });
});
