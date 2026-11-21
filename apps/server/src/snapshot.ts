import {
  CLASSES,
  KN,
  batteryEndurance,
  emptyDamage,
  depthAt,
  heloPosition,
  cavitationSpeedKn,
  sourceLevel,
  towedArrayReady,
  type AlertView,
  type ClassChoice,
  type World as W,
  type FriendlyView,
  type RadioMsg,
  type Ship,
  type Snapshot,
  type World,
} from '@tk/shared';

export interface PlayerExtras {
  alerts: AlertView[];
  radio: RadioMsg[];
  /** Last radio-reported positions of teammates (subs have no datalink). */
  reports: Map<string, FriendlyView>;
  mastUpSince?: number;
  timeScale?: number;
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
    speedKn: s.speed / KN, reportedAt: now, alive: s.alive,
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
  for (const [tid, tr] of w.books.get(own.id)?.entries() ?? []) {
    contacts.push({ ...tr, history: tr.history.slice(-120), via: 'own', assigned: classes?.get(tid) });
  }

  const friendlies: FriendlyView[] = [];
  if (hasDatalink(own)) {
    const mates = w.ships.filter((s) => s.team === own.team && s.id !== own.id);
    for (const m of mates) friendlies.push(friendlyOf(m, w.time));
    datalinkMates(w, own).forEach((m, i) => {
      for (const [tid, tr] of w.books.get(m.id)?.entries() ?? []) {
        contacts.push({
          ...tr, label: `L${i + 1}-${tr.label}`, history: tr.history.slice(-30), via: 'datalink', assigned: classes?.get(tid),
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
    const helos = w.air.sorties
      .map((s) => {
        const ship = w.ships.find((x) => x.id === s.shipId);
        return team.has(s.shipId) && ship ? heloPosition(s, w.time, ship) : undefined;
      })
      .filter((p): p is { x: number; y: number } => !!p);
    const mine = w.air.sorties.filter((s) => s.shipId === own.id).map((s) => s.readyAt);
    air = {
      buoys: w.air.buoys.filter((b) => team.has(b.ownerId)).map((b) => ({ id: b.id, x: b.pos.x, y: b.pos.y, depth: b.depth, leftS: b.expiresAt - w.time })),
      helos,
      stock: w.air.stock.get(own.id) ?? 0,
      heloReadyInS: Math.max(0, ...mine.map((t) => t - w.time)),
    };
  }
  return {
    air,
    time: w.time,
    timeScale: x.timeScale ?? 1,
    crew: [own.name],
    own: {
      id: own.id, cls: own.cls, team: own.team, name: own.name, x: own.pos.x, y: own.pos.y,
      depth: own.depth, heading: own.heading, speedKn: own.speed / KN, order: { ...own.order },
      alive: own.alive, hp: own.hp, battery: own.battery, batteryEnduranceS: batteryEndurance(own),
      snorkel: own.snorkel, mastUp: own.mastUp, mastUpSince: x.mastUpSince, radarOn: own.radarOn,
      activeSonar: own.activeSonar, pulse: own.pulse, lastPingAt: own.lastPingAt > 0 ? own.lastPingAt : undefined, towedLength: own.towedLength, towedReady: towedArrayReady(own, w.time),
      damage: { ...(own.damage ?? emptyDamage()) }, repair: own.repair,
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
    radio: x.radio.slice(-30),
    alerts: x.alerts.slice(-20),
    env: {
      layerDepth: own.btLayer, seaState: w.env.seaState, light: w.env.light,
      bottom: w.env.seabed ? Math.round(depthAt(w.env.seabed, own.pos.x, own.pos.y)) : undefined, seabed: w.env.seabed,
    },
    score,
  };
}
