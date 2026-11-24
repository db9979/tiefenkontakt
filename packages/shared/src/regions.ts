/**
 * Real sea areas (bathymetry from NOAA ETOPO 2022, public domain). A region places the game's
 * map on the real sea: the game origin (0, 0) lies at lat/lon, and the game's "north" (+y,
 * the convoy's direction) points along `bearing` (degrees true). `half` is the size of the
 * downloaded window around the route (km), `stride` its sampling (1 = 15 arc seconds).
 * Several missions may share one region.
 */

export interface Region {
  name: string;
  lat: number;
  lon: number;
  bearing: number;
  half: number;
  stride: number;
}

export const REGIONS = {
  faroebank: { name: 'Färöer-Bank', lat: 60.72, lon: -8.35, bearing: 320, half: 50, stride: 2 },
  barents: { name: 'Barentssee bei der Bäreninsel', lat: 74.7, lon: 24.0, bearing: 0, half: 50, stride: 4 },
  vestfjord: { name: 'Vestfjord (Lofoten)', lat: 68.25, lon: 15.35, bearing: 225, half: 50, stride: 2 },
  kola: { name: 'Kolabucht (Murmansk)', lat: 69.335, lon: 33.558, bearing: 5, half: 32, stride: 1 },
  gibraltar: { name: 'Straße von Gibraltar', lat: 35.937, lon: -5.7, bearing: 88, half: 35, stride: 1 },
  lofotenbasin: { name: 'Lofotenbecken (Europäisches Nordmeer)', lat: 69.6, lon: 4.0, bearing: 20, half: 50, stride: 4 },
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

/** Bounding box (degrees) of the window the region needs: x ±half, y from −half/2 to 1.5·half. */
export function regionBox(r: Region): { lat0: number; lat1: number; lon0: number; lon1: number } {
  const h = r.half * 1000;
  const pts = [[-h, -h / 2], [h, -h / 2], [-h, 1.5 * h], [h, 1.5 * h]].map(([x, y]) => regionToGeo(r, x!, y!));
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
