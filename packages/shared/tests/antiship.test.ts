import { describe, expect, it } from 'vitest';
import { createShip, createWorld, fireSsm, installWeapons, ssmLeft, stepAntiShip } from '../src/index.js';

function setup(escortRadar: boolean | undefined) {
  const ffk = createShip({ id: 'p', cls: 'ffk', name: 'P', pos: { x: 0, y: 0 }, heading: 0, team: 'east' });
  const ship = createShip({ id: 'm', cls: 'merchant', name: 'M', pos: { x: 0, y: 20_000 }, heading: 90, team: 'west' });
  const ships = [ffk, ship];
  if (escortRadar !== undefined) {
    const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 800, y: 19_000 }, heading: 90, team: 'west' });
    ffg.radarOn = escortRadar;
    ships.push(ffg);
  }
  const w = createWorld(ships, 7, { layerDepth: 0, layerLoss: 0, seaState: 2 });
  installWeapons(w);
  return { w, ffk, ship };
}

function fly(w: ReturnType<typeof setup>['w']) {
  for (let i = 0; i < 1200 && w.env.ssm?.missiles.some((m) => !m.done); i++) {
    w.time += 0.1;
    stepAntiShip(w, 0.1);
  }
}

describe('anti-ship missiles', () => {
  it('a round homes on the merchant and hits', () => {
    const { w, ffk, ship } = setup(undefined);
    expect(fireSsm(w, ffk, { x: 0, y: 19_000 })).toBe(true);
    fly(w);
    expect(w.env.ssm!.missiles[0]!.done).toBe('hit');
    expect(ship.hp).toBeLessThan(110);
    expect(ssmLeft(w, ffk)).toBe(7);
  });

  it('limits: range, launcher cycle, no launcher on other classes', () => {
    const { w, ffk } = setup(undefined);
    expect(fireSsm(w, ffk, { x: 0, y: 2000 })).toMatch(/zu nah/);
    expect(fireSsm(w, ffk, { x: 0, y: 60_000 })).toMatch(/zu weit/);
    expect(fireSsm(w, ffk, { x: 0, y: 19_000 })).toBe(true);
    expect(fireSsm(w, ffk, { x: 0, y: 19_000 })).toMatch(/lädt nach/);
    const ffg = createShip({ id: 'g', cls: 'ffg', name: 'G', pos: { x: 0, y: 0 }, heading: 0, team: 'west' });
    expect(fireSsm(w, ffg, { x: 0, y: 19_000 })).toMatch(/Keine/);
  });

  it('an escort with its radar on shoots rounds down more often than one without', () => {
    const rate = (radar: boolean) => {
      let shot = 0;
      for (let seed = 0; seed < 40; seed++) {
        const { w, ffk } = setup(radar);
        w.rng = createWorld([], seed + 1).rng;
        fireSsm(w, ffk, { x: 0, y: 19_000 });
        fly(w);
        if (w.env.ssm!.missiles[0]!.done === 'shot') shot++;
      }
      return shot;
    };
    expect(rate(true)).toBeGreaterThan(rate(false));
  });
});
