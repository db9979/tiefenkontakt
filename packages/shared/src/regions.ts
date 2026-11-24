/**
 * Real sea areas (bathymetry from NOAA ETOPO 2022, public domain). A region places the game's
 * map on the real sea: the game origin (0, 0) lies at lat/lon, and the game's "north" (+y,
 * the convoy's direction) points along `bearing` (degrees true). `half` is the size of the
 * downloaded window around the route (km), `stride` its sampling (1 = 15 arc seconds).
 * Several missions may share one region.
 */

/** What a sea area is good for: open water, shelf, fjord, harbour, strait. */
export type AreaKind = 'open' | 'schelf' | 'fjord' | 'hafen' | 'meerenge';

export interface Region {
  name: string;
  kind: AreaKind;
  lat: number;
  lon: number;
  bearing: number;
  half: number;
  stride: number;
}

const open = (name: string, lat: number, lon: number, bearing: number) => ({ name, kind: 'open', lat, lon, bearing, half: 50, stride: 4 } as const);
const shelf = (name: string, lat: number, lon: number, bearing: number) => ({ name, kind: 'schelf', lat, lon, bearing, half: 50, stride: 4 } as const);
const fjord = (name: string, lat: number, lon: number, bearing: number) => ({ name, kind: 'fjord', lat, lon, bearing, half: 45, stride: 2 } as const);
const harbour = (name: string, lat: number, lon: number, bearing: number) => ({ name, kind: 'hafen', lat, lon, bearing, half: 32, stride: 1 } as const);
const strait = (name: string, lat: number, lon: number, bearing: number) => ({ name, kind: 'meerenge', lat, lon, bearing, half: 35, stride: 1 } as const);

export const REGIONS = {
  faroebank: { ...open('Färöer-Bank', 60.72, -8.35, 320), stride: 2 },
  barents: shelf('Barentssee bei der Bäreninsel', 74.7, 24.0, 0),
  vestfjord: { ...fjord('Vestfjord (Lofoten)', 68.25, 15.35, 225), half: 50 },
  kola: harbour('Kolabucht (Murmansk)', 69.335, 33.558, 5),
  gibraltar: strait('Straße von Gibraltar', 35.937, -5.7, 88),
  lofotenbasin: open('Lofotenbecken', 69.6, 4.0, 20),
  // The North Atlantic and the Arctic: convoy lanes and the GIUK barrier
  daenemarkstr: open('Dänemarkstraße', 66.0, -26.5, 40),
  faeroeshetland: open('Färöer-Shetland-Kanal', 61.2, -3.5, 45),
  rockall: open('Rockall-Trog', 56.8, -12.0, 0),
  biskaya: open('Golf von Biskaya', 45.0, -4.0, 0),
  framstr: open('Framstraße', 78.8, 4.0, 0),
  islandfaroe: open('Island–Färöer-Rücken', 63.4, -10.5, 45),
  nordkap: open('Nordkap', 71.6, 25.5, 90),
  // Shelf seas
  fladengrund: shelf('Nordsee, Fladengrund', 58.4, 0.8, 0),
  gotland: shelf('Ostsee, Gotlandbecken', 57.4, 19.8, 30),
  bornholm: shelf('Ostsee, Bornholmbecken', 55.25, 15.6, 60),
  finnbusen: shelf('Finnischer Meerbusen', 59.755, 25.179, 75),
  // Fjords, anchorages and narrows
  ofotfjord: fjord('Ofotfjord (Narvik)', 68.4573, 17.4053, 255),
  trondheim: fjord('Trondheimsfjord', 63.464, 10.102, 60),
  varanger: fjord('Varangerfjord', 70.0, 30.0, 285),
  hvalfjord: harbour('Hvalfjörður (Island)', 64.335, -22.062, 285),
  lochewe: harbour('Loch Ewe (Schottland)', 57.704, -5.734, 270),
  clyde: harbour('Firth of Clyde (Holy Loch)', 55.805, -4.95, 195),
  messina: strait('Straße von Messina', 38.2, 15.62, 180),
  dardanellen: strait('Dardanellen', 40.055, 26.296, 255),
  pentland: strait('Pentland Firth', 58.7, -3.1, 270),
} as const satisfies Record<string, Region>;

export type RegionId = keyof typeof REGIONS;

export const isRegion = (id: unknown): id is RegionId => typeof id === 'string' && id in REGIONS;

const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LON = 111_320;

/** Game metres (x east of the route, y along it) → latitude/longitude. */
export function regionToGeo(r: Region, x: number, y: number): { lat: number; lon: number } {
  const b = (r.bearing * Math.PI) / 180;
  const east = x * Math.cos(b) + y * Math.sin(b);
  const north = -x * Math.sin(b) + y * Math.cos(b);
  return { lat: r.lat + north / M_PER_DEG_LAT, lon: r.lon + east / (M_PER_DEG_LON * Math.cos((r.lat * Math.PI) / 180)) };
}

/** Half size of the coarse overview window around every region (km): the chart zoomed far out. */
export const WIDE_HALF_KM = 330;

/**
 * Bounding box (degrees) of the window the region needs: x ±half, y from −half/2 to 1.5·half;
 * the wide overview window is square around the middle of the route.
 */
export function regionBox(r: Region, wide = false): { lat0: number; lat1: number; lon0: number; lon1: number } {
  const h = (wide ? WIDE_HALF_KM : r.half) * 1000;
  const corners = wide ? [[-h, -h + 15_000], [h, -h + 15_000], [-h, h + 15_000], [h, h + 15_000]] : [[-h, -h / 2], [h, -h / 2], [-h, 1.5 * h], [h, 1.5 * h]];
  const pts = corners.map(([x, y]) => regionToGeo(r, x!, y!));
  return {
    lat0: Math.min(...pts.map((p) => p.lat)), lat1: Math.max(...pts.map((p) => p.lat)),
    lon0: Math.min(...pts.map((p) => p.lon)), lon1: Math.max(...pts.map((p) => p.lon)),
  };
}

/** Where each mission is set, and the sea of each seabed type for the custom mission. */
export const MISSION_REGION: Record<string, RegionId> = {
  groenland: 'faroebank', schelf: 'barents', fjord: 'vestfjord', duell: 'lofotenbasin', hafen: 'kola',
  fuehlung: 'lofotenbasin', meerenge: 'gibraltar', aufklaerung: 'barents', eigene: 'lofotenbasin',
};
export const KIND_REGION: Record<'tief' | 'schelf' | 'fjord', RegionId> = { tief: 'lofotenbasin', schelf: 'barents', fjord: 'vestfjord' };

/** Which kinds of sea area each mission can be played in. */
export const MISSION_AREAS: Record<string, readonly AreaKind[]> = {
  groenland: ['open'], schelf: ['schelf'], fjord: ['fjord'], duell: ['open', 'schelf'], hafen: ['hafen'],
  fuehlung: ['open', 'schelf'], meerenge: ['meerenge'], aufklaerung: ['schelf', 'open'], eigene: ['open', 'schelf', 'fjord'],
};

/** The sea areas a mission can be played in, its home area first. */
export function areasFor(mission: string): RegionId[] {
  const kinds = MISSION_AREAS[mission] ?? ['open'];
  const home = MISSION_REGION[mission];
  const all = (Object.keys(REGIONS) as RegionId[]).filter((id) => kinds.includes(REGIONS[id].kind));
  return home ? [home, ...all.filter((id) => id !== home)] : all;
}
