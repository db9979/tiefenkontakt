/**
 * Station order per side, by title, as the game screen builds them (number key = index + 1).
 * Hints, tutorials and the help screen refer to stations through this list, so a moved or
 * merged station shows up as a type error or a failing test instead of a wrong button.
 * Keep it in step with build() in screens/game.ts (which warns in the console on a mismatch).
 */
export const SUB_STATIONS = ['Horchraum', 'Sehrohr', 'Feuerleitung', 'Tauchstand', 'Zentrale', 'Ortung', 'Torpedoraum'] as const;
/** The flight deck exists only on ships that carry a helicopter: it is always last. */
export const FRIGATE_STATIONS = ['OPZ', 'Sonar', 'Waffen', 'Radar/ESM', 'Brücke', 'Ortung', 'Flug'] as const;

export type SubStation = (typeof SUB_STATIONS)[number];
export type FrigateStation = (typeof FRIGATE_STATIONS)[number];

/** Index of a submarine station (for "go there" links). */
export const subStation = (title: SubStation): number => SUB_STATIONS.indexOf(title);
/** Index of a frigate station (for "go there" links). */
export const frigateStation = (title: FrigateStation): number => FRIGATE_STATIONS.indexOf(title);
