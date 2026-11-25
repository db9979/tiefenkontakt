import { describe, expect, it } from 'vitest';
import {
  CLASSES,
  EMERGENCY_TURN_S,
  PERISCOPE_DEPTH,
  bookFor,
  convoySpeedKn,
  createConvoy,
  createShip,
  createWorld,
  distance,
  emergencyTurn,
  fireTorpedo,
  installAir,
  installBoats,
  installWeapons,
  setConvoySpeedAdj,
  stepConvoy,
  stepWorld,
  type Ship,
  type World,
} from '@tk/shared';
import { newMemory, type BotMemory } from '../src/bots/common.js';
import { BotCrew } from '../src/bots/index.js';
import { CLOSE_SCREEN_R, HEARD_ERR, HEARD_RANGE, OUTER_SCREEN_R, heardLaunchDatum, planSide, screenStations } from '../src/bots/escort-team.js';
import { PEEK_LOOK_S, RADAR_DOWN_S, thinkSub } from '../src/bots/sub.js';
import { convoyOrder, escortCommandFor, escortTask } from '../src/escort-command.js';

/** Convoy at the origin heading north, AI escorts (ffg = long array, kor = short), optionally a human escort. */
function setup(classes: ('ffg' | 'kor' | 'ffv')[] = ['ffg', 'ffg', 'kor'], human = false) {
  const ms = [0, 1, 2, 3].map((i) => createShip({ id: `m${i}`, cls: 'merchant', name: `M${i}`, pos: { x: (i % 2) * 900, y: -Math.floor(i / 2) * 900 }, heading: 0, speedKn: 9 }));
  const pos = [{ x: -5000, y: 2500 }, { x: 5000, y: 2500 }, { x: 0, y: -5000 }, { x: 0, y: 5500 }];
  const es = classes.map((cls, i) => createShip({ id: `p_bot-w${i + 1}`, cls, name: `W${i + 1}`, pos: pos[i]!, heading: 0, speedKn: 12, team: 'west' }));
  const cmdr = createShip({ id: 'p_h1', cls: 'ffg', name: 'Kommandant', pos: { x: 0, y: 6000 }, heading: 0, speedKn: 12, team: 'west' });
  const u = createShip({ id: 'p_bot-e1', cls: 'ssk', name: 'E1', pos: { x: 0, y: 20_000 }, heading: 180, speedKn: 4, depth: 80, team: 'east' });
  const w = createWorld([...ms, ...es, ...(human ? [cmdr] : []), u], 3, { layerDepth: 0, layerLoss: 0, seaState: 2, light: 1 });
  w.convoy = createConvoy(ms, [{ x: 0, y: 40_000 }], 9);
  installWeapons(w);
  installAir(w);
  installBoats(w);
  const mems = new Map<string, BotMemory>(es.map((s) => [s.id, newMemory(s.id)]));
  return { w, es, u, cmdr, mems, center: { x: 450, y: -450 } };
}

describe('C14 escort screen', () => {
  it('one ship on the close screen (5–6 km), the long-array ships 9–10 km out on the threat axis', () => {
    const { w, es, mems, center } = setup(['ffg', 'ffv', 'kor']);
    const tasks = planSide(w, 'west', mems);
    const r = (id: string) => distance(tasks.get(id)!.station!, center);
    // The corvette (short array) keeps the close screen, both long-array frigates go out ahead
    expect(r('p_bot-w3')).toBeGreaterThan(5000);
    expect(r('p_bot-w3')).toBeLessThan(6000);
    for (const s of es.slice(0, 2)) {
      expect(r(s.id)).toBeGreaterThan(9000);
      expect(r(s.id)).toBeLessThan(10_000);
      expect(tasks.get(s.id)!.station!.y).toBeGreaterThan(center.y + 8000);
    }
  });

  it('all long-array ships: one of them still stays on the close screen', () => {
    const { es, center } = setup(['ffg', 'ffg', 'ffg']);
    const st = screenStations(center, 0, es);
    const rs = es.map((s) => distance(st.get(s.id)!, center)).sort((a, b) => a - b);
    expect(rs[0]).toBeCloseTo(CLOSE_SCREEN_R, -2);
    expect(rs[2]).toBeCloseTo(OUTER_SCREEN_R, -2);
  });
});

describe('C14 torpedo alert: the heard datum', () => {
  it('lies down the heard bearing at a guessed 6–8 km with 1.5–2 km error, not at the true launch point', () => {
    const { w, es, u, mems } = setup();
    w.time = 500;
    // The boat fires from 3 km: a guess of 6–8 km down the bearing misses the truth by kilometres
    u.pos = { x: -5000, y: 5500 };
    const hearer = es[1]!;
    const b = (Math.atan2(u.pos.x - hearer.pos.x, u.pos.y - hearer.pos.y) * 180) / Math.PI;
    mems.get(hearer.id)!.launchHeard = { x: hearer.pos.x, y: hearer.pos.y, b: (b + 360) % 360, t: 495 };
    heardLaunchDatum(w, es[0]!, 0, mems);
    const h = w.env.hunt!.west!.heard!;
    const r = distance(h, hearer.pos);
    expect(r).toBeGreaterThanOrEqual(HEARD_RANGE[0]);
    expect(r).toBeLessThanOrEqual(HEARD_RANGE[1]);
    expect(h.err).toBeGreaterThanOrEqual(HEARD_ERR[0]);
    expect(h.err).toBeLessThanOrEqual(HEARD_ERR[1]);
    expect(distance(h, u.pos)).toBeGreaterThan(1500);
    // Another escort prosecutes it (as the team datum, or her own); the threatened ship does not
    const tasks = planSide(w, 'west', mems);
    expect(tasks.get(es[0]!.id)?.role).toBe('screen');
    expect([...tasks].filter(([id, t]) => id !== es[0]!.id && t.role !== 'screen').length).toBeGreaterThanOrEqual(1);
    // A helicopter goes for it as well, and the team datum takes it
    expect([...tasks.values()].some((t) => t.helo && distance(t.helo, h) < 1)).toBe(true);
    expect(distance(w.env.hunt!.west!.datum!, h)).toBeLessThan(1);
  });

  it('in a running match a torpedo alert gives the team a heard datum (never the launch position)', () => {
    const { w, es, u } = setup();
    const crew = new BotCrew('normal');
    for (const s of es) crew.add(s.id);
    u.pos = { x: -5000, y: 7000 };
    u.depth = 30;
    u.speed = 0;
    const launch = { ...u.pos };
    const t = fireTorpedo(w, u, { heading: 180, enableAfter: 800, speedKn: 40 });
    expect(typeof t).not.toBe('string');
    for (let i = 0; i < 120 && !w.env.hunt?.west?.heard; i++) {
      stepWorld(w);
      crew.step(w);
    }
    const h = w.env.hunt?.west?.heard;
    expect(h).toBeDefined();
    expect(distance(h!, launch)).toBeGreaterThan(500);
  });
});

/** A boat at periscope depth, mast up, with a contact book. */
function boat(battery = 1) {
  const u = createShip({ id: 'p_bot-e1', cls: 'ssk', name: 'E1', pos: { x: 0, y: 0 }, heading: 0, speedKn: 4, depth: PERISCOPE_DEPTH, team: 'east' });
  const f = createShip({ id: 'p_bot-w1', cls: 'ffg', name: 'W1', pos: { x: 0, y: 30_000 }, heading: 180, speedKn: 15, team: 'west' });
  u.battery = CLASSES.ssk.battery!.capacityKnH * battery;
  const w = createWorld([u, f], 5, { layerDepth: 80, layerLoss: 10, seaState: 2, light: 1 });
  installWeapons(w);
  installAir(w);
  installBoats(w);
  u.btLayer = 80;
  const m = newMemory(u.id);
  return { w, u, f, m };
}

describe('C14 submarine bot', () => {
  it('snorkels with the mast up when the battery runs low', () => {
    const { w, u, m } = boat(0.2);
    w.time = 100;
    thinkSub(w, m, u, 'normal', []);
    expect(u.snorkel).toBe(true);
    expect(u.order.depth).toBe(PERISCOPE_DEPTH);
    expect(u.mastUp).toBe(true);
  });

  it('a ship radar getting stronger: snorkel and mast down, below the layer, and it stays down', () => {
    const { w, u, f, m } = boat(0.2);
    w.time = 100;
    u.mastUp = true;
    bookFor(w, u.id).ingest({ observerId: u.id, targetId: f.id, sensor: 'esm', time: 100, bearing: 0, se: 10, emitter: 'ffg', esmLvl: 1, esmTrend: 1 });
    thinkSub(w, m, u, 'normal', []);
    expect(u.snorkel).toBe(false);
    expect(u.mastUp).toBe(false);
    expect(u.order.depth).toBeGreaterThan(80);
    expect(m.radarDownUntil).toBe(100 + RADAR_DOWN_S);
    // Ten minutes later it may come up again to charge
    w.time = 100 + RADAR_DOWN_S + 1;
    thinkSub(w, m, u, 'normal', []);
    expect(u.snorkel).toBe(true);
  });

  it('a ship radar getting weaker is no reason to go down', () => {
    const { w, u, f, m } = boat(0.2);
    w.time = 100;
    u.mastUp = true;
    bookFor(w, u.id).ingest({ observerId: u.id, targetId: f.id, sensor: 'esm', time: 100, bearing: 0, se: 10, emitter: 'ffg', esmLvl: 0, esmTrend: -1 });
    thinkSub(w, m, u, 'normal', []);
    expect(u.snorkel).toBe(true);
    expect(m.radarDownUntil).toBeUndefined();
  });

  it('a periscope look lasts about ten seconds', () => {
    const { w, u, m } = boat(1);
    w.time = 100;
    m.peekUntil = 200;
    thinkSub(w, m, u, 'normal', []);
    expect(u.mastUp).toBe(true);
    w.time = 100 + PEEK_LOOK_S + 1;
    thinkSub(w, m, u, 'normal', []);
    expect(u.mastUp).toBe(false);
    expect(u.order.depth).toBeGreaterThan(PERISCOPE_DEPTH);
  });
});

describe('C15 escort commander', () => {
  const task = (w: World, s: Ship, shipId: string, t: 'station' | 'sector' | 'datum' | 'helo' | 'cancel', extra: object = {}) =>
    escortTask(w, s, { t: 'escort_task', shipId, task: t, ...extra });

  it('only a human escort captain of the side may task the AI escorts', () => {
    const { w, es, u, cmdr } = setup(['ffg', 'ffg', 'kor'], true);
    expect(task(w, es[0]!, es[1]!.id, 'sector', { x: 0, y: 10_000 })).toBeDefined();
    expect(task(w, u, es[1]!.id, 'sector', { x: 0, y: 10_000 })).toBeDefined();
    expect(task(w, cmdr, u.id, 'sector', { x: 0, y: 10_000 })).toBeDefined();
    expect(task(w, cmdr, es[2]!.id, 'helo', { x: 0, y: 10_000 })).toMatch(/Hubschrauber/);
    expect(task(w, cmdr, es[1]!.id, 'sector', { x: 0, y: 10_000 })).toBeUndefined();
    expect(escortCommandFor(w, cmdr)!.escorts.find((e) => e.id === es[1]!.id)!.task!.kind).toBe('sector');
    expect(escortCommandFor(w, es[0]!)).toBeUndefined();
  });

  it('a station moves with the convoy and holds even with a datum close by', () => {
    const { w, es, u, cmdr, mems, center } = setup(['ffg', 'ffg', 'kor'], true);
    expect(task(w, cmdr, es[0]!.id, 'station', { rel: 270, range: 8000 })).toBeUndefined();
    w.time = 100;
    // A datum next to the ship: the planner would send her hunting, the order keeps her on station
    u.pos = { x: es[0]!.pos.x + 1000, y: es[0]!.pos.y };
    w.env.hunt!.west!.datum = { x: u.pos.x, y: u.pos.y, t: 100, q: 90, by: es[1]!.id };
    const tasks = planSide(w, 'west', mems);
    const st = tasks.get(es[0]!.id)!;
    expect(st.role).toBe('screen');
    expect(st.ordered).toBe('station');
    expect(distance(st.station!, center)).toBeCloseTo(8000, -2);
    expect(st.station!.x).toBeLessThan(center.x - 7000);
  });

  it('a datum order is prosecuted, then given up ten minutes after she got there', () => {
    const { w, es, cmdr, mems } = setup(['ffg', 'ffg', 'kor'], true);
    const p = { x: es[1]!.pos.x, y: es[1]!.pos.y + 1500 };
    task(w, cmdr, es[1]!.id, 'datum', p);
    w.time = 10;
    let t = planSide(w, 'west', mems).get(es[1]!.id)!;
    expect(t.role).toBe('hunter');
    expect(t.datum).toEqual(p);
    w.time = 700;
    t = planSide(w, 'west', mems).get(es[1]!.id)!;
    expect(t.ordered).toBeUndefined();
    expect(w.env.hunt!.west!.cmds![es[1]!.id]).toBeUndefined();
  });

  it('helicopter there is done once the helicopter is committed; cancel returns her to the planner', () => {
    const { w, es, cmdr, mems } = setup(['ffg', 'ffg', 'kor'], true);
    task(w, cmdr, es[0]!.id, 'helo', { x: -6000, y: 9000 });
    w.time = 10;
    expect(planSide(w, 'west', mems).get(es[0]!.id)!.helo).toEqual({ x: -6000, y: 9000 });
    w.env.hunt!.west!.helo[es[0]!.id] = { x: -6000, y: 9000, until: 600 };
    w.env.hunt!.west!.heloAt = { [es[0]!.id]: 20 };
    w.time = 30;
    planSide(w, 'west', mems);
    expect(w.env.hunt!.west!.cmds![es[0]!.id]).toBeUndefined();
    task(w, cmdr, es[2]!.id, 'sector', { x: 3000, y: 12_000 });
    expect(planSide(w, 'west', mems).get(es[2]!.id)!.ordered).toBe('sector');
    task(w, cmdr, es[2]!.id, 'cancel');
    expect(planSide(w, 'west', mems).get(es[2]!.id)!.ordered).toBeUndefined();
  });
});

describe('C15 convoy orders', () => {
  it('emergency turn 45° is held ten minutes, then the convoy resumes its route', () => {
    const { w, cmdr } = setup(['ffg'], true);
    const c = w.convoy!;
    c.zigzag = false;
    const ms = w.ships.filter((s) => s.cls === 'merchant');
    expect(convoyOrder(w, cmdr, { t: 'convoy_order', order: 'turn', side: 1 })).toBeUndefined();
    for (let t = 0; t < 300; t++) stepConvoy(c, ms, 1, t);
    expect(Math.abs(c.guideHeading - 45)).toBeLessThan(2);
    for (let t = 300; t < EMERGENCY_TURN_S + 10; t++) stepConvoy(c, ms, 1, t);
    expect(c.turn).toBeUndefined();
    // Back toward the route (north), from east of it: a course west of north
    expect(c.guideHeading > 270 || c.guideHeading < 1).toBe(true);
    emergencyTurn(c, -1, 1000);
    stepConvoy(c, ms, 1, 1001);
    expect(c.turn!.side).toBe(-1);
    convoyOrder(w, cmdr, { t: 'convoy_order', order: 'turn', side: 0 });
    expect(c.turn).toBeUndefined();
  });

  it('an ordered course is held (no time limit) until the convoy is sent back to its route', () => {
    const { w, cmdr } = setup(['ffg'], true);
    const c = w.convoy!;
    c.zigzag = false;
    const ms = w.ships.filter((s) => s.cls === 'merchant');
    expect(convoyOrder(w, cmdr, { t: 'convoy_order', order: 'course', course: 90 })).toBeUndefined();
    for (let t = 0; t < 1500; t++) stepConvoy(c, ms, 1, t);
    expect(Math.abs(c.guideHeading - 90)).toBeLessThan(1);
    expect(escortCommandFor(w, cmdr)!.convoy!.course).toBe(90);
    // Merchants follow: their ordered headings point roughly east
    expect(ms.filter((m) => m.alive).every((m) => Math.abs(((m.order.heading - 90 + 540) % 360) - 180) < 50)).toBe(true);
    convoyOrder(w, cmdr, { t: 'convoy_order', order: 'course' });
    expect(c.course).toBeUndefined();
    stepConvoy(c, ms, 1, 1501);
    // Back toward the route (north), from east of it: west of north
    expect(c.guideHeading > 270 || c.guideHeading < 1).toBe(true);
  });

  it('zigzag on/off and speed ±2 kn (bounded); only the own escorts order', () => {
    const { w, cmdr, es } = setup(['ffg'], true);
    const c = w.convoy!;
    expect(convoyOrder(w, cmdr, { t: 'convoy_order', order: 'zigzag', on: false })).toBeUndefined();
    expect(c.zigzag).toBe(false);
    convoyOrder(w, cmdr, { t: 'convoy_order', order: 'speed', adj: 2 });
    expect(convoySpeedKn(c)).toBe(11);
    setConvoySpeedAdj(c, 7);
    expect(convoySpeedKn(c)).toBe(11);
    setConvoySpeedAdj(c, -2);
    expect(convoySpeedKn(c)).toBe(7);
    expect(convoyOrder(w, es[0]!, { t: 'convoy_order', order: 'zigzag', on: true })).toBeDefined();
    expect(escortCommandFor(w, cmdr)!.convoy).toMatchObject({ zigzag: false, adj: -2, speedKn: 7 });
  });
});
