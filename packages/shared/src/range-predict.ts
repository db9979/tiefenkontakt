import { DEFAULT_ENV, passiveExcessFrom, sonarDepth, sourceLevel, type Environment } from './acoustics.js';
import { CLASSES, type ClassId } from './classes.js';
import { createShip, type Ship } from './entities.js';
import { DEEP_M, type SeabedKind } from './seabed.js';
import { belowHull, towedArrayDepth } from './sensors.js';

/**
 * Listening-range prediction: a range × depth section of where a typical target can be heard
 * and where an enemy sonar would hear the own ship. It only evaluates the acoustics model the
 * sensors use (passiveExcessFrom, blind cone below the hull, towed-array depth) with what the
 * player legitimately knows: own state, sea state, water depth, and the layer only if measured.
 * No fading, masking, terrain or crew effects: it is a forecast for a typical situation.
 */

export interface RangePredictInput {
  ownCls: ClassId;
  /** Own team decides the reference targets (escorts or boats of the other side). */
  ownTeam: 'west' | 'east';
  ownDepth: number;
  ownSpeedKn: number;
  /** Own towed array out (m); 0 = in. Own variable-depth sonar depth (m). */
  towedLength?: number;
  vdsDepth?: number;
  seaState: number;
  rain?: boolean;
  /** Measured layer depth (m, 0 = no layer); undefined = not known to the player. */
  layerDepth?: number;
  /** Water depth under the own ship (m); seabed kind as a fallback. */
  bottom?: number;
  seabedKind?: SeabedKind;
}

export interface RefTarget {
  cls: ClassId;
  speedKn: number;
  /** Short German name for the summary line. */
  name: string;
}

export interface RangePrediction {
  /** Column centres (m) and row depths (m) of the grid. */
  ranges: number[];
  depths: number[];
  /** y axis is the depth of the submerged party: own depth for a boat, target depth for a surface ship. */
  axis: 'own' | 'target';
  /** Row closest to the own depth (boats), or -1 when the y axis is the target's depth. */
  ownRow: number;
  refs: [RefTarget, ...RefTarget[]];
  /** Signal excess (dB) per reference target, [ref][row][col]: we hear them where > 0. */
  hear: [Float32Array, ...Float32Array[]];
  /** Signal excess of the enemy sonar listening for us, [row][col]: they hear us where > 0. */
  heard: Float32Array;
  /** Enemy listener used for counter-detection. */
  enemy: RefTarget;
  layerDepth?: number;
  layerKnown: boolean;
  bottom: number;
  maxDepth: number;
  maxRange: number;
}

const COLS = 64;
const ROWS = 32;
/** Deep water: the grid reaches past the first convergence zone (50–62 km). */
const DEEP_RANGE_M = 64_000;
const NEAR_RANGE_M = 32_000;
const MAX_DEPTH_M = 400;
const FALLBACK_BOTTOM: Record<SeabedKind, number> = { tief: 3000, schelf: 150, fjord: 300 };

/** Reference targets the own side typically listens for, and the enemy that listens for us. */
export function referenceTargets(cls: ClassId, team: 'west' | 'east'): { refs: [RefTarget, ...RefTarget[]]; enemy: RefTarget } {
  const sub = CLASSES[cls].submarine;
  if (sub) {
    return team === 'east'
      ? { refs: [{ cls: 'ffg', speedKn: 15, name: 'FREGATTE' }, { cls: 'merchant', speedKn: 9, name: 'FRACHTER' }], enemy: { cls: 'ffg', speedKn: 15, name: 'FREGATTE' } }
      : { refs: [{ cls: 'ffk', speedKn: 15, name: 'WACHSCHIFF' }], enemy: { cls: 'ffk', speedKn: 15, name: 'WACHSCHIFF' } };
  }
  const boat: RefTarget = team === 'west' ? { cls: 'ssk', speedKn: 5, name: 'U-BOOT' } : { cls: 'ssw', speedKn: 5, name: 'U-BOOT' };
  return { refs: [boat], enemy: boat };
}

function makeShip(cls: ClassId, speedKn: number, depth: number, extra: Partial<Ship> = {}): Ship {
  const s = createShip({ id: cls, cls, name: cls, pos: { x: 0, y: 0 }, heading: 0, speedKn, depth });
  if (!CLASSES[cls].submarine) s.depth = CLASSES[cls].draft;
  return Object.assign(s, extra);
}

/** Best signal excess of a listener (hull and, if streamed, towed array) for a source level at a depth. */
function listen(sl: number, srcDepth: number, rx: Ship, range: number, env: Environment, bottom: number): number {
  const spec = CLASSES[rx.cls];
  let best = -Infinity;
  if (spec.hull.di > 0 && !belowHull(rx, { depth: srcDepth } as Ship, range)) {
    best = passiveExcessFrom(sl, srcDepth, rx, range, 'hull', env, sonarDepth(rx), bottom);
  }
  if (spec.towed && rx.towedLength > 0) {
    best = Math.max(best, passiveExcessFrom(sl, srcDepth, rx, range, 'towed', env, Math.min(towedArrayDepth(rx), bottom - 10), bottom));
  }
  return best;
}

function waterDepth(inp: RangePredictInput): number {
  return inp.bottom ?? (inp.seabedKind ? FALLBACK_BOTTOM[inp.seabedKind] : 3000);
}

function compute(inp: RangePredictInput): RangePrediction {
  const bottom = Math.max(20, waterDepth(inp));
  const layerKnown = inp.layerDepth !== undefined;
  // Unknown layer: assume none (a coarse, optimistic estimate; the widget says so)
  const env: Environment = { layerDepth: inp.layerDepth ?? 0, layerLoss: DEFAULT_ENV.layerLoss, seaState: inp.seaState, rain: inp.rain };
  const ownSub = CLASSES[inp.ownCls].submarine;
  const { refs, enemy } = referenceTargets(inp.ownCls, inp.ownTeam);
  const maxDepth = Math.min(bottom - 5, MAX_DEPTH_M, ownSub ? CLASSES[inp.ownCls].maxDepth : CLASSES[enemy.cls].maxDepth || MAX_DEPTH_M);
  const maxRange = bottom > DEEP_M ? DEEP_RANGE_M : NEAR_RANGE_M;
  const ranges = Array.from({ length: COLS }, (_, i) => ((i + 0.5) * maxRange) / COLS);
  const depths = Array.from({ length: ROWS }, (_, j) => Math.max(1, (j * maxDepth) / (ROWS - 1)));
  const hear = refs.map(() => new Float32Array(ROWS * COLS)) as [Float32Array, ...Float32Array[]];
  const heard = new Float32Array(ROWS * COLS);
  const ownExtra: Partial<Ship> = { towedLength: inp.towedLength ?? 0, lastTurnAt: -1e9, vdsDepth: inp.vdsDepth };
  // Enemy listener: escorts stream half their towed array; boats listen on the hull
  const enemyTowed = CLASSES[enemy.cls].towed ? CLASSES[enemy.cls].towed!.maxLength / 2 : 0;
  for (let j = 0; j < ROWS; j++) {
    const d = depths[j]!;
    // y axis: the depth of the submerged party
    const own = makeShip(inp.ownCls, inp.ownSpeedKn, ownSub ? d : inp.ownDepth, ownExtra);
    const ownSl = sourceLevel(own);
    const tgts = refs.map((r) => makeShip(r.cls, r.speedKn, ownSub ? 60 : d));
    const tgtSl = tgts.map((t) => sourceLevel(t));
    const foe = makeShip(enemy.cls, enemy.speedKn, ownSub ? 60 : d, { towedLength: enemyTowed });
    for (let i = 0; i < COLS; i++) {
      const r = ranges[i]!;
      for (let k = 0; k < refs.length; k++) hear[k]![j * COLS + i] = listen(tgtSl[k]!, tgts[k]!.depth, own, r, env, bottom);
      heard[j * COLS + i] = listen(ownSl, own.depth, foe, r, env, bottom);
    }
  }
  const ownRow = ownSub ? nearestRow(depths, inp.ownDepth) : -1;
  return { ranges, depths, axis: ownSub ? 'own' : 'target', ownRow, refs, hear, heard, enemy, layerDepth: inp.layerDepth, layerKnown, bottom, maxDepth, maxRange };
}

function nearestRow(depths: number[], d: number): number {
  let best = 0;
  for (let j = 1; j < depths.length; j++) if (Math.abs(depths[j]! - d) < Math.abs(depths[best]! - d)) best = j;
  return best;
}

let cache: { key: string; p: RangePrediction } | undefined;

/** Prediction for the given inputs; cached (inputs are rounded so small drifts don't recompute). */
export function predictRanges(inp: RangePredictInput): RangePrediction {
  const key = [inp.ownCls, inp.ownTeam, Math.round(inp.ownDepth / 5), Math.round(inp.ownSpeedKn), inp.towedLength ?? 0, Math.round((inp.vdsDepth ?? 0) / 5),
    inp.seaState, inp.rain ? 1 : 0, inp.layerDepth ?? 'x', Math.round(waterDepth(inp) / 10)].join('|');
  if (cache?.key === key) return cache.p;
  cache = { key, p: compute(inp) };
  return cache.p;
}

/** Contiguous range (m) from close in out to where the signal excess first drops below zero in a row. */
export function rowRange(p: RangePrediction, se: Float32Array, row: number): number {
  const cols = p.ranges.length;
  let last = 0;
  for (let i = 0; i < cols; i++) {
    if (se[row * cols + i]! <= 0) break;
    last = p.ranges[i]! + p.maxRange / cols / 2;
  }
  return last;
}

/** Convergence zone: detection again beyond a gap of no detection (deep water only in the model). */
export function czBand(p: RangePrediction, se: Float32Array, row: number): [number, number] | undefined {
  const cols = p.ranges.length;
  const on = (i: number) => se[row * cols + i]! > 0;
  let i = 0;
  while (i < cols && on(i)) i++;
  while (i < cols && !on(i)) i++;
  if (i >= cols) return undefined;
  const from = p.ranges[i]!;
  while (i + 1 < cols && on(i + 1)) i++;
  return [from, p.ranges[i]!];
}

/** Range bounds over all rows: [worst, best] contiguous range in m. */
export function rangeSpread(p: RangePrediction, se: Float32Array): [number, number] {
  let lo = Infinity, hi = 0;
  for (let j = 0; j < p.depths.length; j++) {
    const r = rowRange(p, se, j);
    lo = Math.min(lo, r);
    hi = Math.max(hi, r);
  }
  return [lo, hi];
}

const km = (m: number) => (m <= 0 ? '0' : m < 1000 ? '1' : String(Math.round(m / 1000)));

/** One-line summary, e.g. "HÖRT FREGATTE BIS ~14 KM · WIRD GEHÖRT BIS ~6 KM". */
export function predictionSummary(p: RangePrediction): string {
  const parts: string[] = [];
  if (p.axis === 'own') {
    const row = p.ownRow;
    p.refs.forEach((r, k) => parts.push(`${k ? '' : 'HÖRT '}${r.name} BIS ~${km(rowRange(p, p.hear[k]!, row))} KM`));
    parts.push(`WIRD GEHÖRT BIS ~${km(rowRange(p, p.heard, row))} KM`);
    const cz = czBand(p, p.hear[0], row);
    if (cz) parts.push(`KONVERGENZZONE ${km(cz[0])}–${km(cz[1])} KM`);
  } else {
    const span = (se: Float32Array) => {
      const [lo, hi] = rangeSpread(p, se).map(km);
      return lo === hi ? `BIS ~${hi}` : `${lo}–${hi}`;
    };
    parts.push(`HÖRT ${p.refs[0].name} ${span(p.hear[0])} KM JE NACH TIEFE`);
    parts.push(`WIRD GEHÖRT ${span(p.heard)} KM`);
  }
  return parts.join(' · ');
}
