import {
  isEscort,
  mineSearchRange,
  planesFor,
  inSquall,
  metView,
  airDefFor,
  ssmFor,
  minesFor,
  CLASSES,
  KN,
  batteryEndurance,
  emptyDamage,
  depthAt,
  aircraftPosition,
  cavitationSpeedKn,
  sourceLevel,
  towedArrayReady,
  type AlertView,
  type ContactTrack,
  type ClassChoice,
  type ClassId,
  type World as W,
  type FriendlyView,
  type RadioMsg,
  type Ship,
  type Snapshot,
  type World,
  crewPerformance,
  mastRaised,
  nextBroadcastIn,
  ordersFor,
  broadcastAt,
  canCopy,
  compartmentView,
  dcTarget,
  wreckView,
  currentAt,
  tideState,
  wrap360,
  sunPosition,
  nextSatPassIn,
  REGIONS,
} from '@tk/shared';
import { huntFor } from './bots/escort-team.js';

export interface PlayerExtras {
  /** Briefing already delivered on this connection. */
  briefed?: boolean;
  alerts: AlertView[];
  radio: RadioMsg[];
  /** Last radio-reported positions of teammates (subs have no datalink). */
  reports: Map<string, FriendlyView>;
  mastUpSince?: number;
  timeScale?: number;
  /** Bearing history already sent to this player, per contact label (delta encoding). */
  histSent?: Record<string, number>;
  /** Evidence time already sent per label, and counts of alerts/radio already sent. */
  evSent?: Record<string, number>;
  alertsSent?: number;
  radioSent?: number;
  /** Entries dropped from the front of the capped lists (to keep absolute counts). */
  alertsDropped?: number;
  radioDropped?: number;
}

/** Append-only list delta: entries after the absolute count already sent. */
function newEntries<T>(list: T[], dropped: number | undefined, sent: number | undefined, firstCap: number): { items: T[]; total: number } {
  const total = (dropped ?? 0) + list.length;
  const items = sent === undefined ? list.slice(-firstCap) : list.slice(Math.max(0, sent - (dropped ?? 0)));
  return { items, total };
}

/** Evidence only when it changed since the last snapshot to this player. */
function newEvidence(x: PlayerExtras, label: string, tr: ContactTrack): ContactTrack['evidence'] {
  const sent = (x.evSent ??= {})[label];
  if (tr.evidenceAt === undefined || tr.evidenceAt === sent) return undefined;
  x.evSent[label] = tr.evidenceAt;
  return tr.evidence;
}

/** Only the bearing samples this player hasn't received yet (all of them after a reset). */
function newSamples(x: PlayerExtras, label: string, hist: ContactTrack['history'], cap: number): ContactTrack['history'] {
  const sent = (x.histSent ??= {})[label];
  const fresh = sent === undefined ? hist.slice(-cap) : hist.filter((h) => h.t > sent);
  const last = hist[hist.length - 1];
  if (last) x.histSent[label] = last.t;
  return fresh;
}

/** What the periscope shows of a target's damage (list, fire): the eye sees it, no sensor needed. */
function wreckOf(w: World, id: string): ReturnType<typeof wreckView> {
  const t = w.ships.find((s) => s.id === id);
  return t ? wreckView(t) : undefined;
}

export interface ScoreInfo {
  sunkTons: number;
  arrivedTons: number;
  totalTons: number;
  timeLeftS: number;
}

function friendlyOf(s: Ship, now: number): FriendlyView {
  return {
    id: s.id, name: s.name, cls: s.cls, x: s.pos.x, y: s.pos.y, heading: s.heading,
    speedKn: s.speed / KN, reportedAt: now, alive: s.alive, lit: s.lights, wreck: wreckView(s),
  };
}

/** Surface ships of a team share everything over datalink. */
export function hasDatalink(s: Ship): boolean {
  return !CLASSES[s.cls].submarine;
}

/**
 * Build the per-player view. FOG OF WAR: this is the only place where world
 * state flows to a client. Enemy ships appear exclusively as sensor tracks.
 */
/** Datalink mates of a surface ship, in a stable order (their index forms the L<n>- label prefix). */
export function datalinkMates(w: W, own: Ship): Ship[] {
  return w.ships.filter((s) => s.team === own.team && s.id !== own.id && hasDatalink(s));
}

/** Classification decisions are shared within a datalink group; a submarine keeps its own. */
export function classGroupKey(s: Ship): string {
  return hasDatalink(s) ? `team:${s.team}` : `ship:${s.id}`;
}

export function buildSnapshot(
  w: World, own: Ship, x: PlayerExtras, score: ScoreInfo, classes?: ReadonlyMap<string, ClassChoice>, idents?: Readonly<Record<string, ClassId>>,
): Snapshot {
  const l = w.weapons?.loadouts.get(own.id);
  const contacts: Snapshot['contacts'] = [];
  // Track correlation: each target appears once (own contact first, then the first mate's)
  const seen = new Set<string>();
  for (const [tid, tr] of w.books.get(own.id)?.entries() ?? []) {
    seen.add(tid);
    contacts.push({ ...tr, evidence: newEvidence(x, tr.label, tr), history: newSamples(x, tr.label, tr.history, 120), via: 'own', assigned: classes?.get(tid), assignedCls: idents?.[tid], wreck: tr.sensors.includes('periscope') ? wreckOf(w, tid) : undefined });
  }

  const friendlies: FriendlyView[] = [];
  if (hasDatalink(own)) {
    const mates = w.ships.filter((s) => s.team === own.team && s.id !== own.id);
    for (const m of mates) friendlies.push(friendlyOf(m, w.time));
    datalinkMates(w, own).forEach((m, i) => {
      for (const [tid, tr] of w.books.get(m.id)?.entries() ?? []) {
        if (seen.has(tid)) continue;
        seen.add(tid);
        contacts.push({
          ...tr, label: `L${i + 1}-${tr.label}`, evidence: newEvidence(x, `L${i + 1}-${tr.label}`, tr), history: newSamples(x, `L${i + 1}-${tr.label}`, tr.history, 30), via: 'datalink', assigned: classes?.get(tid), assignedCls: idents?.[tid],
        });
      }
    });
  } else {
    friendlies.push(...x.reports.values());
  }

  // The wire reports where the torpedo is relative to the boat: on the chart it sits beside the
  // dead-reckoned own position, so it carries the same reckoning error
  const dr = own.drErr ?? { x: 0, y: 0 };
  const torpedoes = (w.weapons?.torpedoes ?? [])
    .filter((t) => t.ownerId === own.id && t.wire)
    .map((t) => ({ id: t.id, x: t.pos.x + dr.x, y: t.pos.y + dr.y, depth: t.depth, heading: t.heading, wire: t.wire, homing: !!t.homingOn, run: t.run }));

  let air: Snapshot['air'];
  if (hasDatalink(own) && w.air) {
    const team = new Set(w.ships.filter((s) => s.team === own.team).map((s) => s.id));
    const helos: NonNullable<Snapshot['air']>['helos'] = [];
    for (const s of w.air.sorties) {
      const ship = w.ships.find((x) => x.id === s.shipId);
      const p = team.has(s.shipId) && ship ? aircraftPosition(s, w.time, ship) : undefined;
      if (p) helos.push({ ...p, kind: s.kind ?? 'buoy', hovering: s.hoverUntil !== undefined && w.time >= s.dropAt && w.time <= s.hoverUntil });
    }
    const mine = w.air.sorties.filter((s) => s.shipId === own.id && s.kind !== 'mpa').map((s) => s.readyAt);
    const mpa = w.air.mpa?.[own.team];
    air = {
      buoys: w.air.buoys.filter((b) => team.has(b.ownerId)).map((b) => ({ id: b.id, x: b.pos.x, y: b.pos.y, depth: b.depth, leftS: b.expiresAt - w.time, active: b.active })),
      helos,
      stock: w.air.stock.get(own.id) ?? 0,
      heloReadyInS: Math.max(0, ...mine.map((t) => t - w.time)),
      heloTorps: w.air.heloTorps?.get(own.id) ?? 0,
      mpaReadyInS: mpa ? Math.max(0, mpa.readyAt - w.time) : 0,
      mpaBuoys: mpa?.buoys ?? 0,
    };
  }
  return {
    planes: planesFor(w, own),
    orders: ordersFor(w, own),
    hunt: huntFor(w, own),
    airdef: airDefFor(w, own),
    ssm: ssmFor(w, own),
    mines: minesFor(w, own),
    air,
    time: w.time,
    timeScale: x.timeScale ?? 1,
    crew: [own.name],
    own: {
      // Submerged boats see where they believe they are (dead reckoning), not the truth
      id: own.id, cls: own.cls, team: own.team, name: own.name, x: own.pos.x + (own.drErr?.x ?? 0), y: own.pos.y + (own.drErr?.y ?? 0),
      depth: own.depth, heading: own.heading, speedKn: own.speed / KN, order: { ...own.order }, route: own.route?.wps.length ? { wps: own.route.wps.map((p) => ({ ...p })), idx: own.route.idx, active: own.route.active } : undefined,
      alive: own.alive, hp: own.hp, battery: own.battery, batteryEnduranceS: batteryEndurance(own),
      snorkel: own.snorkel, mastUp: own.mastUp, mastExt: own.mastExt, snorkelExt: own.snorkelExt, mastUpSince: x.mastUpSince, radarOn: own.radarOn,
      activeSonar: own.activeSonar, pulse: own.pulse, lastPingAt: own.lastPingAt > 0 ? own.lastPingAt : undefined, towedLength: Math.round(own.towedLength), towedOrder: own.towedOrder, vdsDepth: own.vdsDepth !== undefined ? Math.round(own.vdsDepth) : undefined, vdsOrder: own.vdsOrder, mineAvoid: own.mineAvoid || undefined, mineAvoidRange: isEscort(own.cls) ? mineSearchRange(w, own) || undefined : undefined, convoyOffset: isEscort(own.cls) && w.convoy?.offset ? w.convoy.offset : undefined, towedReady: towedArrayReady(own, w.time),
      damage: { ...(own.damage ?? emptyDamage()) }, repair: own.repair,
      comps: own.comps && compartmentView(own), dcComp: own.dcComp, dcAt: own.comps && dcTarget(own), wreck: wreckView(own),
      crew: own.crew && { ...own.crew, performance: Math.round(crewPerformance(own) * 100) / 100 },
      air: own.air && { ...own.air }, trim: own.trim, hpAir: own.hpAir, blowing: own.blowing, buoyAntenna: own.buoyAntenna,
      navUncertainty: CLASSES[own.cls].submarine && own.navSigma !== undefined ? Math.round(own.navSigma) : undefined,
      nav: CLASSES[own.cls].submarine ? {
        lastFix: own.lastFix, lastFixAgo: own.lastFixAt !== undefined ? Math.round(w.time - own.lastFixAt) : undefined,
        satIn: Math.round(nextSatPassIn(w)), sat: own.navFix?.sat ? Math.round(own.navFix.sat) : undefined, stars: own.navFix?.stars ? Math.round(own.navFix.stars) : undefined,
      } : undefined,
      rudderJam: (own.rudderJamUntil ?? 0) > w.time, towedLost: (own.towedLostUntil ?? 0) > w.time,
      command: CLASSES[own.cls].submarine ? {
        nextS: nextBroadcastIn(w.time),
        progress: own.cmdRx && broadcastAt(w.time) === own.cmdRx.k ? Math.min(1, own.cmdRx.secs / 60) : 0,
        done: !!own.cmdRx?.done && broadcastAt(w.time) === own.cmdRx.k, via: canCopy(own),
      } : undefined,
      noiseDb: sourceLevel(own), cavitationKn: Number.isFinite(cavitationSpeedKn(own)) ? cavitationSpeedKn(own) : 99,
      loadout: {
        tubes: (l?.tubes ?? []).map((t) => ({ loaded: t.loaded, reloadLeft: t.reloadDoneAt ? Math.max(0, t.reloadDoneAt - w.time) : 0 })),
        heavy: l?.heavy ?? 0, light: l?.light ?? 0, rockets: l?.rockets ?? 0,
        depthCharges: l?.depthCharges ?? 0, noisemakers: l?.noisemakers ?? 0, towedDecoy: l?.towedDecoy ?? false, xbt: l?.xbt ?? 0, mines: l?.mines,
      },
    },
    contacts,
    friendlies,
    torpedoes,
    // Delta: only entries this player hasn't received yet
    radio: (() => {
      const d = newEntries(x.radio, x.radioDropped, x.radioSent, 30);
      x.radioSent = d.total;
      return d.items;
    })(),
    alerts: (() => {
      const d = newEntries(x.alerts, x.alertsDropped, x.alertsSent, 20);
      x.alertsSent = d.total;
      return d.items;
    })(),
    env: {
      layerDepth: own.btLayer, seaState: w.env.seaState, light: w.env.light, rain: w.env.rain || inSquall(w.env.met, own.pos), clock: w.env.weather?.clock, met: metView(w.env.met),
      bottom: w.env.seabed ? Math.round(depthAt(w.env.seabed, own.pos.x, own.pos.y)) : undefined, seabed: w.env.seabed,
      ...currentView(w, own),
      ...sunView(w),
    },
    score,
  };
}

/** The set and drift at the own ship from the atlas, and the tide (only on real charts). */
function currentView(w: World, own: Ship): { current?: { set: number; kn: number }; tide?: { kn: number; flood: boolean; turnsInS: number } } {
  if (!w.env.seabed?.region) return {};
  const c = currentAt(w.env, own.pos, own.depth, w.time);
  const kn = Math.hypot(c.x, c.y) / KN;
  const tide = tideState(w.env, w.time);
  return {
    current: { set: Math.round(wrap360((Math.atan2(c.x, c.y) * 180) / Math.PI)), kn: Math.round(kn * 10) / 10 },
    ...(tide ? { tide: { kn: Math.round(tide.kn * 10) / 10, flood: tide.flood, turnsInS: Math.round(tide.turnsInS) } } : {}),
  };
}

/** Where the sun stands over the real area (map frame) and the month of the match. */
function sunView(w: World): { sun?: { el: number; az: number }; month?: number } {
  const { lat, month, weather, seabed } = w.env;
  if (lat === undefined || !month || !weather) return {};
  const p = sunPosition(lat, month, weather.clock);
  const turn = seabed?.region ? REGIONS[seabed.region].bearing : 0;
  return { sun: { el: Math.round(p.el * 10) / 10, az: Math.round(wrap360(p.az - turn)) }, month };
}
