import {
  CLASSES,
  KN,
  bearing,
  distance,
  type Briefing,
  type Ship,
  type World,
  isConvoyShip,
  TRAITS,
  commanderTrait,
} from '@tk/shared';
import { MISSIONS, type ScenarioSettings } from './scenario.js';

const deg3 = (d: number) => String(Math.round(((d % 360) + 360) % 360)).padStart(3, '0');
const km = (m: number) => `${Math.round(m / 1000)} km`;

/**
 * Mission briefing for one ship: goal, what is known about the enemy and the first steps.
 * Submarines only get an imprecise intelligence report; the escort knows its convoy.
 */
export function buildBriefing(w: World, ship: Ship, settings: ScenarioSettings, rnd: () => number): Briefing {
  const m = MISSIONS[settings.mission];
  const sub = CLASSES[ship.cls].submarine;
  const merchants = w.ships.filter((s) => isConvoyShip(s) && s.alive);
  const enemies = w.ships.filter((s) => s.team !== ship.team && s.team !== 'neutral' && s.cls !== 'merchant');
  const centre = merchants.length
    ? { x: merchants.reduce((a, s) => a + s.pos.x, 0) / merchants.length, y: merchants.reduce((a, s) => a + s.pos.y, 0) / merchants.length }
    : undefined;
  const intel: string[] = [];
  let goal: string;
  const duel = settings.mission === 'duell';
  const harbour = settings.mission === 'hafen';
  if (duel) {
    goal = 'Alle gegnerischen U-Boote versenken. Wer zuerst hört, gewinnt.';
    const e = enemies[0];
    if (e) intel.push(`Gegner zuletzt gemeldet: etwa Peilung ${deg3(bearing(ship.pos, e.pos) + (rnd() - 0.5) * 40)}, ${km(distance(ship.pos, e.pos) * (0.7 + rnd() * 0.6))}`);
  } else if (sub) {
    goal = harbour ? 'In die Bucht eindringen und die ankernden Frachter versenken.' : 'Die Hälfte der Konvoi-Tonnage versenken, bevor der Konvoi sein Ziel erreicht.';
    if (centre) {
      const b = bearing(ship.pos, centre) + (rnd() - 0.5) * 30;
      intel.push(`Aufklärung: ${harbour ? 'Ankerplatz' : 'Konvoi'} etwa Peilung ${deg3(b)}, ${km(distance(ship.pos, centre) * (0.75 + rnd() * 0.5))} (ungenau)`);
      if (!harbour) intel.push(`Konvoi: ${merchants.length} Frachter, etwa ${Math.round((merchants[0]!.speed / KN) * 10) / 10 || 9} kn, Kurs Nord`);
    }
    intel.push(`Eskorte: ${enemies.length} Fregatte(n) mit Schleppsonar, Hubschrauber und U-Jagd-Raketen`);
  } else {
    goal = harbour ? 'Die Einfahrt halten, bis die Zeit abläuft.' : 'Den Konvoi ins Ziel bringen oder alle U-Boote versenken.';
    if (centre) intel.push(`${harbour ? 'Ankerplatz' : 'Konvoi'}: Peilung ${deg3(bearing(ship.pos, centre))}, ${km(distance(ship.pos, centre))}, ${merchants.length} Frachter`);
    intel.push(`Bedrohung: ${enemies.length} U-Boot(e), vermutlich voraus des Konvois`);
  }
  if (w.env.layerDepth > 0) intel.push('Sprungschicht vorhanden, Tiefe noch nicht gemessen');
  // Fleet intelligence sometimes knows the enemy commander's character (AI ships only)
  const ai = enemies.find((e) => e.id.startsWith('p_bot-'));
  if (ai && rnd() < 0.6) intel.push(`Feindlagebild: Der gegnerische Kommandant ${ai.name} gilt als ${TRAITS[commanderTrait(ai.id, w.env.seed ?? 0)].de}`);
  if (sub && !duel) intel.push('Funksprüche der Führung alle 20 Minuten: Empfang auf höchstens 25 m oder mit Schleppantenne (bis 60 m, höchstens 6 kn)');
  const steps = sub
    ? ['Langsam (unter 5 kn) und unter 100 m fahren und horchen', 'Kontakt wählen, klassifizieren, dann Kurswechsel für die Entfernung', 'Mit guter TMA-Lösung schießen, danach tief und schnell ablaufen']
    : ['Schleppsonar ausbringen und zwischen U-Boot-Richtung und Konvoi bleiben', 'Sonarbojen voraus werfen, Kontakte klassifizieren', 'Entfernung per Ping oder Hubschrauber, dann U-Jagd-Rakete'];
  return {
    title: m.title, info: m.info, goal, intel, steps,
    timeLimitMin: settings.timeLimitMin, timeOfDay: settings.timeOfDay, ship: `${CLASSES[ship.cls].name} ${ship.name}`,
  };
}
