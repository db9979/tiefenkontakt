import { FRIGATE_STATION_IDS, SUB_STATION_IDS, type FrigateStationId, type StationId, type SubStationId } from '@tk/shared';

/**
 * Station ids and their tab titles per side, in tab order (number key = index + 1). Hints,
 * tutorials, the event log and the help screen refer to stations by id, so a moved or merged
 * station shows up as a type error or a failing test instead of a wrong button.
 * Keep it in step with build() in screens/game.ts (which warns in the console on a mismatch).
 */
export const STATION_TITLE: Record<StationId, string> = {
  horch: 'Horchraum', sehrohr: 'Sehrohr', feuerleitung: 'Feuerleitung', zentrale: 'Zentrale',
  opz: 'OPZ', sonar: 'Sonar', waffen: 'Waffen', radar: 'Radar/ESM', bruecke: 'Brücke',
};

export const SUB_STATIONS: readonly string[] = SUB_STATION_IDS.map((id) => STATION_TITLE[id]);
export const FRIGATE_STATIONS: readonly string[] = FRIGATE_STATION_IDS.map((id) => STATION_TITLE[id]);

export type { FrigateStationId, StationId, SubStationId };

/** The station ids of one side, in tab order. */
export const stationIds = (submarine: boolean): readonly StationId[] => (submarine ? SUB_STATION_IDS : FRIGATE_STATION_IDS);

/** Number key of a station (1-based), for "1 · Horchraum" labels. */
export function stationNumber(id: StationId): number {
  const sub = (SUB_STATION_IDS as readonly string[]).indexOf(id);
  return (sub >= 0 ? sub : (FRIGATE_STATION_IDS as readonly string[]).indexOf(id)) + 1;
}

/** "3 · Feuerleitung": the label tutorials and help show for a station. */
export const stationLabel = (id: StationId): string => `${stationNumber(id)} · ${STATION_TITLE[id]}`;
