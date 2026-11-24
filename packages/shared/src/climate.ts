import { REGIONS, type RegionId } from './regions.js';

/**
 * Sun and season on the real sea areas. The sun's height follows latitude, date and hour:
 * at the Bear Island in January it stays below the horizon all day (polar night, only a
 * blue twilight at noon), in June it circles the sky at midnight. The sea's layering and the
 * weather follow the area and the season: a sharp warm layer in the Mediterranean summer,
 * deep winter mixing in the Atlantic, the Baltic's halocline, fog in the Arctic summer,
 * ice in the Arctic and Gulf of Finland winter.
 */

export type Season = 'winter' | 'fruehling' | 'sommer' | 'herbst';
export const SEASON_MONTH: Record<Season, number> = { winter: 1, fruehling: 4, sommer: 7, herbst: 10 };
export const MONTH_NAME = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MID_DOY = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];

export function seasonOf(month: number): Season {
  return month === 12 || month <= 2 ? 'winter' : month <= 5 ? 'fruehling' : month <= 8 ? 'sommer' : 'herbst';
}

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Sun elevation and azimuth (degrees, azimuth true) at latitude, month and local solar hour. */
export function sunPosition(lat: number, month: number, hour: number): { el: number; az: number } {
  const doy = MID_DOY[(month - 1 + 12) % 12]!;
  const decl = rad(-23.44 * Math.cos(((2 * Math.PI) / 365) * (doy + 10)));
  const H = rad(15 * (hour - 12));
  const phi = rad(lat);
  const el = Math.asin(Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi));
  return { el: deg(el), az: (deg(az) + 180 + 360) % 360 };
}

/** Daylight 0..1 from the sun's elevation: full day above 8°, twilight down to -12°, then night. */
export function lightFromSun(el: number): number {
  if (el >= 8) return 1;
  if (el >= 0) return 0.45 + (0.55 * el) / 8;
  if (el >= -6) return 0.2 + (0.25 * (el + 6)) / 6;
  if (el >= -12) return 0.12 + (0.08 * (el + 12)) / 6;
  return 0.12;
}

/** The hour to start at for the chosen light: noon, the sunset twilight, or the darkest hour. */
export function startHourFor(lat: number, month: number, tod: 'tag' | 'daemmerung' | 'nacht'): number {
  if (tod === 'tag') return 11;
  if (tod === 'nacht') return 23.5;
  // Dusk: when the sun sinks through 2° below the horizon; with no sunset, the dimmest hour of the evening
  let best = 18.5, bestErr = Infinity;
  for (let h = 12; h <= 24; h += 0.1) {
    const err = Math.abs(sunPosition(lat, month, h).el + 2);
    if (err < bestErr) { bestErr = err; best = h; }
  }
  return Math.round(best * 10) / 10;
}

/** Few words on the light of the day, for the briefing ("Polarnacht", "Mitternachtssonne"). */
export function lightNote(lat: number, month: number): string | undefined {
  const noon = sunPosition(lat, month, 12).el;
  const midnight = sunPosition(lat, month, 0).el;
  if (noon < -6) return 'Polarnacht: auch mittags dunkel';
  if (noon < 0) return 'Polarnacht: mittags nur Dämmerung';
  if (midnight > 0) return 'Mitternachtssonne: die Sonne geht nicht unter';
  if (midnight > -6) return 'Helle Nächte: nachts nur Dämmerung';
  return undefined;
}

type Water = 'mittelmeer' | 'arktis' | 'atlantik' | 'ostsee' | 'fjord';
const WATER: Record<RegionId, Water> = {
  gibraltar: 'mittelmeer', messina: 'mittelmeer', dardanellen: 'mittelmeer',
  barents: 'arktis', framstr: 'arktis', nordkap: 'arktis', daenemarkstr: 'arktis', kola: 'arktis', varanger: 'arktis',
  faroebank: 'atlantik', faeroeshetland: 'atlantik', islandfaroe: 'atlantik', rockall: 'atlantik', biskaya: 'atlantik', lofotenbasin: 'atlantik', fladengrund: 'atlantik', pentland: 'atlantik',
  gotland: 'ostsee', bornholm: 'ostsee', finnbusen: 'ostsee',
  vestfjord: 'fjord', ofotfjord: 'fjord', trondheim: 'fjord', hvalfjord: 'fjord', lochewe: 'fjord', clyde: 'fjord',
};

/**
 * The sound-speed layer of an area in a season (depth m, loss dB crossing it), drawn within
 * its typical range. 0 = no layer (mixed to the bottom, or the Arctic half-channel).
 */
export function seaLayer(region: RegionId, month: number, u: number): { depth: number; loss: number; note: string } {
  const s = seasonOf(month);
  const pick = (a: number, b: number) => Math.round(a + (b - a) * u);
  switch (WATER[region]) {
    case 'mittelmeer':
      return s === 'sommer' ? { depth: pick(25, 50), loss: 13, note: 'scharfe, flache Sommerschicht' }
        : s === 'winter' ? { depth: pick(150, 250), loss: 6, note: 'tief durchmischt, schwache Schicht' }
        : { depth: pick(50, 90), loss: 11, note: 'mittlere Schicht' };
    case 'arktis':
      return s === 'winter' || s === 'fruehling' ? { depth: 0, loss: 0, note: 'kaltes Wasser bis oben: keine Schicht, Schall bleibt dicht unter der Oberfläche' }
        : { depth: pick(20, 45), loss: 6, note: 'dünne, schwache Schmelzwasserschicht' };
    case 'atlantik':
      return s === 'winter' ? { depth: pick(160, 260), loss: 8, note: 'Winterdurchmischung, tiefe Schicht' }
        : s === 'sommer' ? { depth: pick(35, 70), loss: 12, note: 'flache, kräftige Sommerschicht' }
        : { depth: pick(70, 130), loss: 11, note: 'mittlere Schicht' };
    case 'ostsee':
      return { depth: pick(55, 75), loss: 12, note: 'Salzgehaltssprung (Halokline): eine harte Grenze' };
    case 'fjord':
      return s === 'sommer' || s === 'fruehling' ? { depth: pick(8, 25), loss: 7, note: 'Süßwasserdecke der Schneeschmelze' }
        : { depth: pick(60, 120), loss: 9, note: 'schwache Winterschicht' };
  }
}

/** Weather statistics of an area in a season: fog banks and ice. */
export function seaClimate(region: RegionId, month: number): { fogBanks: number; ice: boolean } {
  const s = seasonOf(month);
  const w = WATER[region];
  const fogBanks = w === 'arktis' ? (s === 'sommer' ? 4 : 1)
    : w === 'atlantik' ? (s === 'sommer' || s === 'fruehling' ? 3 : 1)
    : w === 'mittelmeer' ? (s === 'fruehling' ? 1 : 0)
    : w === 'ostsee' ? (s === 'fruehling' ? 2 : 1) : 1;
  const ice = (s === 'winter' && (region === 'framstr' || region === 'daenemarkstr' || region === 'barents' || region === 'finnbusen')) ||
    (s === 'fruehling' && (region === 'framstr' || region === 'daenemarkstr'));
  return { fogBanks, ice };
}

export const latOf = (region: RegionId) => REGIONS[region].lat;
