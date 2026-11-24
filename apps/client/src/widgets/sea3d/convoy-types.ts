/** Convoy types in the order the recognition book shows them (no three.js here: the book loads it lazily). */
export const CONVOY_TYPES = [
  ['cargo', 'Stückgutfrachter'], ['feeder', 'Containerfeeder'], ['bulk', 'Massengutfrachter'],
  ['reefer', 'Kühlschiff'], ['tanker', 'Produktentanker'], ['roro', 'Ro-Ro-Frachter'],
] as const;
export type ConvoyType = (typeof CONVOY_TYPES)[number][0];
