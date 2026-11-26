import { describe, expect, it } from 'vitest';
import {
  ATTACK_FROM_DIP_S, DIP_HOVER_S, DIP_STEP_M, HELO_BUOYS, HELO_ENDURANCE_S, HELO_LAUNCH_PREP_S, HELO_REFUEL_S, HELO_SPEED, HELO_TORPS,
  bookFor, buoyLine, createShip, dipDepth, createWorld, distance, heloClear, heloOf, heloOrder, heloRemove, heloView, installAir,
  installWeapons, restoreWorld, saveWorld, stepWorld, type World,
} from '../src/index.js';

function world(sub = { x: 9000, y: 3000 }) {
  const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0, speedKn: 0 });
  const u = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: sub, heading: 0, speedKn: 3, depth: 60 });
  const w = createWorld([ffg, u], 5, { layerDepth: 120, layerLoss: 12, seaState: 3 });
  installWeapons(w);
  installAir(w);
  ffg.btLayer = 120;
  return { w, ffg, u };
}
const run = (w: World, s: number, until?: () => boolean) => {
  for (let i = 0; i < s * 10 && !until?.(); i++) stepWorld(w);
};

describe('ship helicopter: one airframe with a task queue (C11)', () => {
  it('starts on deck fuelled and loaded; one reload in the magazine', () => {
    const { w, ffg } = world();
    const h = heloOf(w, 'f')!;
    expect(h.state).toBe('deck');
    expect(h.fuel).toBe(HELO_ENDURANCE_S);
    expect([h.buoys, h.torps]).toEqual([HELO_BUOYS, HELO_TORPS]);
    const v = heloView(w, ffg)!;
    expect([v.magBuoys, v.magTorps]).toEqual([12, 2]);
  });

  it('works the queue in order, shows ETAs, takes retasking and removal at any time', () => {
    const { w, ffg } = world({ x: 40_000, y: 40_000 });
    expect(heloOrder(w, ffg, 'add', { kind: 'mad', at: { x: 0, y: 6000 } })).toBe(true);
    expect(heloOrder(w, ffg, 'add', { kind: 'dip', at: { x: 6000, y: 6000 }, count: 2 })).toBe(true);
    expect(heloOrder(w, ffg, 'add', { kind: 'return' })).toBe(true);
    expect(heloOrder(w, ffg, 'add', { kind: 'dip', at: { x: 60_000, y: 0 } })).toMatch(/Reichweite/);
    const eta = heloView(w, ffg)!.queue.map((q) => q.etaS);
    // The ETA counts the launch preparation on deck
    expect(eta[0]).toBeCloseTo(HELO_LAUNCH_PREP_S + 6000 / HELO_SPEED, -1);
    expect(eta[1]).toBeGreaterThan(eta[0]! + 360);
    expect(eta[2]).toBeGreaterThan(eta[1]! + 2 * DIP_HOVER_S);
    // Launch preparation first (about 2 min, counting down in the view), then it flies the MAD task
    run(w, 1);
    const h = heloOf(w, 'f')!;
    expect(h.state).toBe('deck');
    expect(heloView(w, ffg)!.launchInS).toBeCloseTo(HELO_LAUNCH_PREP_S - 1, -1);
    run(w, HELO_LAUNCH_PREP_S - 5);
    expect(h.state).toBe('deck');
    run(w, 6);
    expect(h.state).toBe('air');
    expect(heloView(w, ffg)!.launchInS).toBeUndefined();
    run(w, 120);
    expect(h.queue[0]!.kind).toBe('mad');
    expect(h.queue[0]!.phase).toBe('work');
    // Strike the MAD run: on to the dip
    expect(heloRemove(w, ffg, h.queue[0]!.id)).toBe(true);
    expect(h.queue[0]!.kind).toBe('dip');
    // Retask now: everything else dropped
    expect(heloOrder(w, ffg, 'now', { kind: 'dip', at: { x: -5000, y: 5000 }, count: 1 })).toBe(true);
    expect(h.queue.map((t) => t.kind)).toEqual(['dip']);
    run(w, 200, () => distance(h, { x: -5000, y: 5000 }) < 1);
    expect(distance(h, { x: -5000, y: 5000 })).toBeLessThan(1);
    // Clear: home and land
    expect(heloClear(w, ffg)).toBe(true);
    run(w, 300, () => h.state === 'deck');
    expect(h.state).toBe('deck');
  });

  it('dip cycle: hovers 180 s pinging above and below the layer, then dips again 4 km on', () => {
    const { w, ffg } = world({ x: 40_000, y: 40_000 });
    heloOrder(w, ffg, 'add', { kind: 'dip', at: { x: 0, y: 5000 }, axis: 90, count: 2 });
    const h = heloOf(w, 'f')!;
    run(w, 400, () => h.queue[0]?.phase === 'work');
    const t0 = w.time;
    while (h.queue[0]?.phase === 'work' && w.time < t0 + 400) {

      stepWorld(w);

    }
    expect(w.time - t0).toBeCloseTo(DIP_HOVER_S, -1);
    const t = h.queue[0]!;
    expect(t.step).toBe(1);
    expect(t.x).toBeCloseTo(DIP_STEP_M, -1);
    expect(t.y).toBeCloseTo(5000, -1);
    expect(t.pings).toBe(DIP_HOVER_S / 20);
    run(w, 100, () => h.queue[0]?.phase === 'work');
    expect(distance(h, { x: DIP_STEP_M, y: 5000 })).toBeLessThan(1);
  });

  it('the dome goes alternately above and below the measured layer; echoes with range from the hover point', () => {
    const { w, ffg } = world();
    // Layer measured at 120 m: just above it at 40 m, and 40 m below it
    expect([dipDepth(w, ffg, { x: 0, y: 0 }, false), dipDepth(w, ffg, { x: 0, y: 0 }, true)]).toEqual([40, 160]);
    heloOrder(w, ffg, 'add', { kind: 'dip', at: { x: 8000, y: 1500 } });
    const h = heloOf(w, 'f')!;
    run(w, 400, () => (h.queue[0]?.pings ?? 0) >= 2);
    // The boat heard both pings (intercepts) and the frigate got an echo with range from the hover point
    const echo = w.books.get('f')!.tracks().flatMap((t) => t.history).find((s) => s.sensor === 'active' && s.ox !== undefined);
    expect(echo?.ox).toBeCloseTo(8000, 0);
    expect(w.books.get('u')!.entries().some(([id]) => id === 'H-f')).toBe(true);
    expect(h.fix).toBeDefined();
  });

  it('buoy pattern: a line of 4–6 buoys 2–3 km apart across the point, laid from the near end', () => {
    expect(buoyLine({ x: 0, y: 0, axis: 90, count: 5, spacing: 2500 }).map((p) => Math.round(p.x))).toEqual([-5000, -2500, 0, 2500, 5000]);
    const { w, ffg } = world({ x: 40_000, y: 40_000 });
    expect(heloOrder(w, ffg, 'add', { kind: 'buoys', at: { x: 0, y: 10_000 }, axis: 90, count: 6, spacing: 4000 })).toBe(true);
    const h = heloOf(w, 'f')!;
    expect(h.queue[0]!.spacing).toBe(3000);
    run(w, 900, () => w.air!.buoys.length >= 6);
    const xs = w.air!.buoys.map((b) => Math.round(b.pos.x));
    expect(xs.length).toBe(6);
    expect(w.air!.buoys.every((b) => Math.abs(b.pos.y - 10_000) < 50)).toBe(true);
    const sorted = [...xs].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThan(2950);
    // Above and below the layer in turn
    expect(new Set(w.air!.buoys.map((b) => b.depth)).size).toBe(2);
    expect(h.buoys).toBe(HELO_BUOYS - 6);
    expect(h.queue).toHaveLength(0);
  });

  it('attack: a minute from the dip contact, aimed at the latest fix held (not the one at the order)', () => {
    const { w, ffg, u } = world();
    u.speed = 0;
    heloOrder(w, ffg, 'add', { kind: 'dip', at: { x: 7000, y: 2000 } });
    const h = heloOf(w, 'f')!;
    run(w, 400, () => !!h.fix);
    expect(h.fix).toBeDefined();
    const label = w.books.get('f')!.entries().find(([id]) => id === 'u')![1].label;
    const ordered = w.time;
    expect(heloOrder(w, ffg, 'now', { kind: 'attack', at: h.fix!, track: label })).toBe(true);
    run(w, 10);
    // The boat moves 1 km; a fresh fix of it comes in (another sensor) after the order
    u.pos = { x: 9000, y: 4000 };
    bookFor(w, 'f').ingest({ observerId: 'f', targetId: 'u', sensor: 'active', time: w.time, bearing: 0, range: 1000, se: 20, originX: 9000, originY: 3000 });
    run(w, 200, () => (w.weapons?.torpedoes.length ?? 0) > 0);
    const torp = w.weapons!.torpedoes[0]!;
    expect(torp.kind).toBe('light');
    expect(distance(torp.pos, { x: 9000, y: 4000 })).toBeLessThan(50);
    expect(w.time - ordered).toBeGreaterThanOrEqual(ATTACK_FROM_DIP_S - 0.2);
    expect(h.torps).toBe(HELO_TORPS - 1);
  });

  it('endurance: bingo fuel brings it home; 10 min on deck refuels and rearms from the magazine; the queue goes on', () => {
    const { w, ffg } = world({ x: 40_000, y: 40_000 });
    heloOrder(w, ffg, 'add', { kind: 'buoys', at: { x: 0, y: 5000 }, axis: 90, count: 6 });
    heloOrder(w, ffg, 'add', { kind: 'buoys', at: { x: 0, y: 12_000 }, axis: 90, count: 6 });
    heloOrder(w, ffg, 'add', { kind: 'buoys', at: { x: 0, y: 18_000 }, axis: 90, count: 4 });
    const h = heloOf(w, 'f')!;
    run(w, 3000, () => h.state === 'deck' && w.time > HELO_LAUNCH_PREP_S + 10);
    // 12 buoys aboard: empty after two lines, home to rearm
    expect(h.state).toBe('deck');
    expect(w.air!.buoys).toHaveLength(12);
    expect(h.buoys).toBe(12);
    expect(w.air!.stock.get('f')).toBe(0);
    const landed = w.time;
    expect(h.readyAt).toBeCloseTo(landed + HELO_REFUEL_S, 0);
    run(w, HELO_REFUEL_S - 5);
    expect(h.state).toBe('deck');
    // Ready again: the launch preparation for the queued line, then airborne
    run(w, 10);
    expect(h.state).toBe('deck');
    expect(h.prepUntil).toBeDefined();
    run(w, HELO_LAUNCH_PREP_S);
    expect(h.state).toBe('air');
    // Fuel: a long loiter far out ends in a landing before the tank is dry
    h.queue = [];
    h.fuel = 400;
    run(w, 600, () => h.state === 'deck');
    expect(h.state).toBe('deck');
    expect(h.fuel).toBe(HELO_ENDURANCE_S);
    expect(w.events.some((e) => e.kind === 'boat' && e.text.includes('KRAFTSTOFF'))).toBe(true);
  });

  it('launch preparation: about 2 min from the order to lift-off; an emptied queue stands it down', () => {
    const { w, ffg } = world({ x: 40_000, y: 40_000 });
    const h = heloOf(w, 'f')!;
    heloOrder(w, ffg, 'add', { kind: 'dip', at: { x: 0, y: 5000 } });
    run(w, 30);
    expect(h.state).toBe('deck');
    expect(heloView(w, ffg)!.launchInS).toBeGreaterThan(HELO_LAUNCH_PREP_S - 40);
    heloClear(w, ffg);
    run(w, 1);
    expect(h.prepUntil).toBeUndefined();
    expect(heloView(w, ffg)!.launchInS).toBeUndefined();
    // A new order starts the full preparation again
    heloOrder(w, ffg, 'add', { kind: 'dip', at: { x: 0, y: 5000 } });
    run(w, HELO_LAUNCH_PREP_S - 2);
    expect(h.state).toBe('deck');
    run(w, 4);
    expect(h.state).toBe('air');
  });

  it('older saves: a helicopter sortie in flight becomes the airborne helicopter with that task, then home', () => {
    const { w, ffg } = world({ x: 40_000, y: 40_000 });
    // Old state: no helicopter record, the buoy (and torpedoes) counted in the ship's stock
    delete w.air!.helos;
    w.air!.stock.set('f', 16);
    w.air!.heloTorps!.set('f', 2);
    w.time = 100;
    w.air!.sorties.push({ shipId: 'f', from: { x: 0, y: 0 }, target: { x: 0, y: 6000 }, launchAt: 90, dropAt: 90 + 6000 / HELO_SPEED, landAt: 90 + 12000 / HELO_SPEED, readyAt: 210 + 12000 / HELO_SPEED, deep: true, dropped: false });
    w.air!.stock.set('f', 15);
    const saved = JSON.parse(JSON.stringify(saveWorld(w)));
    const w2 = restoreWorld(saved);
    stepWorld(w2);
    const h = heloOf(w2, 'f')!;
    expect(h.state).toBe('air');
    expect(h.queue.map((t) => t.kind)).toEqual(['buoys', 'return']);
    expect(h.buoys).toBe(13);
    expect(w2.air!.stock.get('f')).toBe(3);
    expect(w2.air!.sorties).toHaveLength(0);
    run(w2, 400, () => h.state === 'deck');
    expect(w2.air!.buoys).toHaveLength(1);
    expect(w2.air!.buoys[0]!.pos.y).toBeCloseTo(6000, -1);
    expect(h.state).toBe('deck');
    // A restored match keeps taking orders
    expect(heloOrder(w2, w2.ships[0]!, 'add', { kind: 'dip', at: { x: 0, y: 5000 } })).toBe(true);
    void ffg;
  });

  it('a helicopter on deck after an old sortie keeps its turnaround', () => {
    const { w } = world();
    delete w.air!.helos;
    w.time = 500;
    w.air!.sorties.push({ kind: 'dip', shipId: 'f', from: { x: 0, y: 0 }, target: { x: 0, y: 6000 }, launchAt: 0, dropAt: 100, hoverUntil: 400, landAt: 480, readyAt: 600, deep: false, dropped: true });
    const h = heloOf(w, 'f')!;
    expect(h.state).toBe('deck');
    expect(h.readyAt).toBe(600);
  });
});
