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
  runTimeLeft,
  wireLostRecently,
  emptyDamage,
  depthAt,
  aircraftPosition,
  heloLow,
  heloView,
  HELO_REFUEL_S,
  cavitationSpeedKn,
  sourceLevel,
  towedArrayReady,
  towedGeometryDepth,
  type AlertView,
  type ContactTrack,
  type Realism,
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
  Rng,
  pingInterval,
  pingRangeOf,
} from '@tk/shared';
import { huntFor } from './bots/escort-team.js';
import { glowTracksFor } from './glow-tracks.js';
import { escortCommandFor } from './escort-command.js';
import { correlate, linkedFriendly, logPositions, ownAt, pictureOf, reportedTrack, type Picture } from './datalink.js';
import { markKey, shownMark, type ClassMark } from './classes.js';

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
  /** Datalink: mate track labels merged into another track at the last snapshot (gate hysteresis). */
  linkMerged?: Record<string, string>;
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

/** How long an optical look keeps showing a target's damage (s). */
export const WRECK_VIEW_S = 5;

/**
 * Seen by eye (periscope or bridge lookout) within the last few seconds. `sensors` only ever
 * grows, so it can't tell: a target once in the periscope would report its damage forever after.
 */
function seenOptically(tr: ContactTrack, now: number): boolean {
  for (let i = tr.history.length - 1; i >= 0; i--) {
    const h = tr.history[i]!;
    if (now - h.t > WRECK_VIEW_S) return false;
    if (h.sensor === 'periscope' || h.sensor === 'visual') return true;
  }
  return false;
}

/**
 * Forget delta bookkeeping for labels not in this snapshot: the client drops a vanished
 * contact's history, so when the label comes back it must get the whole history again.
 */
function forgetVanished(x: PlayerExtras, sent: ReadonlySet<string>): void {
  const keep = (rec: Record<string, number> | undefined) => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(rec ?? {})) if (sent.has(k)) out[k] = v;
    return out;
  };
  // Always defined afterwards: an undefined histSent marks the next snapshot as full
  x.histSent = keep(x.histSent);
  x.evSent = keep(x.evSent);
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
export function datalinkMates(w: World, own: Ship): Ship[] {
  return w.ships.filter((s) => s.team === own.team && s.id !== own.id && hasDatalink(s));
}

/** Classification decisions are shared within a datalink group; a submarine keeps its own. */
export function classGroupKey(s: Ship): string {
  return hasDatalink(s) ? `team:${s.team}` : `ship:${s.id}`;
}

/** The optic draws a ship this long (s) after she was last in its field of view. */
const LOOK_HOLD_S = 10;

/**
 * What the periscope may tell this player. The server's books hold the class seen and the
 * estimated range; Profi gets neither (only the stadimeter angle, ranged with the class he
 * assigns), Einsteiger gets the range and, once she was held 10 s in the 6×/12× optic, the class.
 */
function periscopeView(tr: ContactTrack, hist: ContactTrack['history'], realism: Realism, now: number): Partial<Snapshot['contacts'][number]> {
  const profi = realism === 'profi';
  const optical = profi && tr.rangeBy === 'periscope';
  return {
    classified: !profi && tr.idAt !== undefined ? tr.classified : undefined,
    look: tr.scopeAt !== undefined && now - tr.scopeAt < LOOK_HOLD_S ? tr.classified : undefined,
    range: optical ? undefined : tr.range,
    rangeAt: optical ? undefined : tr.rangeAt,
    history: profi ? hist.map((h) => (h.sensor === 'periscope' && h.r !== undefined ? { ...h, r: undefined } : h)) : hist,
  };
}

export function buildSnapshot(
  w: World, own: Ship, x: PlayerExtras, score: ScoreInfo, marks?: ReadonlyMap<string, ClassMark>,
  realism: Realism = 'einsteiger',
): Snapshot {
  // FOG OF WAR: marks are per track (classes.ts), so a dual track of one boat shows none of the other's
  const markOf = (ownerId: string, label: string) => marks?.get(markKey(ownerId, label));
  const l = w.weapons?.loadouts.get(own.id);
  const contacts: Snapshot['contacts'] = [];
  for (const [tid, tr] of w.books.get(own.id)?.entries() ?? []) {
    contacts.push({
      ...tr, evidence: newEvidence(x, tr.label, tr), history: [], via: 'own', ...shownMark(markOf(own.id, tr.label)), wreck: seenOptically(tr, w.time) ? wreckOf(w, tid) : undefined,
      ...periscopeView(tr, newSamples(x, tr.label, tr.history, 120), realism, w.time),
    });
  }

  const friendlies: FriendlyView[] = [];
  if (hasDatalink(own)) {
    // FOG OF WAR: the datalink carries surface ships only; a submarine is where it last radioed
    const mates = datalinkMates(w, own);
    logPositions(w, [own, ...mates]);
    // Each mate as of its last report on the net, in its own (gridlocked) frame
    for (const m of mates) friendlies.push(linkedFriendly(w, m, friendlyOf(m, w.time)));
    const linked = new Set(mates.map((m) => m.id));
    for (const r of x.reports.values()) if (!linked.has(r.id)) friendlies.push(r);
    // Correlation by gate (datalink.ts), never by the target's identity: own tracks first, then each mate's in turn
    const now = w.time;
    // The own picture from the own book (samples without an origin were taken where the own ship was)
    const picture: Picture[] = (w.books.get(own.id)?.tracks() ?? []).map((tr) => pictureOf(tr, now, ownAt(w, own)));
    const was = (x.linkMerged ??= {});
    const merged: Record<string, string> = {};
    // Each picture label's own mark, and the marks of the mates' tracks the gate merged into it
    const markAt = new Map<string, ClassMark | undefined>((w.books.get(own.id)?.tracks() ?? []).map((tr) => [tr.label, markOf(own.id, tr.label)]));
    const mergedMarks = new Map<string, ClassMark>();
    mates.forEach((m, i) => {
      for (const [, raw] of w.books.get(m.id)?.entries() ?? []) {
        const tr = reportedTrack(w, m, raw);
        if (!tr) continue;
        const label = `L${i + 1}-${raw.label}`;
        const p = { ...pictureOf(tr, now, () => m.pos), label };
        const into = correlate(p, picture, was[label]);
        const mark = markOf(m.id, raw.label);
        if (into) {
          merged[label] = into;
          if (mark && !mergedMarks.has(into)) mergedMarks.set(into, mark);
          continue;
        }
        picture.push(p);
        markAt.set(label, mark);
        contacts.push({
          ...tr, label, evidence: newEvidence(x, label, tr), history: [], via: 'datalink', ...shownMark(mark),
          ...periscopeView(tr, newSamples(x, label, tr.history, 30), realism, w.time),
        });
      }
    });
    x.linkMerged = merged;
    // A mate's mark travels with his track only where the gate merged it, and only onto a track
    // nobody of the group has marked (a mark cleared on purpose stays cleared)
    for (const c of contacts) {
      const inherited = !markAt.get(c.label) ? mergedMarks.get(c.label) : undefined;
      if (inherited) Object.assign(c, shownMark(inherited));
    }
  } else {
    friendlies.push(...x.reports.values());
  }
  forgetVanished(x, new Set(contacts.map((c) => c.label)));

  // The wire reports where the torpedo is relative to the boat: on the chart it sits beside the
  // dead-reckoned own position, so it carries the same reckoning error. Own mines and aircraft
  // too: a boat plots them from its own believed position, not from the truth.
  const dr = own.drErr ?? { x: 0, y: 0 };
  const shifted = CLASSES[own.cls].submarine && (dr.x !== 0 || dr.y !== 0);
  const torpedoes = (w.weapons?.torpedoes ?? [])
    .filter((t) => t.ownerId === own.id && t.wire)
    .map((t) => ({ id: t.id, x: t.pos.x + dr.x, y: t.pos.y + dr.y, depth: t.depth, heading: t.heading, wire: t.wire, homing: !!t.homingOn, run: t.run, leftS: Math.round(runTimeLeft(t)),
      wireWarn: t.wireWarn, attackKn: t.attackKn !== undefined && t.speedKn !== t.attackKn ? t.attackKn : undefined }));
  // F16: torpedoes whose wire broke (or that left without one) stay on the wire panel a while
  const wireLost = (w.weapons?.torpedoes ?? [])
    .filter((t) => t.ownerId === own.id && wireLostRecently(t, w.time))
    .map((t) => ({ id: t.id, why: t.wireLost!.why, wake: t.mode === 'wake' || undefined }));

  let air: Snapshot['air'];
  if (hasDatalink(own) && w.air) {
    const team = new Set(w.ships.filter((s) => s.team === own.team).map((s) => s.id));
    const helos: NonNullable<Snapshot['air']>['helos'] = [];
    for (const s of w.air.sorties) {
      const ship = w.ships.find((x) => x.id === s.shipId);
      const p = team.has(s.shipId) && ship ? aircraftPosition(s, w.time, ship) : undefined;
      if (p) helos.push({ ...p, kind: s.kind ?? 'buoy', hovering: s.hoverUntil !== undefined && w.time >= s.dropAt && w.time <= s.hoverUntil });
    }
    const KIND = { dip: 'dip', buoys: 'buoy', mad: 'mad', attack: 'torpedo', return: 'transit' } as const;
    for (const h of Object.values(w.air.helos ?? {})) {
      if (!team.has(h.shipId) || h.state !== 'air') continue;
      const low = heloLow(h);
      helos.push({ x: h.x, y: h.y, kind: h.queue[0] ? KIND[h.queue[0].kind] : 'transit', hovering: low === 'dip' });
    }
    const mpa = w.air.mpa?.[own.team];
    const helo = heloView(w, own);
    air = {
      buoys: w.air.buoys.filter((b) => team.has(b.ownerId)).map((b) => ({ id: b.id, x: b.pos.x, y: b.pos.y, depth: b.depth, leftS: b.expiresAt - w.time, active: b.active })),
      helos,
      stock: helo?.buoys ?? 0,
      heloReadyInS: !helo ? 0 : helo.state === 'deck' ? helo.readyInS : helo.fuelS + HELO_REFUEL_S,
      heloTorps: helo?.torps ?? 0,
      helo,
      mpaReadyInS: mpa ? Math.max(0, mpa.readyAt - w.time) : 0,
      mpaBuoys: mpa?.buoys ?? 0,
    };
  }
  return {
    planes: shifted ? planesFor(w, own).map((p) => (p.x !== undefined && p.y !== undefined ? { ...p, x: Math.round(p.x + dr.x), y: Math.round(p.y + dr.y) } : p)) : planesFor(w, own),
    orders: ordersFor(w, own),
    hunt: huntFor(w, own),
    command: escortCommandFor(w, own),
    airdef: airDefFor(w, own),
    ssm: ssmFor(w, own),
    mines: shifted ? minesFor(w, own).map((m) => ({ ...m, x: Math.round(m.x + dr.x), y: Math.round(m.y + dr.y) })) : minesFor(w, own),
    air,
    time: w.time,
    timeScale: x.timeScale ?? 1,
    crew: [own.name],
    own: {
      // Submerged boats see where they believe they are (dead reckoning), not the truth
      id: own.id, cls: own.cls, team: own.team, name: own.name, x: own.pos.x + (own.drErr?.x ?? 0), y: own.pos.y + (own.drErr?.y ?? 0),
      depth: own.depth, heading: own.heading, speedKn: own.speed / KN, sternway: own.sternway || undefined, order: { ...own.order }, route: own.route?.wps.length ? { wps: own.route.wps.map((p) => ({ ...p })), idx: own.route.idx, active: own.route.active } : undefined,
      alive: own.alive, hp: own.hp, battery: own.battery, batteryEnduranceS: batteryEndurance(own),
      snorkel: own.snorkel, mastUp: own.mastUp, mastPending: own.mastPending || undefined, mastExt: own.mastExt, snorkelExt: own.snorkelExt, mastUpSince: x.mastUpSince, radarOn: own.radarOn,
      activeSonar: own.activeSonar, pulse: own.pulse, lastPingAt: own.lastPingAt > 0 ? own.lastPingAt : undefined, pingRange: pingRangeOf(own), pingEvery: pingInterval(own), pingPending: own.pingOnce || undefined, towedLength: Math.round(own.towedLength), towedOrder: own.towedOrder, towedDepth: own.towedLength > 0 ? Math.round(towedGeometryDepth(own)) : undefined, vdsDepth: own.vdsDepth !== undefined ? Math.round(own.vdsDepth) : undefined, vdsOrder: own.vdsOrder, mineAvoid: own.mineAvoid || undefined, mineAvoidRange: isEscort(own.cls) ? mineSearchRange(w, own) || undefined : undefined, convoyOffset: isEscort(own.cls) && w.convoy?.offset ? w.convoy.offset : undefined, towedReady: towedArrayReady(own, w.time),
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
        depthCharges: l?.depthCharges ?? 0, noisemakers: l?.noisemakers ?? 0, towedDecoy: l?.towedDecoy ?? false, xbt: l?.xbt ?? 0, mines: l?.mines, wake: l?.wake,
      },
    },
    contacts,
    friendlies,
    torpedoes,
    ...(wireLost.length ? { wireLost } : {}),
    ...(() => { const g = glowTracksFor(w, own); return g ? { glowTracks: g } : {}; })(),
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
      ...layerView(w, own), seaState: w.env.seaState, light: w.env.light, rain: w.env.rain || inSquall(w.env.met, own.pos), clock: w.env.weather?.clock, met: metView(w.env.met),
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

/** Where the sun stands over the real area (map frame), the date of the match and the moonlight. */
function sunView(w: World): { sun?: { el: number; az: number }; month?: number; day?: number; moon?: number } {
  const { lat, month, weather, seabed, day, moon } = w.env;
  if (lat === undefined || !month || !weather) return {};
  const p = sunPosition(lat, month, weather.clock);
  const turn = seabed?.region ? REGIONS[seabed.region].bearing : 0;
  return { sun: { el: Math.round(p.el * 10) / 10, az: Math.round(wrap360(p.az - turn)) }, month, ...(day !== undefined ? { day, moon } : {}) };
}

/** The briefing's own random stream: the same text after a reconnect, the sim's stream untouched. */
export function briefingRng(seed: number, shipId: string): () => number {
  let h = seed >>> 0;
  for (const ch of shipId) h = Math.imul(h ^ ch.charCodeAt(0), 0x9e3779b1) >>> 0;
  const r = new Rng(h);
  return () => r.next();
}

/** The measured layer as the crew sees it here: none where the water is shallower than the layer (mixed to the bottom). */
function layerView(w: World, own: Ship): { layerDepth?: number; noLayer?: boolean } {
  const l = own.btLayer;
  if (l === undefined) return {};
  const bottom = w.env.seabed ? depthAt(w.env.seabed, own.pos.x, own.pos.y) : Infinity;
  return l > 0 && bottom > l + 2 ? { layerDepth: l } : { noLayer: true };
}
