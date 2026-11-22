import type { ClassId } from './classes.js';
import type { ClassChoice } from './signatures.js';

/**
 * Ship recognition book (Erkennungsheft): dimensions as built in the 3D models (waterline at
 * y = 0, metres), the height of the highest mast for stadimeter ranging, and what the
 * lookout recognises a class by. Used by the periscope and bridge to assign a class to a
 * visual contact, and by the server to grade periscope photos.
 */
export interface RecogEntry {
  /** Overall length (m). */
  length: number;
  /** Beam (m). */
  beam: number;
  /** Highest mast or sail top above the waterline (m): the stadimeter's reference height. */
  mast: number;
  /** Group in the book. */
  group: 'warship' | 'submarine' | 'convoy' | 'neutral';
  /** Recognition cues, German (game language). */
  cues: string;
}

export const RECOG: Record<ClassId, RecogEntry> = {
  ffg: { length: 136, beam: 15.4, mast: 34, group: 'warship', cues: 'Langer Glattdeckrumpf, Geschütz vorn, Raketenstarter vor der Brücke, hoher Gittermast, Hubschrauberhangar und Deck achtern' },
  ffv: { length: 113, beam: 14, mast: 29, group: 'warship', cues: 'Kürzer als F-12, ein Schornstein mittschiffs, Gittermast, VDS-Kran und Schleppkörper am Heck, kein Hangar' },
  kor: { length: 72, beam: 11.6, mast: 18, group: 'warship', cues: 'Klein und niedrig, hoher Bug, gedrungener Aufbau mit Mast, Raketenwerfer vorn, Wasserbombenschienen achtern' },
  merchant: { length: 130, beam: 20.6, mast: 27, group: 'convoy', cues: 'Brückenhaus mittschiffs bis achtern, Ladebäume an Portalmasten, Luken auf dem Vorschiff' },
  ssn: { length: 102, beam: 15.2, mast: 10, group: 'submarine', cues: 'Großer runder Rumpf, langer niedriger Turm weit vorn, Wulst (Gondel) auf dem Seitenruder' },
  ssk: { length: 74, beam: 13.8, mast: 12, group: 'submarine', cues: 'Gedrungener Rumpf, Flutschlitze im Oberdeck, hoher Turm mittschiffs mit Sehrohren' },
  ssa: { length: 61, beam: 9, mast: 8.5, group: 'submarine', cues: 'Schlank, Turm mit Tiefenrudern, X-Ruder achtern, kaum Aufbauten' },
  ssc: { length: 49, beam: 7, mast: 8, group: 'submarine', cues: 'Sehr klein, niedriger Turm, kurzer Rumpf, fast ganz unter Wasser' },
  tanker: { length: 240, beam: 40.8, mast: 31, group: 'neutral', cues: 'Riesig und flach, Rohrleitungen und Laufsteg auf dem Deck, Aufbau ganz achtern' },
  container: { length: 200, beam: 33, mast: 34, group: 'neutral', cues: 'Containerstapel in Reihen über das ganze Deck, Brücke achtern oder auf drei Vierteln' },
  faehre: { length: 150, beam: 27.6, mast: 31, group: 'neutral', cues: 'Hoher kastenförmiger Aufbau über fast die ganze Länge, viele Fensterreihen, Heckklappe' },
  fischer: { length: 42, beam: 11.2, mast: 17, group: 'neutral', cues: 'Klein, Aufbau vorn, Heckaufschleppe und Galgen achtern, Masten mit Ladegeschirr' },
  schlepper: { length: 35, beam: 12.2, mast: 14, group: 'neutral', cues: 'Kurz und breit, hoher Aufbau vorn, langes flaches Achterdeck mit Schlepphaken' },
  yacht: { length: 13, beam: 4.2, mast: 17, group: 'neutral', cues: 'Winzig, ein Mast mit Segeln, kaum Freibord' },
};

/** Order of the book: escorts, convoy, boats (surfaced), neutral traffic. */
export const RECOG_ORDER: ClassId[] = ['ffg', 'ffv', 'kor', 'merchant', 'ssn', 'ssk', 'ssa', 'ssc', 'tanker', 'container', 'faehre', 'fischer', 'schlepper', 'yacht'];

/** The coarse classification a precise class stands for (as the sonar buttons use it). */
export function choiceOfClass(cls: ClassId): ClassChoice {
  const g = RECOG[cls].group;
  return g === 'warship' ? 'warship' : g === 'submarine' ? 'submarine' : 'merchant';
}

/**
 * Stadimeter: the operator sets the mast top on the waterline; the angle with the assumed
 * mast height gives the range. A wrong class scales the range by the ratio of the masts.
 */
export function stadimeterRange(trueRange: number, trueCls: ClassId, assumedCls: ClassId): number {
  return (trueRange * RECOG[assumedCls].mast) / RECOG[trueCls].mast;
}

/** Aspect of a target: angle off its bow at which it is seen (0 bow on, 90 beam, 180 stern on). */
export type AspectWord = 'bug' | 'bugschraeg' | 'querab' | 'heckschraeg' | 'heck';
export function aspectWord(aspectDeg: number): AspectWord {
  const a = Math.abs(aspectDeg);
  return a < 25 ? 'bug' : a < 65 ? 'bugschraeg' : a <= 115 ? 'querab' : a < 155 ? 'heckschraeg' : 'heck';
}
export const ASPECT_DE: Record<AspectWord, string> = {
  bug: 'Bug voraus', bugschraeg: 'Bug schräg', querab: 'querab', heckschraeg: 'achterlich schräg', heck: 'von achtern',
};

/** Periscope or bridge photo, graded by the server (truth); the image itself stays with the client. */
export interface PhotoRecord {
  id: string;
  playerId: string;
  shipId: string;
  /** Sim time the photo was taken. */
  t: number;
  /** 0..100 */
  score: number;
  quality: 'gut' | 'brauchbar' | 'schwach' | 'unbrauchbar';
  /** German comment, e.g. "Gute Aufnahme: Fregatte F-12 querab, 3,2 km". */
  comment: string;
  /** What is in the picture: a ship class or an aircraft kind. */
  cls?: ClassId;
  plane?: import('./airspace.js').PlaneKind;
  targetId?: string;
  range?: number;
  aspect?: AspectWord;
  /** Faults that cost points. */
  flaws: ('klein' | 'rand' | 'sicht' | 'mast' | 'abgeschnitten')[];
  /** How long the mast had been up when the photo was taken (s), submarines only. */
  mastS?: number;
}
