import { REGIONS, isRegion, type AreaKind, type RegionId } from './regions.js';
import type { SeabedSpec } from './seabed.js';

/**
 * Acoustic character of the sea areas: where deep-water convergence zones form, how far out,
 * and how much distant shipping fills the background. Sources: Urick, Principles of Underwater
 * Sound (3rd ed.), ch. 5–7 (CZ ranges 30–35 nm in the N. Atlantic, shorter in cold high-latitude
 * water, none without depth excess or in the Arctic half-channel); Wenz (1962) and the
 * shipping-density classes of the ANSI/NRL ambient-noise tables (busy straits and approaches
 * 5–10 dB above remote ocean at the low end of the broadband).
 */
export interface AreaAcoustics {
  /** Range of the first convergence zone (km); undefined = none (half-channel, shelf, narrows). */
  czKm?: number;
  /** Water depth the CZ needs (depth excess: the bottom must lie below the depth where the sound speed equals the surface's), m. */
  czDepthM: number;
  /** Distant shipping in the ambient noise (dB on top of wind and rain). */
  shippingDb: number;
  /** Arctic half-channel: upward refraction from the surface down, surface-reflected paths everywhere, no shadow, no CZ. */
  halfChannel?: boolean;
}

const NO_CZ = 99_999;

/**
 * Per sea area. CZ: Norwegian Sea and Lofoten basin short (cold deep water, shallow channel
 * axis: about 40 km), Rockall and the Bay of Biscay the classic mid-latitude 55–65 km.
 * Shipping: Gibraltar and the Dardanelles among the busiest narrows, the North Sea and the
 * harbour approaches busy, the open Norwegian Sea, Fram Strait and Barents Sea nearly empty.
 */
export const AREA_ACOUSTICS: Record<RegionId, AreaAcoustics> = {
  faroebank: { czKm: 50, czDepthM: 2000, shippingDb: 2 },
  barents: { czDepthM: NO_CZ, shippingDb: 1, halfChannel: true },
  vestfjord: { czDepthM: NO_CZ, shippingDb: 3 },
  kola: { czDepthM: NO_CZ, shippingDb: 6, halfChannel: true },
  gibraltar: { czDepthM: NO_CZ, shippingDb: 8 },
  lofotenbasin: { czKm: 42, czDepthM: 1800, shippingDb: 1 },
  daenemarkstr: { czDepthM: NO_CZ, shippingDb: 1, halfChannel: true },
  faeroeshetland: { czKm: 48, czDepthM: 2000, shippingDb: 3 },
  rockall: { czKm: 56, czDepthM: 2000, shippingDb: 3 },
  biskaya: { czKm: 62, czDepthM: 3000, shippingDb: 5 },
  framstr: { czDepthM: NO_CZ, shippingDb: 0, halfChannel: true },
  islandfaroe: { czKm: 50, czDepthM: 2000, shippingDb: 2 },
  nordkap: { czDepthM: NO_CZ, shippingDb: 3, halfChannel: true },
  fladengrund: { czDepthM: NO_CZ, shippingDb: 6 },
  gotland: { czDepthM: NO_CZ, shippingDb: 4 },
  bornholm: { czDepthM: NO_CZ, shippingDb: 5 },
  finnbusen: { czDepthM: NO_CZ, shippingDb: 5 },
  ofotfjord: { czDepthM: NO_CZ, shippingDb: 4 },
  trondheim: { czDepthM: NO_CZ, shippingDb: 4 },
  varanger: { czDepthM: NO_CZ, shippingDb: 2, halfChannel: true },
  hvalfjord: { czDepthM: NO_CZ, shippingDb: 3 },
  lochewe: { czDepthM: NO_CZ, shippingDb: 3 },
  clyde: { czDepthM: NO_CZ, shippingDb: 6 },
  messina: { czDepthM: NO_CZ, shippingDb: 6 },
  dardanellen: { czDepthM: NO_CZ, shippingDb: 7 },
  pentland: { czDepthM: NO_CZ, shippingDb: 4 },
};

/**
 * Procedural seabeds (no real area): open deep ocean like the N. Atlantic, or a generic shelf/fjord.
 * Their shipping is the reference background of the wind-only noise (0 dB), as before the areas had their own.
 */
const PROCEDURAL: Record<SeabedSpec['kind'], AreaAcoustics> = {
  tief: { czKm: 55, czDepthM: 2000, shippingDb: 0 },
  schelf: { czDepthM: NO_CZ, shippingDb: 0 },
  fjord: { czDepthM: NO_CZ, shippingDb: 0 },
};

/** Acoustics of the area a seabed belongs to; no seabed = the open deep ocean. */
export function areaAcoustics(seabed: Pick<SeabedSpec, 'kind' | 'region'> | undefined): AreaAcoustics {
  if (seabed?.region && isRegion(seabed.region)) return AREA_ACOUSTICS[seabed.region];
  return PROCEDURAL[seabed?.kind ?? 'tief'];
}

/** Kind of sea area: real areas by their kind, procedural deep water counts as open ocean. */
export function areaKind(seabed: Pick<SeabedSpec, 'kind' | 'region'> | undefined): AreaKind {
  if (seabed?.region && isRegion(seabed.region)) return REGIONS[seabed.region].kind;
  return seabed?.kind === 'schelf' ? 'schelf' : seabed?.kind === 'fjord' ? 'fjord' : 'open';
}
