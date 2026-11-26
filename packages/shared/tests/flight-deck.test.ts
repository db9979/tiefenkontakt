import { describe, expect, it } from 'vitest';
import {
  CIRCLE_R, HELO_LAUNCH_PREP_S, KN, LAUNCH_ON_COURSE_S, RECOVERY_S, angleDiff, buoyPoints, createShip, createWorld, distance, domeDepthAt, dipTimeline,
  flyingCourse, heloOf, heloOrder, heloView, initMet, installAir, installWeapons, nearestFlyingCourse, relativeWind, stepWorld, trueWind, type World,
} from '../src/index.js';

/** A frigate in a world with weather: wind from `from` (game frame) at the sea state's strength. */
function world(from: number, seaState = 3, heading = 0, speedKn = 12) {
  const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading, speedKn });
  const w = createWorld([ffg], 5, { layerDepth: 120, layerLoss: 12, seaState });
  w.env.met = initMet([ffg], 5, { dynamic: false, ice: false, fogBanks: 0 });
  const a = ((from + 180) * Math.PI) / 180;
  w.env.met.wind = { x: Math.sin(a) * 5, y: Math.cos(a) * 5 };
  installWeapons(w);
  installAir(w);
  return { w, ffg };
}
const run = (w: World, s: number, until?: () => boolean) => {
  for (let i = 0; i < s * 10 && !until?.(); i++) stepWorld(w);
};

describe('flight deck: flying course for launch and recovery (F14)', () => {
  it('relative wind: head wind on the bow, own way adds to it', () => {
    expect(relativeWind({ from: 0, kn: 10 }, 0, 10)).toEqual({ rel: 0, kn: 20 });
    const beam = relativeWind({ from: 90, kn: 10 }, 0, 0);
    expect(beam.rel).toBeCloseTo(90, 0);
    // Wind on the beam at 10 kn, ship at 15 kn: about 34° off the bow
    expect(Math.abs(relativeWind({ from: 90, kn: 10 }, 0, 15).rel)).toBeCloseTo(34, 0);
  });

  it('the wind comes from the weather; without weather cells the airs are light', () => {
    const { w } = world(240);
    expect(trueWind(w).from).toBeCloseTo(240, 0);
    expect(trueWind(w).kn).toBeGreaterThan(8);
    const bare = createWorld([], 1, { layerDepth: 80, layerLoss: 12, seaState: 3 });
    expect(trueWind(bare).kn).toBe(0);
  });

  it('nearest flying course puts the wind inside the envelope, close to the present heading', () => {
    const wind = { from: 240, kn: 13 };
    const c = nearestFlyingCourse(wind, 0, 12);
    expect(Math.abs(relativeWind(wind, c, 12).rel)).toBeLessThanOrEqual(22);
    expect(Math.abs(angleDiff(c, 240))).toBeLessThanOrEqual(45);
  });

  it('off the flying course the helicopter waits after its preparation and the bridge is told the course; on it, it launches a minute later', () => {
    const { w, ffg } = world(240, 3, 60, 12);
    const h = heloOf(w, 'f')!;
    heloOrder(w, ffg, 'add', { kind: 'dip', at: { x: 0, y: 8000 } });
    run(w, HELO_LAUNCH_PREP_S + LAUNCH_ON_COURSE_S + 30);
    expect(h.state).toBe('deck');
    const v = heloView(w, ffg)!;
    expect(v.deck?.need).toBe('launch');
    expect(v.deck?.ok).toBe(false);
    expect(v.deck?.block).toBe('wind');
    const said = w.events.filter((e) => e.kind === 'boat' && e.text.includes('FLUGKURS NÖTIG · WIND 240°'));
    // Told when the preparation starts, and again every two minutes while off it
    expect(said.length).toBeGreaterThanOrEqual(1);
    expect(said.length).toBeLessThanOrEqual(2);
    // The bridge steers the course given: within a few minutes the helicopter is up
    ffg.order.heading = v.deck!.course;
    run(w, 300, () => h.state === 'air');
    expect(h.state).toBe('air');
    expect(Math.abs(flyingCourse(w, ffg, true).rel)).toBeLessThanOrEqual(30);
  });

  it('no launch above sea state 5; a recovery takes twice as long in such a sea', () => {
    const { w, ffg } = world(0, 6, 0, 10);
    const h = heloOf(w, 'f')!;
    heloOrder(w, ffg, 'add', { kind: 'dip', at: { x: 0, y: 8000 } });
    run(w, HELO_LAUNCH_PREP_S + LAUNCH_ON_COURSE_S + 60);
    expect(h.state).toBe('deck');
    expect(heloView(w, ffg)!.deck?.block).toBe('sea');
    expect(w.events.some((e) => e.kind === 'boat' && e.text.includes('SEEGANG ZU HOCH'))).toBe(true);
    // Airborne already (launched before the sea got up): home it, it lands after 2 × RECOVERY_S alongside
    h.state = 'air';
    h.prepUntil = undefined;
    h.queue = [];
    h.x = 0;
    h.y = 1500;
    heloOrder(w, ffg, 'add', { kind: 'return' });
    run(w, 60, () => !!h.recover);
    const t0 = w.time;
    run(w, 3 * RECOVERY_S, () => h.state === 'deck');
    expect(h.state).toBe('deck');
    expect(w.time - t0).toBeGreaterThan(2 * RECOVERY_S - 10);
  });

  it('alongside, the helicopter waits for the flying course to land', () => {
    const { w, ffg } = world(90, 3, 0, 12);
    const h = heloOf(w, 'f')!;
    Object.assign(h, { state: 'air', x: 0, y: 2000, queue: [] });
    heloOrder(w, ffg, 'add', { kind: 'return' });
    run(w, 200);
    expect(h.state).toBe('air');
    expect(h.recover).toBe(true);
    expect(heloView(w, ffg)!.deck?.alongside).toBe(true);
    ffg.order.heading = heloView(w, ffg)!.deck!.course;
    run(w, 400, () => h.state === 'deck');
    expect(h.state).toBe('deck');
    expect(distance(ffg.pos, { x: 0, y: 0 })).toBeGreaterThan(12 * KN * 100);
  });
});

describe('dipping cycle and buoy patterns (F15)', () => {
  it('the dome is reeled down and up at its rate, the search sits at two depths', () => {
    const tl = dipTimeline(40, 150);
    expect(domeDepthAt(40, 150, 10)).toBe(0);
    expect(domeDepthAt(40, 150, tl.s1 + 1)).toBe(40);
    expect(domeDepthAt(40, 150, tl.s2 + 1)).toBe(150);
    expect(domeDepthAt(40, 150, tl.end)).toBeCloseTo(0, 6);
    // About 5 min per dip; 3–5 min in shallow water
    expect(tl.end).toBeGreaterThan(240);
    expect(tl.end).toBeLessThan(330);
    expect(dipTimeline(20, 40).end).toBeGreaterThan(180);
  });

  it('circle round the datum, staggered barrier, chevron trailing back from the apex', () => {
    const circle = buoyPoints({ x: 0, y: 0, count: 6, spacing: 2800, pattern: 'circle' });
    expect(circle).toHaveLength(6);
    for (const p of circle) expect(Math.hypot(p.x, p.y)).toBeCloseTo(2800, 0);
    expect(buoyPoints({ x: 0, y: 0, count: 6, spacing: 9000, pattern: 'circle' })[0]!.y).toBeCloseTo(CIRCLE_R[1], 0);
    const barrier = buoyPoints({ x: 0, y: 0, axis: 90, count: 6, spacing: 2500, pattern: 'barrier' });
    expect(barrier).toHaveLength(6);
    // Two rows (north and south of the line), the back row offset by half a spacing
    const front = barrier.filter((p) => p.y < 0).map((p) => Math.round(p.x)).sort((a, b) => a - b);
    const back = barrier.filter((p) => p.y > 0).map((p) => Math.round(p.x)).sort((a, b) => a - b);
    expect(front).toHaveLength(3);
    expect(back).toHaveLength(3);
    expect(back[0]! - front[0]!).toBe(1250);
    // Chevron pointing north: apex first, the arms trail back to the south-west and south-east
    const v = buoyPoints({ x: 0, y: 0, axis: 0, count: 5, spacing: 2000, pattern: 'chevron' });
    expect(v[0]).toEqual({ x: 0, y: 0 });
    expect(v.slice(1).every((p) => p.y < 0)).toBe(true);
    expect(v.filter((p) => p.x < 0)).toHaveLength(2);
    expect(v.filter((p) => p.x > 0)).toHaveLength(2);
  });

  it('the helicopter lays a circle of buoys round a datum', () => {
    const { w, ffg } = world(0, 3, 0, 0);
    expect(heloOrder(w, ffg, 'add', { kind: 'buoys', at: { x: 0, y: 9000 }, pattern: 'circle', count: 8 })).toBe(true);
    const h = heloOf(w, 'f')!;
    expect(h.queue[0]!.pattern).toBe('circle');
    run(w, 900, () => (w.air?.buoys.length ?? 0) >= 8);
    expect(w.air!.buoys).toHaveLength(8);
    for (const b of w.air!.buoys) expect(distance(b.pos, { x: 0, y: 9000 })).toBeCloseTo(2800, -1);
  });
});
