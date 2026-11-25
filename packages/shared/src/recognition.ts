import { CLASSES, type ClassId } from './classes.js';
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
  ffk: { length: 123, beam: 14.2, mast: 26, group: 'warship', cues: 'Lang und schlank, Vierfachstarter für U-Jagd-Raketen auf der Back, zwei schräge Vierfachstarter für Seeziel-FK mittschiffs, zwei Geschütztürme achtern, VDS-Pforte im Heck, kein Hangar' },
  ssw: { length: 85, beam: 10, mast: 9, group: 'submarine', cues: 'Schlanker, zylindrischer Rumpf, schmaler Turm mit Tiefenrudern, Kreuzleitwerk, kaum Flutschlitze' },
  kor: { length: 72, beam: 11.6, mast: 18, group: 'warship', cues: 'Klein und niedrig, hoher Bug, gedrungener Aufbau mit Mast, Raketenwerfer vorn, Wasserbombenschienen achtern' },
  merchant: { length: 130, beam: 20.6, mast: 27, group: 'convoy', cues: 'Brückenhaus mittschiffs bis achtern, Ladebäume an Portalmasten, Luken auf dem Vorschiff' },
  ssn: { length: 102, beam: 15.2, mast: 10, group: 'submarine', cues: 'Großer runder Rumpf, langer niedriger Turm weit vorn, Wulst (Gondel) auf dem Seitenruder' },
  ssk: { length: 74, beam: 13.8, mast: 12, group: 'submarine', cues: 'Gedrungener Rumpf, Flutschlitze im Oberdeck, hoher Turm mittschiffs mit Sehrohren' },
  ssa: { length: 61, beam: 9, mast: 8.5, group: 'submarine', cues: 'Schlank, Turm mit Tiefenrudern, X-Ruder achtern, kaum Aufbauten' },
  ssc: { length: 49, beam: 7, mast: 7, group: 'submarine', cues: 'Sehr klein, niedriger Turm, kurzer Rumpf, fast ganz unter Wasser' },
  tanker: { length: 240, beam: 40.8, mast: 31, group: 'neutral', cues: 'Riesig und flach, Rohrleitungen und Laufsteg auf dem Deck, Aufbau ganz achtern' },
  container: { length: 200, beam: 33, mast: 34, group: 'neutral', cues: 'Containerstapel in Reihen über das ganze Deck, Brücke achtern oder auf drei Vierteln' },
  faehre: { length: 150, beam: 27.6, mast: 31, group: 'neutral', cues: 'Hoher kastenförmiger Aufbau über fast die ganze Länge, viele Fensterreihen, Heckklappe' },
  fischer: { length: 42, beam: 11.2, mast: 17, group: 'neutral', cues: 'Klein, Aufbau vorn, Heckaufschleppe und Galgen achtern, Masten mit Ladegeschirr' },
  schlepper: { length: 35, beam: 12.2, mast: 14, group: 'neutral', cues: 'Kurz und breit, hoher Aufbau vorn, langes flaches Achterdeck mit Schlepphaken' },
  yacht: { length: 13, beam: 4.2, mast: 17, group: 'neutral', cues: 'Winzig, ein Mast mit Segeln, kaum Freibord' },
};

/** Surfaced submarines: hull depth below the waterline as built in the models (m). */
const SUB_DRAUGHT: Partial<Record<ClassId, number>> = { ssw: 6.1, ssn: 7.8, ssk: 6.6, ssa: 4.1, ssc: 5.1 };

/** Draught below the waterline (m): the class draught, for surfaced submarines the model's hull depth. */
export function recogDraught(cls: ClassId): number {
  return SUB_DRAUGHT[cls] ?? CLASSES[cls].draft;
}

/** Lookalikes: for each class one or two classes it is easily taken for, and the cue that tells them apart. */
export const CONFUSION: Record<ClassId, [ClassId, string][]> = {
  ffg: [['ffv', 'F-30 ist kürzer, trägt den VDS-Kran am Heck und hat keinen Hangar'], ['ffk', 'Wachschiff: Starter auf der Back, schräge Flugkörperstarter mittschiffs, zwei Türme achtern, kein Landedeck']],
  ffv: [['ffg', 'F-12 ist länger (136 m), Hangar und Landedeck achtern, höherer Gittermast'], ['ffk', 'Wachschiff: schräge Vierfachstarter mittschiffs, zwei Geschütztürme achtern']],
  kor: [['ffk', 'Wachschiff: fast doppelt so lang, Türme achtern'], ['fischer', 'Trawler: Galgen und Heckaufschleppe, keine Waffen; die Korvette liegt lang und niedrig']],
  ffk: [['ffv', 'F-30: ein Schornstein, VDS-Kran am Heck, keine Seeziel-Starter'], ['ffg', 'F-12: hoher Gittermast, Hangar und Landedeck achtern']],
  merchant: [['container', 'Containerschiff: viel größer, Stapel statt Ladebäume, Brücke achtern'], ['faehre', 'Fähre: hoher Kastenaufbau über fast die ganze Länge']],
  ssw: [['ssn', 'Projekt 9: runder, dicker Rumpf, Turm weit vorn, Gondel auf dem Seitenruder'], ['ssa', 'Projekt 6: viel kleiner (61 m), X-Ruder achtern']],
  ssn: [['ssw', 'S-14: schlanker, schmaler Turm mit Tiefenrudern, keine Gondel'], ['ssk', 'Projekt 4: kürzer und gedrungen, Flutschlitze, Turm mittschiffs']],
  ssk: [['ssn', 'Projekt 9: viel länger, Turm weit vorn, Gondel auf dem Seitenruder'], ['ssa', 'Projekt 6: schlanker, X-Ruder, kaum Flutschlitze']],
  ssa: [['ssc', 'Projekt 2: noch kürzer (49 m), niedriger Turm, fast ganz unter Wasser'], ['ssk', 'Projekt 4: breiter und gedrungener, Flutschlitze im Oberdeck']],
  ssc: [['ssa', 'Projekt 6: länger (61 m), Tiefenruder am Turm, X-Ruder'], ['yacht', 'Segelyacht: hoher Mast mit Segeln, kein Turm']],
  tanker: [['container', 'Containerschiff: Stapel an Deck, schlanker'], ['merchant', 'Frachter: halb so lang, Ladebäume, Brücke mittschiffs']],
  container: [['tanker', 'Tanker: flach, Rohrleitungen statt Stapel'], ['faehre', 'Fähre: geschlossener Kastenaufbau mit Fensterreihen']],
  faehre: [['container', 'Containerschiff: offene Stapel, Brücke achtern'], ['merchant', 'Frachter: kleiner, Ladebäume, niedriger Aufbau']],
  fischer: [['schlepper', 'Schlepper: kürzer und breiter, Schlepphaken, kein Galgen'], ['kor', 'Korvette: länger und flacher, Waffen vorn und achtern']],
  schlepper: [['fischer', 'Trawler: länger, Galgen und Heckaufschleppe achtern']],
  yacht: [['ssc', 'Küsten-U-Boot: kein Mast mit Segeln, nur ein niedriger Turm'], ['fischer', 'Trawler: viel größer, Aufbau und Ladegeschirr statt Segel']],
};

/** One short tactical hint per class for the threat page (German). */
export const THREAT_HINT: Record<ClassId, string> = {
  ffg: 'Hat einen Hubschrauber mit Tauchsonar – unter der Schicht bleiben und die Masten unten halten.',
  ffv: 'Der VDS hört unter der Schicht – Tiefe allein schützt nicht. Bei hoher Fahrt ist er eingeholt.',
  kor: 'Wasserbomben wirken nur direkt über dem Boot – Abstand halten; ihr Schleppsonar ist kurz.',
  ffk: 'Laut und schnell, mit VDS und Raketen gegen U-Boote; seine Seezielflugkörper treffen das größte Echo.',
  merchant: 'Unbewaffnet, aber die Sicherung ist nah – nach dem Schuss tief gehen und Fahrt wechseln.',
  ssw: 'Sehr leise mit langem Schleppsonar – nie lange mit hoher Fahrt geradeaus laufen.',
  ssn: 'Schnell und ausdauernd mit vielen Torpedos; bei hoher Fahrt laut und dann gut zu orten.',
  ssk: 'Auf Batterie fast lautlos; schnorchelnd laut und mit Mast im Radar – dann zuschlagen.',
  ssa: 'Mit AIP lange leise unter Wasser; der 400-Hz-Ton verrät es.',
  ssc: 'Klein und leise, acht Rohre ohne Nachladen, oft mit Minen – Engstellen meiden.',
  tanker: 'Neutral – nicht angreifen. Das laute Stampfen überdeckt leise Kontakte in der Nähe.',
  container: 'Neutral – nicht angreifen. Ein großes Echo, das Suchköpfe ablenken kann.',
  faehre: 'Neutral, viele Menschen an Bord – auf keinen Fall angreifen.',
  fischer: 'Neutral – nicht angreifen. Lärm und Netze: ein gutes Versteck für ein U-Boot in der Nähe.',
  schlepper: 'Neutral – nicht angreifen. Laut je Knoten, leicht für ein Kriegsschiff gehalten.',
  yacht: 'Neutral und harmlos – nicht angreifen.',
};

/** Order of the book: escorts, convoy, boats (surfaced), neutral traffic. */
export const RECOG_ORDER: ClassId[] = ['ffg', 'ffv', 'kor', 'ffk', 'merchant', 'ssw', 'ssn', 'ssk', 'ssa', 'ssc', 'tanker', 'container', 'faehre', 'fischer', 'schlepper', 'yacht'];

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
