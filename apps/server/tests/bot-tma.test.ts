import { describe, expect, it } from 'vitest';
import { KN, botSolve, type BotFix, angleDiff, bearing, createShip, createWorld, headingVec, installWeapons, stepWorld, targetPosAt, type OwnFix, type TmaSolution } from '@tk/shared';
import { BotCrew } from '../src/bots/index.js';

/** Bins of a straight-running target seen from an own ship on alternating legs. */
function plot(truth: TmaSolution, legs: number[], legS: number, noise: number, seed = 1): BotFix[] {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const fx: BotFix[] = [];
  let x = 0;
  let y = 0;
  for (let t = 0; t < legs.length * legS; t += 10) {
    fx.push({ t, b: (bearing({ x, y }, targetPosAt(truth, t)) + gauss() * noise + 360) % 360, ox: x, oy: y, n: 10 });
    const v = headingVec(legs[Math.floor(t / legS)]!);
    x += v.x * 5 * KN * 10;
    y += v.y * 5 * KN * 10;
  }
  return fx;
}

describe('bot TMA', () => {
  const truth: TmaSolution = { t0: 0, x0: 6000, y0: 9000, course: 0, speedKn: 9 };

  it('one leg only: the range is unobservable and the quality says so', () => {
    const fit = botSolve(plot(truth, [60, 60], 180, 0.3), 14, 'merchant')!;
    expect(fit.q).toBeLessThan(40);
  });

  it('legs across the line of sight pin down course and speed', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const fit = botSolve(plot(truth, [20, 100, 20, 100, 20], 180, 0.3, seed), 14, 'merchant')!;
      expect(Math.abs(angleDiff(fit.sol.course, truth.course))).toBeLessThan(15);
      expect(Math.abs(fit.sol.speedKn - 9)).toBeLessThan(2.5);
      expect(fit.q).toBeGreaterThan(50);
    }
  });

  it('a bot SSK solves a straight-running merchant within 25° after a few legs', () => {
    const sub = createShip({ id: 'p_e1', cls: 'ssk', name: 'U', team: 'east', pos: { x: 0, y: 0 }, heading: 90, speedKn: 4, depth: 60 });
    const merchant = createShip({ id: 'm1', cls: 'merchant', name: 'Frachter', pos: { x: 7000, y: -3000 }, heading: 0, speedKn: 9 });
    const w = createWorld([sub, merchant], 7, { layerDepth: 150, layerLoss: 12, seaState: 2 });
    installWeapons(w);
    // Shadowing only: no shots, so the merchant keeps running straight
    w.env.weaponsTight = 'east';
    const crew = new BotCrew('normal');
    crew.add('p_e1');
    const errs: number[] = [];
    for (let i = 0; i < 20 * 60 * 10; i++) {
      stepWorld(w);
      crew.step(w);
      if (i % 600 === 0 && w.time > 12 * 60) {
        const mem = crew.toJSON().bots[0]!;
        const sol = Object.values(mem.sols).sort((a, b) => b.at - a.at)[0];
        if (sol && sol.q >= 40) errs.push(Math.abs(angleDiff(sol.sol.course, 0)));
      }
    }
    expect(errs.length).toBeGreaterThan(3);
    expect(Math.max(...errs)).toBeLessThan(25);
  });
});
