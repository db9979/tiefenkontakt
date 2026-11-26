import { angleDiff, bearing, distance, headingVec, type ContactTrack, type FriendlyView, type Ship, type Vec2, type World } from '@tk/shared';

/**
 * Tactical datalink between the surface ships of a side (F13), after Link 11: a roll-call net in
 * which every unit reports its picture once per net cycle (2–15 s; 12 s here, each unit at its
 * own phase), so a mate's tracks arrive 3–15 s old. Every unit reports in its own navigation
 * frame: a gridlock error of a few hundred metres per unit (the "0.5–1 nm gridlock" headache of
 * an ASW commander, kept smaller here so the friendly correlation still holds). Tracks are
 * correlated by a position/bearing gate, never by who the target really is: a mate's track that
 * passes the gate with one already in the picture is merged into it; otherwise it stays a track
 * of its own (a dual track of the same submarine is possible, and so are two bearing lines that
 * the operator crosses himself).
 */

/** Net cycle (s) and processing/transmission delay (s). */
export const LINK_CYCLE_S = 12;
export const LINK_DELAY_S = 3;
/** Gridlock error per unit (m): drawn per ship and side, 150–400 m. */
export const GRIDLOCK_MIN_M = 150;
export const GRIDLOCK_MAX_M = 400;
/** Gates: positional tracks within this (m), a fix within this of a bearing line (m, at least), bearing lines this close (deg). */
export const GATE_POS_M = 1000;
export const GATE_LINE_M = 500;
export const GATE_BRG_DEG = 3;
/** Bearing lines compare only from origins this close together (m). */
const LINE_ORIGIN_M = 2000;
/** A merged track stays merged until it is this much outside the gate (hysteresis). */
const HOLD = 1.6;
/** A ranged sample this fresh gives a track a position (s). */
const FIX_AGE_S = 120;
/** Positions kept per ship for the reports' origins (s between samples, kept span s). */
const POS_EVERY_S = 5;
const POS_KEEP_S = 900;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** When the latest report of this unit that has reached the others was made (sim time). */
export function linkReportTime(id: string, now: number): number {
  const phase = hash(id) % LINK_CYCLE_S;
  return Math.floor((now - LINK_DELAY_S - phase) / LINK_CYCLE_S) * LINK_CYCLE_S + phase;
}

/** The unit's gridlock error: a fixed offset of everything it reports (m). */
export function gridlock(s: Pick<Ship, 'id' | 'team'>): Vec2 {
  const h = hash(`${s.team}:${s.id}`);
  const a = ((h % 3600) / 10) * (Math.PI / 180);
  const r = GRIDLOCK_MIN_M + ((h >>> 12) % 1000) / 1000 * (GRIDLOCK_MAX_M - GRIDLOCK_MIN_M);
  return { x: Math.sin(a) * r, y: Math.cos(a) * r };
}

/** Ship position log per world, for where a mate was when it took a bearing. */
const logs = new WeakMap<World, Map<string, { t: number; x: number; y: number }[]>>();

/** Log the link ships' positions (every few seconds; cheap, called with each snapshot). */
export function logPositions(w: World, ships: readonly Ship[]): void {
  let m = logs.get(w);
  if (!m) logs.set(w, (m = new Map()));
  for (const s of ships) {
    let l = m.get(s.id);
    if (!l) m.set(s.id, (l = []));
    const last = l[l.length - 1];
    if (last && last.t > w.time) l.length = 0; // a restored save ran the clock back
    if (last && w.time - last.t < POS_EVERY_S && l.length) continue;
    l.push({ t: w.time, x: s.pos.x, y: s.pos.y });
    while (l.length && w.time - l[0]!.t > POS_KEEP_S) l.shift();
  }
}

/** Where the ship was at time t (interpolated from the log; dead reckoned back without one). */
export function posAt(w: World, s: Ship, t: number): Vec2 {
  const l = logs.get(w)?.get(s.id);
  if (l?.length) {
    for (let i = l.length - 1; i >= 0; i--) {
      const a = l[i]!;
      if (a.t <= t) {
        const b = l[i + 1];
        if (!b) break;
        const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      }
    }
    if (t < l[0]!.t) return { x: l[0]!.x, y: l[0]!.y };
  }
  const v = headingVec(s.heading);
  const back = Math.max(0, w.time - t) * s.speed;
  return { x: s.pos.x - v.x * back, y: s.pos.y - v.y * back };
}

/** The mate as the link shows it: position at its last report, in its own (gridlocked) frame. */
export function linkedFriendly(w: World, m: Ship, base: FriendlyView): FriendlyView {
  const tr = linkReportTime(m.id, w.time);
  const p = posAt(w, m, tr);
  const g = gridlock(m);
  return { ...base, x: p.x + g.x, y: p.y + g.y, reportedAt: tr };
}

type Sample = ContactTrack['history'][number];

/** A mate's track as reported at its last net cycle, every bearing with its (gridlocked) origin. */
export function reportedTrack(w: World, m: Ship, tr: ContactTrack): (ContactTrack & { linkAgeS: number }) | undefined {
  const at = linkReportTime(m.id, w.time);
  if (tr.firstSeen > at) return undefined;
  const g = gridlock(m);
  const hist: Sample[] = [];
  for (const s of tr.history) {
    if (s.t > at) break;
    const o = s.ox !== undefined && s.oy !== undefined ? { x: s.ox, y: s.oy } : posAt(w, m, s.t);
    hist.push({ ...s, ox: Math.round(o.x + g.x), oy: Math.round(o.y + g.y) });
  }
  const last = hist[hist.length - 1];
  if (!last) return undefined;
  const ranged = [...hist].reverse().find((s) => s.r !== undefined && s.alt === undefined);
  const rangeOk = tr.rangeAt !== undefined && tr.rangeAt <= at;
  return {
    ...tr, history: hist, lastSeen: last.t, bearing: last.b, originX: last.ox, originY: last.oy,
    range: rangeOk ? tr.range : ranged?.r, rangeAt: rangeOk ? tr.rangeAt : ranged?.t,
    linkAgeS: Math.round(w.time - at),
  };
}

/** What a track says of where the target is: a fix, or a bearing line from an origin. */
export interface Picture {
  label: string;
  fix?: Vec2;
  line?: { o: Vec2; b: number };
  cls: 'acoustic' | 'esm' | 'sight';
  classified?: string;
}

const SIGHT = new Set(['radar', 'visual', 'periscope']);

/** A track's picture: `own` gives the own ship's track for samples without an origin. */
export function pictureOf(tr: ContactTrack, now: number, own: (t: number) => Vec2): Picture {
  const at = (s: Sample) => (s.ox !== undefined && s.oy !== undefined ? { x: s.ox, y: s.oy } : own(s.t));
  let fix: Vec2 | undefined;
  for (let i = tr.history.length - 1; i >= 0; i--) {
    const s = tr.history[i]!;
    if (now - s.t > FIX_AGE_S) break;
    if (s.r === undefined || s.alt !== undefined) continue;
    const o = at(s);
    const v = headingVec(s.b);
    fix = { x: o.x + v.x * s.r, y: o.y + v.y * s.r };
    break;
  }
  const last = tr.history[tr.history.length - 1];
  const line = last ? { o: at(last), b: last.b } : undefined;
  const cls = tr.sensors.includes('esm') && tr.sensors.length === 1 ? 'esm' : tr.sensors.some((k) => SIGHT.has(k)) ? 'sight' : 'acoustic';
  return { label: tr.label, fix, line, cls, classified: tr.classified };
}

/** Miss distance of two pictures over their gate (below 1 = inside), Infinity when they cannot be compared. */
export function gateScore(a: Picture, b: Picture): number {
  if (a.classified && b.classified && a.classified !== b.classified) return Infinity;
  if (a.fix && b.fix) return distance(a.fix, b.fix) / GATE_POS_M;
  const fixLine = (f: Vec2, l: { o: Vec2; b: number }) => {
    const d = distance(l.o, f);
    const off = Math.abs(angleDiff(l.b, bearing(l.o, f)));
    if (off > 90) return Infinity;
    const miss = d * Math.sin((off * Math.PI) / 180);
    return miss / Math.max(GATE_LINE_M, d * Math.tan((GATE_BRG_DEG * Math.PI) / 180));
  };
  if (a.fix && b.line) return fixLine(a.fix, b.line);
  if (b.fix && a.line) return fixLine(b.fix, a.line);
  if (a.line && b.line && a.cls === b.cls && distance(a.line.o, b.line.o) < LINE_ORIGIN_M) return Math.abs(angleDiff(a.line.b, b.line.b)) / GATE_BRG_DEG;
  return Infinity;
}

/**
 * Correlate a mate's reported track with the picture so far: the label it merges into, or
 * undefined (it stays a track of its own). `was` is the label it merged into last time.
 */
export function correlate(p: Picture, picture: readonly Picture[], was?: string): string | undefined {
  let best: { label: string; s: number } | undefined;
  for (const q of picture) {
    const s = gateScore(p, q) / (q.label === was ? HOLD : 1);
    if (s <= 1 && (!best || s < best.s)) best = { label: q.label, s };
  }
  return best?.label;
}

/** Own ship's position at time t for own samples without an origin (the own ship, near enough). */
export function ownAt(w: World, own: Ship): (t: number) => Vec2 {
  return (t) => posAt(w, own, t);
}

