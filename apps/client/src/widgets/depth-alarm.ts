/**
 * Depth and ground-clearance alarms of a submarine (pure logic, no DOM).
 * Three bands, each switchable:
 * - upper: shallower than a set depth while not ordered to periscope depth or the surface
 *   (keeps the boat from broaching); it arms only once the boat has been below it,
 * - lower: deeper than a set depth (default 90 % of the test depth),
 * - ground: water under the keel below WARNUNG / GEFAHR.
 * An alarm sounds once when its band is entered; it re-arms only after the boat has left the
 * band by the hysteresis margin, so a boat hovering on the line does not repeat it.
 */
export interface DepthAlarmCfg {
  upperOn: boolean;
  upper: number;
  lowerOn: boolean;
  lower: number;
  groundOn: boolean;
  groundWarn: number;
  groundDanger: number;
}

export type AlarmLevel = 0 | 1 | 2; // none, WARNUNG, GEFAHR
export type AlarmKind = 'upper' | 'lower' | 'ground';

export interface AlarmState {
  /** The upper band is armed once the boat has been deeper than it. */
  upperArmed: boolean;
  upper: AlarmLevel;
  lower: AlarmLevel;
  ground: AlarmLevel;
}

export interface AlarmInput {
  depth: number;
  orderDepth: number;
  /** Bottom under the boat (m), undefined where it is not known. */
  bottom?: number;
  periscopeDepth: number;
}

export interface AlarmRaise { kind: AlarmKind; level: AlarmLevel }

/** Metres the boat must leave a band by before that alarm can sound again. */
export const HYSTERESIS = 3;

export const initialAlarmState = (): AlarmState => ({ upperArmed: false, upper: 0, lower: 0, ground: 0 });

export function defaultAlarmCfg(testDepth: number): DepthAlarmCfg {
  return {
    upperOn: true, upper: 12,
    lowerOn: true, lower: Math.round((testDepth * 0.9) / 5) * 5,
    groundOn: true, groundWarn: 50, groundDanger: 25,
  };
}

/** Keeps values sane: whole metres, inside the hull's range, upper above lower, danger never above warning. */
export function sanitizeCfg(c: Partial<DepthAlarmCfg>, testDepth: number): DepthAlarmCfg {
  const d = defaultAlarmCfg(testDepth);
  const num = (v: unknown, def: number, lo: number, hi: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : def;
  const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
  const groundWarn = num(c.groundWarn, d.groundWarn, 5, 300);
  const lower = num(c.lower, d.lower, 10, Math.max(10, testDepth * 1.2));
  return {
    upperOn: bool(c.upperOn, d.upperOn),
    // The upper limit stays at least 10 m above the lower one
    upper: Math.min(num(c.upper, d.upper, 0, testDepth), lower - 10),
    lowerOn: bool(c.lowerOn, d.lowerOn),
    lower,
    groundOn: bool(c.groundOn, d.groundOn),
    groundWarn,
    groundDanger: Math.min(groundWarn, num(c.groundDanger, d.groundDanger, 1, 300)),
  };
}

/**
 * Next alarm state for one reading. `raised` lists the bands that just got worse
 * (entered, or WARNUNG → GEFAHR): only those sound and are announced.
 */
export function stepAlarms(prev: AlarmState, cfg: DepthAlarmCfg, inp: AlarmInput): { state: AlarmState; raised: AlarmRaise[] } {
  const raised: AlarmRaise[] = [];
  const H = HYSTERESIS;
  const { depth } = inp;

  // Upper: ordering periscope depth or shallower is deliberate and silences it
  let upperArmed = prev.upperArmed || depth > cfg.upper + H;
  let upper: AlarmLevel = prev.upper;
  const surfacing = inp.orderDepth <= inp.periscopeDepth + 1;
  if (!cfg.upperOn || surfacing) upper = 0;
  else if (upper && depth > cfg.upper + H) upper = 0;
  else if (!upper && upperArmed && depth < cfg.upper) upper = 1;
  if (surfacing) upperArmed = false;

  let lower: AlarmLevel = prev.lower;
  if (!cfg.lowerOn) lower = 0;
  else if (lower && depth < cfg.lower - H) lower = 0;
  else if (!lower && depth > cfg.lower) lower = 1;

  let ground: AlarmLevel = prev.ground;
  if (!cfg.groundOn || inp.bottom === undefined) ground = 0;
  else {
    const clear = inp.bottom - depth;
    if (clear < cfg.groundDanger) ground = 2;
    else if (ground === 2 && clear > cfg.groundDanger + H) ground = clear < cfg.groundWarn ? 1 : 0;
    if (ground === 1 && clear > cfg.groundWarn + H) ground = 0;
    else if (ground === 0 && clear < cfg.groundWarn) ground = 1;
  }

  if (upper > prev.upper) raised.push({ kind: 'upper', level: upper });
  if (lower > prev.lower) raised.push({ kind: 'lower', level: lower });
  if (ground > prev.ground) raised.push({ kind: 'ground', level: ground });
  return { state: { upperArmed, upper, lower, ground }, raised };
}

/** Worst active level. */
export const worstLevel = (s: AlarmState): AlarmLevel => Math.max(s.upper, s.lower, s.ground) as AlarmLevel;

/** Short console label of a band (German, without numbers so the UI dictionary translates it). */
export function alarmLabel(kind: AlarmKind, level: AlarmLevel): string {
  if (kind === 'upper') return 'ZU FLACH';
  if (kind === 'lower') return 'UNTER TIEFENGRENZE';
  return level === 2 ? 'GRUNDABSTAND · GEFAHR' : 'GRUNDABSTAND · WARNUNG';
}

/** Active bands, worst first. */
export function activeAlarms(s: AlarmState): AlarmRaise[] {
  const all: AlarmRaise[] = [
    { kind: 'ground', level: s.ground }, { kind: 'lower', level: s.lower }, { kind: 'upper', level: s.upper },
  ];
  return all.filter((a) => a.level > 0).sort((a, b) => b.level - a.level);
}

const KEY = (cls: string) => `tk_depthalarm_${cls}`;

/** Settings of one boat class from storage (defaults when missing or broken). */
export function loadAlarmCfg(cls: string, testDepth: number, store: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): DepthAlarmCfg {
  try {
    const raw = store?.getItem(KEY(cls));
    return sanitizeCfg(raw ? (JSON.parse(raw) as Partial<DepthAlarmCfg>) : {}, testDepth);
  } catch {
    return defaultAlarmCfg(testDepth);
  }
}

export function saveAlarmCfg(cls: string, cfg: DepthAlarmCfg, store: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    store?.setItem(KEY(cls), JSON.stringify(cfg));
  } catch {
    /* storage full or blocked: settings stay for this session */
  }
}
