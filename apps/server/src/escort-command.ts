import {
  CLASSES,
  bearing,
  convoySpeedKn,
  distance,
  emergencyTurn,
  hasHelicopter,
  isConvoyShip,
  isEscort,
  setConvoyCourse,
  setConvoySpeedAdj,
  setZigPlan,
  trueDeg3,
  zigNow,
  zigPlanList,
  zigPlanOf,
  wrap360,
  type ClientMsg,
  type EscortCommandView,
  type Ship,
  type Vec2,
  type World,
} from '@tk/shared';

/**
 * Escort commander's orders (C15). No flagship is defined in the game, so any human escort
 * captain of the side commands: he tasks the side's AI escorts (station, sector, datum,
 * helicopter there; escort-team.ts honours the task until cancelled or done) and orders the
 * convoy (emergency turn, zigzag, speed).
 */

const isHuman = (s: Ship) => s.id.startsWith('p_') && !s.id.startsWith('p_bot-');
const isAi = (s: Ship) => s.id.startsWith('p_bot-');
/** Furthest a tasked point may lie from the convoy (or the commander without one) (m). */
const TASK_REACH_M = 40_000;

/** Is this ship's captain the escort commander of his side (a human on a surface escort)? */
export function isEscortCommander(s: Ship): boolean {
  return s.alive && isHuman(s) && isEscort(s.cls) && !CLASSES[s.cls].submarine;
}

function convoyCenter(w: World, team: string): Vec2 | undefined {
  const ms = w.ships.filter((x) => x.alive && x.team === team && isConvoyShip(x));
  if (!ms.length) return undefined;
  return { x: ms.reduce((a, x) => a + x.pos.x, 0) / ms.length, y: ms.reduce((a, x) => a + x.pos.y, 0) / ms.length };
}

/** The AI escorts a commander may task. */
function aiEscorts(w: World, s: Ship): Ship[] {
  return w.ships.filter((x) => x.alive && x.team === s.team && x.id !== s.id && isAi(x) && isEscort(x.cls));
}

function teamRadio(w: World, s: Ship, text: string): void {
  w.events.push({ kind: 'teamradio', time: w.time, senderId: s.id, text });
}

/** Task an AI escort (or cancel her task). Returns an error text or undefined. */
export function escortTask(w: World, s: Ship, m: Extract<ClientMsg, { t: 'escort_task' }>): string | undefined {
  if (!isEscortCommander(s)) return 'Nur der Geleitführer (Kommandant eines Geleitschiffs) gibt Aufträge';
  const ship = aiEscorts(w, s).find((x) => x.id === m.shipId);
  if (!ship) return 'Kein KI-Geleitschiff des eigenen Verbands';
  const plan = ((w.env.hunt ??= {})[s.team as 'west' | 'east'] ??= { rolesAt: -1e9, hunters: [], helo: {}, said: {} });
  const cmds = (plan.cmds ??= {});
  if (m.task === 'cancel') {
    delete cmds[ship.id];
    teamRadio(w, ship, 'AUFTRAG AUFGEHOBEN · ZURÜCK IN DIE SICHERUNG');
    return undefined;
  }
  const center = convoyCenter(w, s.team);
  const at = { at: w.time, by: s.id };
  if (m.task === 'station') {
    if (!center) return 'Station nur mit einem Konvoi';
    let rel = m.rel;
    let r = m.range;
    if (m.x !== undefined && m.y !== undefined) {
      // A point on the chart: kept as bearing and range from the convoy, so it moves with it
      r = distance(center, { x: m.x, y: m.y });
      rel = wrap360(bearing(center, { x: m.x, y: m.y }) - (w.convoy?.baseHeading ?? w.convoy?.guideHeading ?? 0));
    }
    if (rel === undefined || r === undefined) return 'Station: Punkt oder Peilung und Abstand angeben';
    if (r < 1000 || r > 20_000) return 'Station 1–20 km vom Konvoi';
    cmds[ship.id] = { kind: 'station', rel: Math.round(rel), r: Math.round(r), ...at };
    teamRadio(w, ship, `VERSTANDEN · STATION ${Math.round(rel)}° RELATIV · ${(r / 1000).toFixed(1).replace('.', ',')} KM`);
    return undefined;
  }
  if (m.x === undefined || m.y === undefined) return 'Auftrag braucht einen Punkt auf der Karte';
  const p = { x: m.x, y: m.y };
  if (distance(center ?? s.pos, p) > TASK_REACH_M) return 'Punkt zu weit weg (höchstens 40 km)';
  if (m.task === 'helo' && !hasHelicopter(ship.cls)) return `${ship.name} hat keinen Hubschrauber`;
  cmds[ship.id] = { kind: m.task, x: Math.round(p.x), y: Math.round(p.y), ...at };
  teamRadio(w, ship, { sector: 'VERSTANDEN · SUCHE IM SEKTOR', datum: 'VERSTANDEN · VERFOLGE DATUM', helo: 'VERSTANDEN · HUBSCHRAUBER STARTET' }[m.task]);
  return undefined;
}

/** Convoy orders from the escort commander. Returns an error text or undefined. */
export function convoyOrder(w: World, s: Ship, m: Extract<ClientMsg, { t: 'convoy_order' }>): string | undefined {
  const c = w.convoy;
  if (!isEscortCommander(s)) return 'Nur der Geleitführer gibt dem Konvoi Befehle';
  if (!c || !w.ships.some((x) => isConvoyShip(x) && x.team === s.team)) return 'Kein Konvoi unter eigenem Befehl';
  if (m.order === 'turn') {
    if (m.side === undefined) return 'Wende: Seite angeben';
    emergencyTurn(c, m.side, w.time);
    teamRadio(w, s, m.side ? `KONVOI · NOTWENDE 45° ${m.side < 0 ? 'BACKBORD' : 'STEUERBORD'} · 10 MIN` : 'KONVOI · NOTWENDE AUFGEHOBEN · ZURÜCK AUF ROUTE');
  } else if (m.order === 'zigzag') {
    if (m.on === undefined && m.plan === undefined) return 'Zickzack: Plan oder aus';
    // A plan number picks the diagram; the older on/off keeps the plan last steamed (or the match's default)
    setZigPlan(c, m.plan ?? (m.on ? c.zigPlan ?? zigPlanOf({ ...c, zigzag: true }) : 0), w.time);
    const n = zigPlanOf(c);
    teamRadio(w, s, n ? `KONVOI · ZICKZACK PLAN ${n}` : 'KONVOI · ZICKZACK AUS');
  } else if (m.order === 'course') {
    setConvoyCourse(c, m.course);
    teamRadio(w, s, m.course === undefined ? 'KONVOI · ZURÜCK AUF DIE ROUTE' : `KONVOI · NEUER KURS ${trueDeg3(w, m.course)}`);
  } else {
    if (m.adj === undefined) return 'Fahrt: Änderung angeben';
    setConvoySpeedAdj(c, m.adj);
    teamRadio(w, s, `KONVOI · FAHRT ${Math.round(convoySpeedKn(c))} KN`);
  }
  return undefined;
}

/** What a human escort captain sees for command: the convoy's ordered state and the AI escorts' tasks. */
export function escortCommandFor(w: World, own: Ship): EscortCommandView | undefined {
  if (!isEscortCommander(own)) return undefined;
  const plan = w.env.hunt?.[own.team as 'west' | 'east'];
  const ships = aiEscorts(w, own);
  const c = w.convoy;
  const convoy = c && w.ships.some((x) => isConvoyShip(x) && x.team === own.team)
    ? {
        zigzag: c.zigzag, zigPlan: zigPlanOf(c), zigLeftS: c.zigzag ? Math.round(zigNow(c, w.time).leftS) : undefined, zigPlans: zigPlanList(c), speedKn: Math.round(convoySpeedKn(c) * 10) / 10, adj: c.speedAdj ?? 0,
        ...(c.turn && c.turn.until > w.time ? { turn: { side: c.turn.side, leftS: Math.round(c.turn.until - w.time) } } : {}),
        ...(c.course !== undefined ? { course: c.course } : {}),
        ...(c.offset ? { offset: c.offset } : {}),
      }
    : undefined;
  if (!convoy && !ships.length) return undefined;
  return {
    convoy,
    escorts: ships.map((x) => {
      const t = plan?.cmds?.[x.id];
      return {
        id: x.id, name: x.name, cls: x.cls, role: plan?.roles?.[x.id], helo: hasHelicopter(x.cls),
        ...(t ? { task: { kind: t.kind, x: t.x, y: t.y, rel: t.rel, range: t.r, sinceS: Math.round(w.time - t.at) } } : {}),
      };
    }),
  };
}
