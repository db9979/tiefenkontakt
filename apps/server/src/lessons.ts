import {
  createConvoy,
  createShip,
  createWorld,
  installAir,
  installBoats,
  installWeapons,
  type PlayerSlot,
  type Ship,
  type World,
} from '@tk/shared';

/** Training lessons: small, calm single-player scenarios for one skill each. */

export type LessonId = 'klassifizieren' | 'tma' | 'angriff' | 'ujagd';

export const LESSONS: Record<LessonId, { title: string; side: 'east' | 'west'; cls: 'ssk' | 'ffg' }> = {
  klassifizieren: { title: 'Horchen und Klassifizieren', side: 'east', cls: 'ssk' },
  tma: { title: 'Zielbewegungsanalyse', side: 'east', cls: 'ssk' },
  angriff: { title: 'Torpedoangriff', side: 'east', cls: 'ssk' },
  ujagd: { title: 'U-Jagd mit Fregatte', side: 'west', cls: 'ffg' },
};

export function lessonSlot(lesson: LessonId, playerId: string, callsign: string): PlayerSlot {
  const l = LESSONS[lesson];
  return { playerId, callsign, team: l.side, cls: l.cls, ready: true };
}

/** Build the lesson world. Returns the ship ids that should get a passive AI (no weapons). */
export function buildLesson(lesson: LessonId, slot: PlayerSlot, seed: number): { world: World; passiveBots: string[] } {
  const ships: Ship[] = [];
  const merchants: Ship[] = [];
  const passiveBots: string[] = [];
  const nMerchants = lesson === 'ujagd' ? 3 : 3;
  for (let i = 0; i < nMerchants; i++) {
    const m = createShip({ id: `m${i + 1}`, cls: 'merchant', name: `Frachter ${i + 1}`, pos: { x: -9000 + i * 1100, y: 6000 + (i % 2) * 700 }, heading: 90, speedKn: 9 });
    merchants.push(m);
    ships.push(m);
  }
  if (lesson === 'ujagd') {
    ships.push(createShip({ id: `p_${slot.playerId}`, cls: 'ffg', name: slot.callsign, team: 'west', playerId: slot.playerId, pos: { x: -6000, y: 9000 }, heading: 90, speedKn: 10 }));
    const sub = createShip({ id: 'p_bot-train', cls: 'ssk', name: 'Übungs-U-Boot', team: 'east', pos: { x: 2000, y: 12_000 }, heading: 250, speedKn: 5, depth: 60 });
    ships.push(sub);
    passiveBots.push(sub.id);
  } else {
    // Own boat south of the merchants' track, quiet, with room for a leg change
    const dist = lesson === 'klassifizieren' ? 7000 : 9000;
    ships.push(createShip({ id: `p_${slot.playerId}`, cls: 'ssk', name: slot.callsign, team: 'east', playerId: slot.playerId, pos: { x: 0, y: 6000 - dist }, heading: 0, speedKn: 4, depth: 60 }));
  }
  const world = createWorld(ships, seed, { layerDepth: 110, layerLoss: 12, seaState: 2 });
  world.convoy = createConvoy(merchants, [{ x: 40_000, y: 6000 }], 9);
  world.convoy.zigzag = false;
  installWeapons(world);
  installAir(world);
  installBoats(world);
  return { world, passiveBots };
}

/** Lessons end on their goal (or the time limit); classification/TMA lessons only end by time. */
export function lessonResult(w: World, lesson: LessonId, limitS: number): { winner: 'west' | 'east'; reason: string } | undefined {
  if (lesson === 'angriff' && w.ships.some((s) => s.cls === 'merchant' && !s.alive)) return { winner: 'east', reason: 'Lektion geschafft: Ziel versenkt' };
  if (lesson === 'ujagd' && w.ships.some((s) => s.id === 'p_bot-train' && !s.alive)) return { winner: 'west', reason: 'Lektion geschafft: U-Boot versenkt' };
  if (w.time >= limitS) return { winner: LESSONS[lesson].side, reason: 'Lektion beendet' };
  return undefined;
}
