import { Rng } from './rng.js';

/**
 * Convoy zigzag plans (F28). Real convoys zigzagged by numbered diagrams: irregular legs of
 * 3–20 min and 10–60° off the base course, executed by all ships together on the commodore's
 * signal (each ship turns where she is, the formation keeps its bearing on the base course).
 * The commodore picks the plan; a sharper plan is harder for a submarine's TMA but costs speed
 * of advance (about the cosine of the mean angle).
 *
 * Six plan types; the legs of each are drawn from the match seed, so a plan has the same shape
 * in every match but its own irregular rhythm. The legs keep the sideways swing within
 * ZIG_SWING_M of the base track at the reference speed (the mine-detour band in
 * bots/mine-cm.ts assumes it) and the cycle ends back on the base track.
 */

export interface ZigLeg {
  /** Course off the base course (deg, + starboard). */
  dc: number;
  /** Duration (s). */
  s: number;
}

export interface ZigPlanType {
  name: string;
  /** Short description for the commander's panel. */
  text: string;
  angle: [number, number];
  /** Leg durations (min). */
  leg: [number, number];
  legs: number;
  /** Chance that the next leg goes to the same side again (irregular plans). */
  same: number;
}

/** Plan types 1–6 (index 0 = plan 1). */
export const ZIG_PLANS: readonly ZigPlanType[] = [
  { name: 'PLAN 1', text: 'FLACH · LANGE SCHLÄGE', angle: [10, 20], leg: [8, 16], legs: 6, same: 0.15 },
  { name: 'PLAN 2', text: 'MITTEL · REGELMÄSSIG', angle: [20, 30], leg: [5, 9], legs: 8, same: 0 },
  { name: 'PLAN 3', text: 'UNREGELMÄSSIG', angle: [10, 40], leg: [3, 12], legs: 10, same: 0.3 },
  { name: 'PLAN 4', text: 'WEIT · KURZE SCHLÄGE', angle: [30, 45], leg: [3, 6], legs: 10, same: 0 },
  { name: 'PLAN 5', text: 'HAKEN · KURZE 60°-SCHLÄGE', angle: [15, 25], leg: [5, 10], legs: 8, same: 0.2 },
  { name: 'PLAN 6', text: 'ASYMMETRISCH', angle: [12, 40], leg: [4, 14], legs: 8, same: 0 },
];

/** Largest sideways swing off the base track at the reference speed (m). */
export const ZIG_SWING_M = 900;
/** Speed the swing is measured at (m/s, 9 kn). */
const REF_MS = 9 * 0.5144;
const MIN_LEG_S = 120;

/** The legs of plan `n` (1–6) for this match: deterministic from the seed. */
export function zigPlanLegs(n: number, seed: number): ZigLeg[] {
  const type = ZIG_PLANS[Math.max(0, Math.min(ZIG_PLANS.length - 1, Math.round(n) - 1))]!;
  const r = new Rng(((seed >>> 0) * 2654435761 + n * 40503) >>> 0 || 1);
  const out: ZigLeg[] = [];
  let y = 0;
  let side = r.next() < 0.5 ? -1 : 1;
  for (let i = 0; i < type.legs; i++) {
    let a = r.range(type.angle[0], type.angle[1]);
    let d = r.range(type.leg[0], type.leg[1]) * 60;
    // Plan 5: every third leg a short hook of 50–60°; plan 6: one side steep and short, the other shallow and long
    if (n === 5 && i % 3 === 2) { a = r.range(50, 60); d = r.range(2, 3.5) * 60; }
    if (n === 6) {
      if (side > 0) { a = r.range(30, 40); d = r.range(3, 6) * 60; }
      else { a = r.range(12, 18); d = r.range(8, 14) * 60; }
    }
    // Keep inside the swing: shorten the leg, or turn to the other side
    const room = (ZIG_SWING_M - side * y) / (REF_MS * Math.sin((a * Math.PI) / 180));
    if (room < MIN_LEG_S) {
      side = -side;
      const room2 = (ZIG_SWING_M - side * y) / (REF_MS * Math.sin((a * Math.PI) / 180));
      d = Math.max(MIN_LEG_S, Math.min(d, room2));
    } else d = Math.min(d, room);
    d = Math.round(d / 10) * 10;
    out.push({ dc: Math.round(side * a), s: d });
    y += side * REF_MS * d * Math.sin((a * Math.PI) / 180);
    if (r.next() >= type.same) side = -side;
  }
  // Back onto the base track: one or two closing legs at the plan's mean angle
  for (let k = 0; k < 3 && Math.abs(y) > 50; k++) {
    const a = (type.angle[0] + type.angle[1]) / 2;
    const s = -Math.sign(y);
    const d = Math.min(type.leg[1] * 60, Math.abs(y) / (REF_MS * Math.sin((a * Math.PI) / 180)));
    const dd = Math.max(60, Math.round(d / 10) * 10);
    out.push({ dc: Math.round(s * a), s: dd });
    y += s * REF_MS * dd * Math.sin((a * Math.PI) / 180);
  }
  return out;
}

/** One cycle of the plan (s). */
export function zigCycle(legs: readonly ZigLeg[]): number {
  return legs.reduce((a, l) => a + l.s, 0);
}

/** Course off the base course at time `t` since the plan started (deg), and when the current leg ends. */
export function zigOffset(legs: readonly ZigLeg[], t: number): { dc: number; leftS: number } {
  const cyc = zigCycle(legs);
  if (!legs.length || cyc <= 0) return { dc: 0, leftS: 0 };
  let u = ((t % cyc) + cyc) % cyc;
  for (const l of legs) {
    if (u < l.s) return { dc: l.dc, leftS: l.s - u };
    u -= l.s;
  }
  return { dc: 0, leftS: 0 };
}

/** Speed of advance along the base course as a fraction of the speed through the water. */
export function zigAdvance(legs: readonly ZigLeg[]): number {
  const cyc = zigCycle(legs);
  if (!cyc) return 1;
  return legs.reduce((a, l) => a + Math.cos((l.dc * Math.PI) / 180) * l.s, 0) / cyc;
}

/** The plan a convoy gets by default (zigzag on, nothing ordered): one of the moderate plans 1–3, from the seed. */
export function defaultZigPlan(seed: number): number {
  return 1 + ((((seed >>> 0) * 2246822519) >>> 0) % 3);
}
