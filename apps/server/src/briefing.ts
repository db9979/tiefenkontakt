import {
  CLASSES,
  hasHelicopter,
  KN,
  bearing,
  distance,
  type Briefing,
  type Ship,
  type World,
  isConvoyShip,
  TRAITS,
  commanderTrait,
  MONTH_NAME,
  REGIONS,
  currentNote,
  lightNote,
  trueDeg3,
  compassStem,
  batteryDrainPctH,
} from '@tk/shared';
import { MISSIONS, seaMinutes, simTimeLimit, type ScenarioSettings } from './scenario.js';
import { escapeS, shadowGoalS } from './rules.js';

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
    if (e) intel.push(`Gegner zuletzt gemeldet: etwa Peilung ${trueDeg3(w, bearing(ship.pos, e.pos) + (rnd() - 0.5) * 40)}, ${km(distance(ship.pos, e.pos) * (0.7 + rnd() * 0.6))}`);
  } else if (sub) {
    goal = harbour ? 'In die Bucht eindringen und die ankernden Frachter versenken.' : 'Die Hälfte der Konvoi-Tonnage versenken, bevor der Konvoi sein Ziel erreicht.';
    if (centre) {
      const b = bearing(ship.pos, centre) + (rnd() - 0.5) * 30;
      intel.push(`Aufklärung: ${harbour ? 'Ankerplatz' : 'Konvoi'} etwa Peilung ${trueDeg3(w, b)}, ${km(distance(ship.pos, centre) * (0.75 + rnd() * 0.5))} (ungenau)`);
      if (!harbour) intel.push(`Konvoi: ${merchants.length} Frachter, etwa ${Math.round((merchants[0]!.speed / KN) * 10) / 10 || 9} kn, Generalkurs ${trueDeg3(w, w.convoy?.guideHeading ?? 0, 10)}`);
    }
    intel.push(`Eskorte: ${enemies.length} Fregatte(n) mit Schleppsonar, Hubschrauber und U-Jagd-Raketen`);
  } else {
    goal = harbour ? 'Die Einfahrt halten, bis die Zeit abläuft.' : 'Den Konvoi ins Ziel bringen oder alle U-Boote versenken.';
    if (centre) intel.push(`${harbour ? 'Ankerplatz' : 'Konvoi'}: Peilung ${trueDeg3(w, bearing(ship.pos, centre))}, ${km(distance(ship.pos, centre))}, ${merchants.length} Frachter`);
    intel.push(`Bedrohung: ${enemies.length} U-Boot(e), vermutlich voraus des Konvois`);
  }
  // Missions with goals beyond sinking (the strait runs along the route, game +y: named by its true direction)
  const to = compassStem(w, 0);
  const special: Record<string, [string, string]> = {
    fuehlung: [`Fühlung zum Konvoi halten: ${Math.round(shadowGoalS(simTimeLimit(settings)) / 60)} Minuten Kontakt aus höchstens 12 km, dabei alle 15 Minuten die Lage funken. Waffen sind gesperrt.`, 'Die Fühlung der U-Boote abschütteln, bis die Zeit abläuft.'],
    meerenge: [`Durch die Enge nach ${to}en durchbrechen: ein Boot muss das ${to}ende erreichen.`, `Die Enge halten: kein U-Boot darf nach ${to}en durch.`],
    aufklaerung: [`Ein Geleitschiff auf höchstens 4 km im Sehrohr erkennen, per Funk melden und danach ${Math.round(escapeS(simTimeLimit(settings)) / 60)} Minuten entkommen.`, 'Keine Feindmeldung zulassen: U-Boote abdrängen oder versenken.'],
  };
  const sp = special[settings.mission];
  if (sp) goal = sub ? sp[0] : sp[1];
  // The real area in its season: the month, the light, the layering, the currents
  const region = w.env.seabed?.region;
  if (region && w.env.month) {
    const ln = lightNote(REGIONS[region].lat, w.env.month);
    intel.push(`${MONTH_NAME[w.env.month - 1]} im Gebiet ${REGIONS[region].name}${ln ? ` · ${ln}` : ''}`);
    const cn = currentNote(region);
    if (cn) intel.push(`Strömung: ${cn}`);
  }
  if (w.env.layerDepth > 0) intel.push('Sprungschicht vorhanden, Tiefe noch nicht gemessen');
  else if (region) intel.push('Keine Sprungschicht: das Wasser ist bis zum Grund durchmischt, unter der Schicht verstecken geht nicht');
  // Fleet intelligence sometimes knows the enemy commander's character (AI ships only)
  const ai = enemies.find((e) => e.id.startsWith('p_bot-'));
  if (ai && rnd() < 0.6) intel.push(`Feindlagebild: Der gegnerische Kommandant ${ai.name} gilt als ${TRAITS[commanderTrait(ai.id, w.env.seed ?? 0)].de}`);
  if (sub && !duel) intel.push('Funksprüche der Führung alle 20 Minuten: Empfang auf höchstens 25 m oder mit Schleppantenne (bis 60 m, höchstens 6 kn)');
  if ((settings.mission === 'hafen' || settings.mission === 'meerenge') && (!sub || w.weapons?.loadouts.get(ship.id)?.mines)) intel.push(sub ? 'Minen: Wo die Eskorte patrouilliert, sperren ein paar Minen ihr Fahrwasser (Feuerleitung, bis 300 m Wassertiefe)' : 'Minengefahr: Aktivsonar findet Minen voraus auf etwa 1 km');
  // Diesel boats: how much the patrol left in the battery and how long that lasts at a creep
  const cap = CLASSES[ship.cls].battery?.capacityKnH;
  if (cap && ship.battery !== undefined) {
    const pct = Math.round((100 * ship.battery) / cap);
    intel.push(`Batterie bei ${pct} %: bei 4 kn etwa ${Math.round(pct / batteryDrainPctH(4))} h getaucht, bei 10 kn etwa ${(pct / batteryDrainPctH(10)).toFixed(1).replace('.', ',')} h; Schnorcheln lädt`);
  }
  const steps = sub
    ? ['Langsam (unter 5 kn) und unter 100 m fahren und horchen', 'Kontakt wählen, klassifizieren, dann Kurswechsel für die Entfernung', 'Mit guter TMA-Lösung schießen, danach tief und schnell ablaufen']
    : hasHelicopter(ship.cls)
      ? ['Schleppsonar ausbringen und zwischen U-Boot-Richtung und Konvoi bleiben', 'Sonarbojen voraus werfen, Kontakte klassifizieren', 'Entfernung per Ping oder Hubschrauber, dann U-Jagd-Rakete']
      : CLASSES[ship.cls].vds
        ? ['BT werfen, dann VDS unter die Schicht absenken und Schleppsonar ausbringen', 'Zwischen U-Boot-Richtung und Konvoi bleiben (unter 18 kn), Kontakte klassifizieren', 'Entfernung per Ping (im Flachwasser LFM) oder Kreuzpeilung, dann U-Jagd-Rakete']
        : ['Schleppsonar ausbringen und die Flanke des Konvois sichern', 'Kontakte klassifizieren und über Datalink an die Fregatte melden', 'Entfernung per Ping oder Kreuzpeilung, dann U-Jagd-Rakete oder Wasserbomben'];
  return {
    title: m.title, info: m.info, goal, intel, steps,
    timeLimitMin: settings.timeLimitMin, timeScale: settings.timeScale, seaMin: seaMinutes(settings), timeOfDay: settings.timeOfDay, ship: `${CLASSES[ship.cls].name} ${ship.name}`,
  };
}
