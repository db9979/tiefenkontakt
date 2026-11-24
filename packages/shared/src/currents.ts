import { KN, type Vec2 } from './math.js';
import { depthAt } from './seabed.js';
import { REGIONS, type RegionId } from './regions.js';
import type { Environment } from './acoustics.js';

/**
 * Currents and tides of the real sea areas. A mean set (often two layers: Gibraltar's Atlantic
 * water flows in on top while the salty Mediterranean water runs out below), plus the tidal
 * stream of the semidiurnal tide (M2, 12 h 25 min), along an axis or turning round on the
 * shelf. Directions are degrees true (where the water goes); `route` ones are along the route.
 * The stream slackens in the shallows and stops at the shore. Everything afloat drifts with it.
 */

interface Flow { set: number; kn: number }
interface CurrentSpec {
  surface?: Flow;
  /** A deep counter-current: full below `below` m, blended in over the 50 m above. */
  deep?: Flow & { below: number };
  tide?: { axis: number; kn: number; rotary?: boolean };
  /** Directions measured from the route instead of true north (fjords and lochs). */
  route?: boolean;
  /** A short note for the handbook and the mission card. */
  note: string;
}

export const M2_PERIOD_S = 44_712;

export const CURRENTS: Partial<Record<RegionId, CurrentSpec>> = {
  gibraltar: { surface: { set: 90, kn: 1.8 }, deep: { set: 270, kn: 1.2, below: 150 }, tide: { axis: 90, kn: 2 },
    note: 'Oben strömt Atlantikwasser ostwärts ins Mittelmeer, unter 150 m läuft Mittelmeerwasser westwärts hinaus; dazu der Gezeitenstrom. Wer tief genug geht, treibt mit gestoppter Maschine lautlos hinaus.' },
  dardanellen: { surface: { set: 225, kn: 2 }, deep: { set: 45, kn: 0.6, below: 30 },
    note: 'Oben fließt Schwarzmeerwasser zur Ägäis hinaus, darunter salziges Ägäiswasser hinein.' },
  messina: { tide: { axis: 0, kn: 3.5 }, note: 'Starker Gezeitenstrom durch die Enge, alle sechs Stunden kenternd.' },
  pentland: { tide: { axis: 90, kn: 5.5 }, note: 'Einer der stärksten Gezeitenströme Europas; gegen den Strom kommt ein langsames Schiff kaum voran.' },
  faroebank: { surface: { set: 45, kn: 0.4 }, deep: { set: 250, kn: 1.2, below: 500 }, tide: { axis: 0, kn: 0.6, rotary: true },
    note: 'Oben der Nordatlantikstrom nach Nordost, in der Tiefe der kalte Overflow nach Südwest.' },
  faeroeshetland: { surface: { set: 45, kn: 0.5 }, deep: { set: 225, kn: 0.8, below: 500 }, tide: { axis: 45, kn: 0.6 },
    note: 'Nordatlantikstrom oben nach Nordost, kaltes Tiefenwasser nach Südwest.' },
  islandfaroe: { surface: { set: 60, kn: 0.4 }, deep: { set: 240, kn: 0.6, below: 400 }, note: 'Nordatlantikstrom über dem Rücken, Overflow in der Tiefe.' },
  daenemarkstr: { surface: { set: 210, kn: 0.6 }, deep: { set: 210, kn: 0.9, below: 400 }, note: 'Ostgrönlandstrom und Overflow, beide nach Südwest.' },
  framstr: { surface: { set: 190, kn: 0.5 }, note: 'Ostgrönlandstrom mit dem Eis nach Süden.' },
  rockall: { surface: { set: 30, kn: 0.3 }, note: 'Schwacher Nordatlantikstrom nach Nordnordost.' },
  biskaya: { surface: { set: 180, kn: 0.2 }, tide: { axis: 60, kn: 0.8, rotary: true }, note: 'Schwacher Strom, Gezeiten am Schelfrand.' },
  nordkap: { surface: { set: 80, kn: 0.5 }, tide: { axis: 90, kn: 0.6 }, note: 'Nordkapstrom nach Osten in die Barentssee.' },
  barents: { surface: { set: 70, kn: 0.3 }, tide: { axis: 0, kn: 0.5, rotary: true }, note: 'Nordkapstrom, drehender Gezeitenstrom auf dem Schelf.' },
  kola: { tide: { axis: 0, kn: 0.8 }, route: true, note: 'Gezeitenstrom in der Bucht, ein- und auslaufend.' },
  varanger: { tide: { axis: 0, kn: 0.6 }, route: true, note: 'Gezeitenstrom längs des Fjords.' },
  vestfjord: { surface: { set: 30, kn: 0.4 }, tide: { axis: 45, kn: 1 }, note: 'Norwegischer Küstenstrom, kräftige Gezeiten zum Mahlstrom hin.' },
  lofotenbasin: { surface: { set: 30, kn: 0.5 }, note: 'Norwegischer Strom nach Nordnordost.' },
  ofotfjord: { tide: { axis: 0, kn: 0.6 }, route: true, note: 'Gezeitenstrom längs des Fjords.' },
  trondheim: { tide: { axis: 0, kn: 0.8 }, route: true, note: 'Gezeitenstrom durch die Fjordengen.' },
  hvalfjord: { tide: { axis: 0, kn: 0.5 }, route: true, note: 'Gezeitenstrom in den Fjord und hinaus.' },
  lochewe: { tide: { axis: 0, kn: 0.5 }, route: true, note: 'Gezeitenstrom im Loch.' },
  clyde: { tide: { axis: 0, kn: 0.6 }, route: true, note: 'Gezeitenstrom im Firth.' },
  fladengrund: { tide: { axis: 0, kn: 0.8, rotary: true }, note: 'Drehender Gezeitenstrom der Nordsee.' },
  gotland: { surface: { set: 20, kn: 0.2 }, note: 'Kaum Gezeiten, schwache Windströmung.' },
  bornholm: { surface: { set: 80, kn: 0.2 }, note: 'Kaum Gezeiten, schwache Windströmung.' },
  finnbusen: { surface: { set: 250, kn: 0.2 }, note: 'Kaum Gezeiten, schwacher Ausstrom.' },
};

const rad = (d: number) => (d * Math.PI) / 180;

/** Game-frame vector of a flow (set in degrees in the game frame, speed in m/s). */
const vec = (setGame: number, ms: number): Vec2 => ({ x: Math.sin(rad(setGame)) * ms, y: Math.cos(rad(setGame)) * ms });

/** Tide: phase angle (0 = flood at full strength) at match time t. */
export function tideAngle(env: Environment, t: number): number {
  return (env.tidePhase ?? 0) + (2 * Math.PI * t) / M2_PERIOD_S;
}

/** Current at a point and depth (m/s, game frame). */
export function currentAt(env: Environment, p: Vec2, depth: number, t: number): Vec2 {
  const region = env.seabed?.region;
  const spec = region ? CURRENTS[region] : undefined;
  if (!spec) return env.current ?? { x: 0, y: 0 };
  const water = depthAt(env.seabed, p.x, p.y);
  if (water <= 0) return { x: 0, y: 0 };
  const shore = Math.min(1, water / 15);
  // Directions true → game frame (game +y points along the region's bearing)
  const toGame = spec.route ? 0 : REGIONS[region!].bearing;
  let x = 0, y = 0;
  const add = (set: number, kn: number, k = 1) => {
    const v = vec(set - toGame, kn * KN * k);
    x += v.x; y += v.y;
  };
  const deepW = spec.deep ? Math.max(0, Math.min(1, (depth - (spec.deep.below - 50)) / 50)) : 0;
  if (spec.surface) add(spec.surface.set, spec.surface.kn, 1 - deepW);
  if (spec.deep) add(spec.deep.set, spec.deep.kn, deepW);
  if (spec.tide) {
    const a = tideAngle(env, t);
    if (spec.tide.rotary) add(spec.tide.axis + (a * 180) / Math.PI, spec.tide.kn);
    else add(spec.tide.axis, spec.tide.kn * Math.cos(a));
  }
  return { x: x * shore, y: y * shore };
}

/** The tide for the display: flooding or ebbing, how strong now, seconds until it turns. */
export function tideState(env: Environment, t: number): { kn: number; flood: boolean; turnsInS: number } | undefined {
  const region = env.seabed?.region;
  const tide = region ? CURRENTS[region]?.tide : undefined;
  if (!tide || tide.rotary) return undefined;
  const a = tideAngle(env, t);
  const c = Math.cos(a);
  // Slack water where cos crosses zero: at a = π/2 + kπ
  const toNext = ((Math.PI / 2 - (a % Math.PI) + 2 * Math.PI) % Math.PI);
  return { kn: Math.abs(c) * tide.kn, flood: c >= 0, turnsInS: (toNext / (2 * Math.PI)) * M2_PERIOD_S };
}

/** Note on the area's currents (mission cards, handbook). */
export function currentNote(region: RegionId | undefined): string | undefined {
  return region ? CURRENTS[region]?.note : undefined;
}
