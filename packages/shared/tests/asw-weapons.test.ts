import { describe, expect, it } from 'vitest';
import {
  createLoadout,
  createShip,
  createWorld,
  distance,
  dropDepthCharge,
  dropLightweight,
  fireTorpedo,
  installWeapons,
  launchAswRocket,
  lightSearchDepths,
  stepWorld,
  type Torpedo,
} from '../src/index.js';

function frigate(btLayer?: number) {
  const ffg = createShip({ id: 'f1', cls: 'ffg', name: 'F1', pos: { x: 0, y: 0 }, heading: 0, speedKn: 10 });
  ffg.btLayer = btLayer;
  const w = createWorld([ffg], 11);
  installWeapons(w);
  return { w, ffg };
}

describe('ASW rocket (C10)', () => {
  it('has a minimum range of 1.8 km', () => {
    const { w, ffg } = frigate();
    expect(launchAswRocket(w, ffg, { x: 0, y: 1500 })).toBe('Ziel zu nah: U-Jagd-Rakete erst ab 1,8 km');
    expect(launchAswRocket(w, ffg, { x: 0, y: 2000 })).toBe(true);
  });

  it('scatters the drop point about 150 m around the aim', () => {
    const { w, ffg } = frigate();
    w.weapons!.loadouts.get('f1')!.rockets = 200;
    const aim = { x: 0, y: 8000 };
    for (let i = 0; i < 200; i++) launchAswRocket(w, ffg, aim);
    const miss = w.weapons!.pending.map((e) => distance(e.pos, aim));
    const rms = Math.sqrt(miss.reduce((a, d) => a + d * d, 0) / miss.length);
    // Two axes of σ 150 m: radial RMS ≈ 212 m
    expect(rms).toBeGreaterThan(160);
    expect(rms).toBeLessThan(270);
  });
});

describe('lightweight search depth from the measured layer (C10)', () => {
  it('searches just above the layer and 40 m below it', () => {
    expect(lightSearchDepths(90)).toEqual([40, 130]);
    expect(lightSearchDepths(35)).toEqual([25, 75]);
    expect(lightSearchDepths(undefined)).toEqual([40, 120]);
  });

  it('a dropped torpedo (rocket, helicopter) alternates between the two depths', () => {
    const { w } = frigate(100);
    dropLightweight(w, 'f1', { x: 0, y: 8000 });
    const t = w.weapons!.torpedoes[0] as Torpedo;
    expect(t.searchDepths).toEqual([40, 140]);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      stepWorld(w);
      seen.add(t.searchDepth);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([40, 140]);
  });

  it('a torpedo from the ship tubes takes the same depths', () => {
    const { w, ffg } = frigate(70);
    const t = fireTorpedo(w, ffg, { heading: 0, searchDepth: 300 }) as Torpedo;
    expect(t.kind).toBe('light');
    expect(t.searchDepths).toEqual([40, 110]);
    expect(t.searchDepth).toBe(40);
  });
});

describe('frigate tubes and mortar (C10)', () => {
  it('six tubes ready, a reload takes 15 minutes', () => {
    for (const cls of ['ffg', 'ffv', 'ffk'] as const) {
      const l = createLoadout(cls);
      expect(l.tubes.filter((t) => t.loaded)).toHaveLength(6);
      expect(l.reloadTime).toBe(900);
    }
    const { w, ffg } = frigate();
    for (let i = 0; i < 6; i++) expect(typeof fireTorpedo(w, ffg, { heading: 0 })).not.toBe('string');
    expect(fireTorpedo(w, ffg, { heading: 0 })).toBe('Kein Rohr geladen');
    for (let i = 0; i < 8000; i++) stepWorld(w);
    expect(w.weapons!.loadouts.get('f1')!.tubes.some((t) => t.loaded)).toBe(false);
    for (let i = 0; i < 1200; i++) stepWorld(w);
    expect(w.weapons!.loadouts.get('f1')!.tubes.some((t) => t.loaded)).toBe(true);
  });

  it('the salvo is laid 400–800 m ahead on the own heading; lethal within 20 m', () => {
    const ffg = createShip({ id: 'f1', cls: 'ffg', name: 'F1', pos: { x: 0, y: 0 }, heading: 90 });
    const u = createShip({ id: 'u1', cls: 'ssk', name: 'U1', pos: { x: 400, y: -40 }, heading: 0, depth: 80 });
    const w = createWorld([ffg, u], 3);
    installWeapons(w);
    expect(dropDepthCharge(w, ffg, 80)).toBe(true);
    const ps = w.weapons!.pending;
    expect(ps.length).toBeGreaterThan(3);
    for (const e of ps) {
      expect(e.pos.x).toBeGreaterThanOrEqual(400 - 1e-6);
      expect(e.pos.x).toBeLessThanOrEqual(800 + 1e-6);
      expect(Math.abs(e.pos.y)).toBeLessThanOrEqual(40 + 1e-6);
    }
    // A boat 15 m from one of the charges, at the fused depth
    u.pos = { x: ps[1]!.pos.x + 15, y: ps[1]!.pos.y };
    for (let i = 0; i < 300; i++) stepWorld(w);
    expect(u.alive).toBe(false);
    // One salvo used
    expect(w.weapons!.loadouts.get('f1')!.depthCharges).toBe(createLoadout('ffg').depthCharges - 1);
  });
});
