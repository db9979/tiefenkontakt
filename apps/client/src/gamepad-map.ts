/**
 * Pure gamepad mapping (no DOM): dead zone, edge detection with hold repeat, and the
 * rate-limited course stick. gamepad.ts feeds it navigator.getGamepads() each frame.
 *
 * Standard mapping (https://w3c.github.io/gamepad/#remapping):
 *   left stick X  course (rate grows with deflection; at most one order per 250 ms)
 *   RT / LT       speed +1 / −1 kn (hold repeats)
 *   D-pad ↑ / ↓   depth −10 / +10 m (U-boat; hold repeats)
 *   D-pad ← / →   course −1° / +1° (fine)
 *   LB / RB       previous / next station
 *   Start         ⚙ menu · Back/Select  help
 */

export const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;

export const DEAD_ZONE = 0.2;
/** Analog trigger travel that counts as a press. */
export const TRIGGER_PRESS = 0.5;
/** Course change at full stick deflection, degrees per second. */
export const COURSE_RATE = 30;
/** Minimum time between two course orders from the stick. */
export const COURSE_INTERVAL_MS = 250;
export const REPEAT_DELAY_MS = 400;
export const REPEAT_EVERY_MS = 150;

export interface PadButton { pressed: boolean; value: number }
export interface PadState { axes: readonly number[]; buttons: readonly PadButton[] }

export type PadAction =
  | { kind: 'course'; heading: number }
  | { kind: 'speed'; delta: number }
  | { kind: 'depth'; delta: number }
  | { kind: 'turn'; delta: number }
  | { kind: 'station'; delta: number }
  | { kind: 'menu' }
  | { kind: 'help' };

/** Axis value with the dead zone removed and the rest rescaled to 0…±1. */
export function deadZone(v: number, dz = DEAD_ZONE): number {
  const a = Math.abs(v);
  if (!Number.isFinite(v) || a <= dz) return 0;
  return (Math.sign(v) * (Math.min(a, 1) - dz)) / (1 - dz);
}

/** Lets one event through per interval. */
export class RateLimiter {
  private last = -Infinity;
  constructor(readonly intervalMs: number) {}
  ready(now: number): boolean {
    if (now - this.last < this.intervalMs) return false;
    this.last = now;
    return true;
  }
}

/** Rising edge of a digital input; with repeat, held inputs fire again after a delay. */
export class Edge {
  private down = false;
  private next = 0;
  constructor(private readonly repeat = false) {}
  /** True on the frame the input goes down (and on each repeat while held). */
  update(pressed: boolean, now: number): boolean {
    if (!pressed) {
      this.down = false;
      return false;
    }
    if (!this.down) {
      this.down = true;
      this.next = now + REPEAT_DELAY_MS;
      return true;
    }
    if (this.repeat && now >= this.next) {
      this.next = now + REPEAT_EVERY_MS;
      return true;
    }
    return false;
  }
}

const wrap = (h: number) => ((h % 360) + 360) % 360;

/**
 * Stick course control: while deflected, a local target heading turns from the ordered
 * heading at up to COURSE_RATE °/s; the target is sent at most every COURSE_INTERVAL_MS
 * and once more when the stick is released, so no order is lost and none is sent per frame.
 */
export class CourseStick {
  private target: number | undefined;
  private sent: number | undefined;
  private base = 0;
  private lastNow: number | undefined;
  private readonly limit = new RateLimiter(COURSE_INTERVAL_MS);

  /** Returns a heading to order now, or undefined. `ordered` is the current ordered heading. */
  update(x: number, now: number, ordered: number | undefined): number | undefined {
    const v = deadZone(x);
    const dt = this.lastNow === undefined ? 0 : Math.min(0.1, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;
    if (v === 0 || ordered === undefined) {
      const last = this.target === undefined ? undefined : wrap(Math.round(this.target));
      const flush = last !== undefined && last !== (this.sent ?? this.base) ? last : undefined;
      this.target = this.sent = undefined;
      return flush;
    }
    if (this.target === undefined) {
      this.target = ordered;
      this.base = wrap(Math.round(ordered));
    }
    // Squared response: small deflection for fine corrections, full for hard turns
    this.target = wrap(this.target + Math.sign(v) * v * v * COURSE_RATE * dt);
    const h = wrap(Math.round(this.target));
    if (h === (this.sent ?? this.base) || !this.limit.ready(now)) return undefined;
    this.sent = h;
    return h;
  }
}

const pressed = (p: PadState, i: number) => {
  const b = p.buttons[i];
  return !!b && (b.pressed || b.value > TRIGGER_PRESS);
};

/** Turns successive pad states into game actions. One instance per pad. */
export class PadMapper {
  private readonly course = new CourseStick();
  private readonly edges = new Map<number, Edge>();
  private static readonly REPEAT = new Set<number>([BTN.LT, BTN.RT, BTN.UP, BTN.DOWN, BTN.LEFT, BTN.RIGHT]);

  private edge(p: PadState, i: number, now: number): boolean {
    let e = this.edges.get(i);
    if (!e) this.edges.set(i, (e = new Edge(PadMapper.REPEAT.has(i))));
    return e.update(pressed(p, i), now);
  }

  /** `ordered`: current ordered heading, or undefined outside a match. */
  step(p: PadState, now: number, ordered: number | undefined): PadAction[] {
    const out: PadAction[] = [];
    const heading = this.course.update(p.axes[0] ?? 0, now, ordered);
    if (heading !== undefined) out.push({ kind: 'course', heading });
    if (this.edge(p, BTN.RT, now)) out.push({ kind: 'speed', delta: 1 });
    if (this.edge(p, BTN.LT, now)) out.push({ kind: 'speed', delta: -1 });
    if (this.edge(p, BTN.UP, now)) out.push({ kind: 'depth', delta: -10 });
    if (this.edge(p, BTN.DOWN, now)) out.push({ kind: 'depth', delta: 10 });
    if (this.edge(p, BTN.LEFT, now)) out.push({ kind: 'turn', delta: -1 });
    if (this.edge(p, BTN.RIGHT, now)) out.push({ kind: 'turn', delta: 1 });
    if (this.edge(p, BTN.LB, now)) out.push({ kind: 'station', delta: -1 });
    if (this.edge(p, BTN.RB, now)) out.push({ kind: 'station', delta: 1 });
    if (this.edge(p, BTN.START, now)) out.push({ kind: 'menu' });
    if (this.edge(p, BTN.BACK, now)) out.push({ kind: 'help' });
    return out;
  }
}
