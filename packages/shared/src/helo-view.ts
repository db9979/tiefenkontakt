import { DIP_CYCLE_TYPICAL_S, HELO_SPEED, MAD_PATTERN_S, dipTimeline } from './aviation.js';
import type { BuoyPattern } from './buoy-pattern.js';
import { LAUNCH_ON_COURSE_S, RECOVERY_S, flyingCourse, type FlycoBlock } from './flight-deck.js';
import type { Ship } from './entities.js';
import { DIP_STEP_M, HELO_LAUNCH_PREP_S, HELO_REFUEL_S, buoyLine, heloLow, heloOf, type Helo, type HeloTask, type HeloTaskKind } from './helo.js';
import { distance, headingVec, type Vec2 } from './math.js';
import type { World } from './world.js';

/** Client view of the own helicopter (snapshot). */
export interface HeloView {
  state: 'deck' | 'air';
  x: number;
  y: number;
  fuelS: number;
  readyInS: number;
  /** On deck, launch preparation running: seconds to lift-off. */
  launchInS?: number;
  buoys: number;
  torps: number;
  magBuoys: number;
  magTorps: number;
  /** What it does right now (first task), and whether it hovers/works there. */
  doing?: HeloTaskKind;
  working: boolean;
  queue: { id: number; kind: HeloTaskKind; x: number; y: number; count?: number; step?: number; axis?: number; track?: string; active?: boolean; pattern?: BuoyPattern; etaS: number }[];
  /**
   * Flight deck (F14): the ship must hold a flying course to launch (preparation running or done)
   * or to recover (helicopter home and alongside, or close to it). Course and wind in the game frame.
   */
  deck?: { need: 'launch' | 'recover'; ok: boolean; block?: FlycoBlock; windFrom: number; windKn: number; rel: number; course: number; heldS: number; needS: number; alongside?: boolean };
  /** Dipping: dome depth now (m). */
  domeM?: number;
}

/** Where the task starts: the point the helicopter flies to first. */
function startPoint(h: Pick<Helo, 'x' | 'y'>, t: HeloTask, ship: Ship): Vec2 {
  if (t.kind === 'return') return ship.pos;
  if (t.kind === 'buoys') {
    const pts = buoyLine(t);
    const rev = t.reverse ?? distance(h, pts[pts.length - 1]!) < distance(h, pts[0]!);
    return pts[rev ? pts.length - 1 - (t.step ?? 0) : t.step ?? 0] ?? pts[0]!;
  }
  return t;
}

/** Seconds of work a task still needs once the helicopter is there, and where it ends up. */
function taskWork(t: HeloTask, from: Vec2, now: number): { s: number; end: Vec2 } {
  if (t.kind === 'dip') {
    const left = (t.count ?? 1) - (t.step ?? 0);
    const cycle = t.dome ? dipTimeline(t.dome[0], t.dome[1]).end : DIP_CYCLE_TYPICAL_S;
    const cur = t.phase === 'work' ? Math.max(0, (t.until ?? now) - now) : cycle;
    const v = headingVec(t.axis ?? 0);
    const end = { x: t.x + v.x * DIP_STEP_M * (left - 1), y: t.y + v.y * DIP_STEP_M * (left - 1) };
    return { s: cur + (left - 1) * (cycle + DIP_STEP_M / HELO_SPEED), end };
  }
  if (t.kind === 'mad') return { s: t.phase === 'work' ? Math.max(0, (t.until ?? now) - now) : MAD_PATTERN_S, end: t };
  if (t.kind === 'buoys') {
    const pts = buoyLine(t);
    const rev = t.reverse ?? distance(from, pts[pts.length - 1]!) < distance(from, pts[0]!);
    const order = rev ? [...pts].reverse() : pts;
    const rest = order.slice(t.step ?? 0);
    let s = 0;
    for (let i = 1; i < rest.length; i++) s += distance(rest[i - 1]!, rest[i]!) / HELO_SPEED;
    return { s, end: rest[rest.length - 1] ?? t };
  }
  if (t.kind === 'attack') return { s: Math.max(0, (t.notBefore ?? now) - now), end: t };
  return { s: 0, end: from };
}

/** What the crew sees of the own helicopter: state, load, and the queue with an ETA for each task. */
export function heloView(w: World, ship: Ship): HeloView | undefined {
  const h = heloOf(w, ship.id);
  if (!h) return undefined;
  const air = w.air!;
  let pos: Vec2 = { x: h.x, y: h.y };
  const prep = h.state === 'deck' && h.prepUntil !== undefined ? Math.max(0, Math.round(h.prepUntil - w.time)) : undefined;
  // On deck: the preparation, and a minute with rotors running on the flying course (may overlap it)
  const onCourse = h.queue.length ? Math.max(0, LAUNCH_ON_COURSE_S - (h.deckSince !== undefined ? w.time - h.deckSince : 0)) : 0;
  let t = h.state === 'deck' ? Math.max(prep ?? Math.max(0, h.readyAt - w.time) + (h.queue.length ? HELO_LAUNCH_PREP_S : 0), onCourse) : 0;
  const queue: HeloView['queue'] = [];
  for (const task of h.queue) {
    const start = startPoint(pos, task, ship);
    if (task.phase !== 'work') t += distance(pos, start) / HELO_SPEED;
    queue.push({
      id: task.id, kind: task.kind, x: Math.round(task.x), y: Math.round(task.y), count: task.count, step: task.step, axis: task.axis,
      track: task.track, active: task.active, ...(task.pattern ? { pattern: task.pattern } : {}), etaS: Math.round(t),
    });
    const work = taskWork(task, start, w.time);
    t += work.s;
    pos = work.end;
    if (task.kind === 'return') t += RECOVERY_S + HELO_REFUEL_S + HELO_LAUNCH_PREP_S;
  }
  const first = h.queue[0];
  // The flight deck: launch once the preparation runs, recovery once home is near
  const recover = h.state === 'air' && first?.kind === 'return' && (h.recover || distance(h, ship.pos) < 4000);
  const launch = h.state === 'deck' && h.prepUntil !== undefined;
  let deck: HeloView['deck'];
  if (launch || recover) {
    const f = flyingCourse(w, ship, launch);
    const needS = (launch ? LAUNCH_ON_COURSE_S : RECOVERY_S) * f.slow;
    deck = {
      need: launch ? 'launch' : 'recover', ok: f.ok, ...(f.block ? { block: f.block } : {}), windFrom: f.windFrom, windKn: f.windKn, rel: f.rel, course: f.course,
      heldS: h.deckSince !== undefined ? Math.round(w.time - h.deckSince) : 0, needS, ...(h.recover ? { alongside: true } : {}),
    };
  }
  return {
    ...(deck ? { deck } : {}),
    ...(h.dipping && h.domeDepth ? { domeM: Math.round(h.domeDepth) } : {}),
    state: h.state, x: Math.round(h.x), y: Math.round(h.y), fuelS: Math.round(h.fuel), readyInS: h.state === 'deck' ? Math.max(0, Math.round(h.readyAt - w.time)) : 0,
    ...(prep !== undefined ? { launchInS: prep } : {}),
    buoys: h.buoys, torps: h.torps, magBuoys: air.stock.get(ship.id) ?? 0, magTorps: air.heloTorps?.get(ship.id) ?? 0,
    doing: h.state === 'air' ? first?.kind : undefined, working: h.state === 'air' && (first?.phase === 'work' || !!heloLow(h)), queue,
  };
}
