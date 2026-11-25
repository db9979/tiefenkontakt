/**
 * Player stations aboard, by id. The ids are stable strings: crew seats, hints, the event log
 * and saved matches name a station by id, so reordering or merging tabs never sends a player
 * to the wrong place. The order here is the tab order (number key = index + 1).
 */
export const SUB_STATION_IDS = ['horch', 'sehrohr', 'feuerleitung', 'zentrale'] as const;
export const FRIGATE_STATION_IDS = ['opz', 'sonar', 'waffen', 'radar', 'bruecke'] as const;
export const STATION_IDS = [...SUB_STATION_IDS, ...FRIGATE_STATION_IDS] as const;

export type SubStationId = (typeof SUB_STATION_IDS)[number];
export type FrigateStationId = (typeof FRIGATE_STATION_IDS)[number];
export type StationId = SubStationId | FrigateStationId;

/**
 * Before the ids, a station was its tab number in a list of seven per side. Saved matches and
 * older clients still carry such numbers: map them to where that work is done now (the merged
 * stations went into their neighbours: Tauchstand → Zentrale, Ortung → Sehrohr / Sonar,
 * Torpedoraum → Feuerleitung, Flug → OPZ).
 */
const LEGACY_SUB: readonly SubStationId[] = ['horch', 'sehrohr', 'feuerleitung', 'zentrale', 'zentrale', 'sehrohr', 'feuerleitung'];
const LEGACY_FRIGATE: readonly FrigateStationId[] = ['opz', 'sonar', 'waffen', 'radar', 'bruecke', 'sonar', 'opz'];

export function legacyStation(index: number, submarine: boolean): StationId | undefined {
  return (submarine ? LEGACY_SUB : LEGACY_FRIGATE)[index];
}

export function isStationId(v: unknown): v is StationId {
  return typeof v === 'string' && (STATION_IDS as readonly string[]).includes(v);
}
