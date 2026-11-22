import {
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
  type World as W,
  type FriendlyView,
  type RadioMsg,
  type Ship,
  type Snapshot,
  type World,
  crewPerformance,
  mastRaised,
  nextBroadcastIn,
  broadcastAt,
  canCopy,
} from '@tk/shared';

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

export interface ScoreInfo {
  sunkTons: number;
  arrivedTons: number;
  totalTons: number;
  timeLeftS: number;
}

function friendlyOf(s: Ship, now: number): FriendlyView {
  return {
    id: s.id, name: s.name, cls: s.cls, x: s.pos.x, y: s.pos.y, heading: s.heading,
    speedKn: s.speed / KN, reportedAt: now, alive: s.alive, lit: s.lights,
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
  w: World, own: Ship, x: PlayerExtras, score: ScoreInfo, classes?: ReadonlyMap<string, ClassChoice>,
): Snapshot {
  const l = w.weapons?.loadouts.get(own.id);
  const contacts: Snapshot['contacts'] = [];
  // Track correlation: each target appears once (own contact first, then the first mate's)
  const seen = new Set<string>();
  for (const [tid, tr] of w.books.get(own.id)?.entries() ?? []) {
    seen.add(tid);
    contacts.push({ ...tr, evidence: newEvidence(x, tr.label, tr), history: newSamples(x, tr.label, tr.history, 120), via: 'own', assigned: classes?.get(tid) });
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
          ...tr, label: `L${i + 1}-${tr.label}`, evidence: newEvidence(x, `L${i + 1}-${tr.label}`, tr), history: newSamples(x, `L${i + 1}-${tr.label}`, tr.history, 30), via: 'datalink', assigned: classes?.get(tid),
        });
      }
    });
  } else {
    friendlies.push(...x.reports.values());
  }

  const torpedoes = (w.weapons?.torpedoes ?? [])
    .filter((t) => t.ownerId === own.id && t.wire)
    .map((t) => ({ id: t.id, x: t.pos.x, y: t.pos.y, depth: t.depth, heading: t.heading, wire: t.wire, homing: !!t.homingOn, run: t.run }));

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
    air,
    time: w.time,
    timeScale: x.timeScale ?? 1,
    crew: [own.name],
    own: {
      // Submerged boats see where they believe they are (dead reckoning), not the truth
      id: own.id, cls: own.cls, team: own.team, name: own.name, x: own.pos.x + (own.drErr?.x ?? 0), y: own.pos.y + (own.drErr?.y ?? 0),
      depth: own.depth, heading: own.heading, speedKn: own.speed / KN, order: { ...own.order },
      alive: own.alive, hp: own.hp, battery: own.battery, batteryEnduranceS: batteryEndurance(own),
      snorkel: own.snorkel, mastUp: own.mastUp, mastExt: own.mastExt, snorkelExt: own.snorkelExt, mastUpSince: x.mastUpSince, radarOn: own.radarOn,
      activeSonar: own.activeSonar, pulse: own.pulse, lastPingAt: own.lastPingAt > 0 ? own.lastPingAt : undefined, towedLength: Math.round(own.towedLength), towedOrder: own.towedOrder, vdsDepth: own.vdsDepth !== undefined ? Math.round(own.vdsDepth) : undefined, vdsOrder: own.vdsOrder, towedReady: towedArrayReady(own, w.time),
      damage: { ...(own.damage ?? emptyDamage()) }, repair: own.repair,
      crew: own.crew && { ...own.crew, performance: Math.round(crewPerformance(own) * 100) / 100 },
      air: own.air && { ...own.air }, trim: own.trim, hpAir: own.hpAir, blowing: own.blowing, buoyAntenna: own.buoyAntenna,
      navUncertainty: CLASSES[own.cls].submarine && own.lastFixAt !== undefined && !mastRaised(own) && own.depth > 0.5
        ? Math.min(14_800, 60 + (w.time - own.lastFixAt) * 0.25 * KN * (own.cls === 'ssn' ? 0.3 : 1)) : undefined,
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
        depthCharges: l?.depthCharges ?? 0, noisemakers: l?.noisemakers ?? 0, towedDecoy: l?.towedDecoy ?? false, xbt: l?.xbt ?? 0,
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
      layerDepth: own.btLayer, seaState: w.env.seaState, light: w.env.light, rain: w.env.rain, clock: w.env.weather?.clock,
      bottom: w.env.seabed ? Math.round(depthAt(w.env.seabed, own.pos.x, own.pos.y)) : undefined, seabed: w.env.seabed,
    },
    score,
  };
}
