import {
  CLASSES,
  bearing,
  distance,
  fireTorpedo,
  headingVec,
  launchAswRocket,
  launchNoisemaker,
  PERISCOPE_DEPTH,
  rankClasses,
  type ContactTrack,
  setTowedDecoy,
  wrap360,
  type Ship,
  type World,
} from '@tk/shared';

/**
 * Simple AI captains for empty teams. Fair play: they act only on their own
 * contact book and on their own team's datalink positions, never on enemy truth.
 */
export interface BotState {
  shipId: string;
  nextThink: number;
  lastShot: number;
  evadeUntil: number;
  alertUntil: number;
  legSign: number;
  legUntil: number;
  eventCursor: number;
  /** Periscope look: raise the mast until this time; next look not before peekAgain. */
  peekUntil: number;
  peekAgain: number;
  /** Training target: moves and evades but never attacks. */
  passive?: boolean;
}

const THINK_EVERY = 2; // sim s

/** The bot classifies like a player would: marks from the evidence, graded by the class library. */
function botClassify(t: ContactTrack): string | undefined {
  const ev = t.evidence;
  if (!ev) return undefined;
  const strongest = [...ev.tonals].sort((a, b) => b.snr - a.snr)[0];
  return rankClasses({ tonalHz: strongest?.hz, shaftHz: ev.shaftHz, bladeHz: ev.bladeHz })[0]?.sig.choice;
}
const SUB_SHOT_COOLDOWN = 150;
const FFG_ROCKET_COOLDOWN = 90;

export class BotCrew {
  private bots: BotState[] = [];

  add(shipId: string, passive = false): void {
    this.bots.push({ shipId, passive, nextThink: 0, lastShot: -1e9, evadeUntil: 0, alertUntil: 0, legSign: 1, legUntil: 0, eventCursor: 0, peekUntil: 0, peekAgain: 0 });
  }

  get size(): number {
    return this.bots.length;
  }

  toJSON(): BotState[] {
    return this.bots.map((b) => ({ ...b }));
  }

  restore(states: BotState[]): void {
    this.bots = states.map((b) => ({ ...b }));
  }

  step(w: World): void {
    for (const b of this.bots) {
      const ship = w.ships.find((s) => s.id === b.shipId);
      if (!ship?.alive) continue;
      this.readEvents(w, b, ship);
      if (w.time < b.nextThink) continue;
      b.nextThink = w.time + THINK_EVERY;
      if (CLASSES[ship.cls].submarine) this.thinkSub(w, b, ship);
      else this.thinkFrigate(w, b, ship);
    }
  }

  private readEvents(w: World, b: BotState, ship: Ship): void {
    const fresh = w.events.slice(b.eventCursor);
    b.eventCursor = w.events.length;
    for (const e of fresh) {
      if (e.kind === 'torpedo_alert' && e.shipId === ship.id) {
        b.evadeUntil = w.time + 90;
        if (CLASSES[ship.cls].submarine) launchNoisemaker(w, ship);
        else setTowedDecoy(w, ship, true);
        ship.order.heading = wrap360(e.bearing + 100 * b.legSign);
        ship.order.speedKn = CLASSES[ship.cls].maxSpeedKn;
        if (CLASSES[ship.cls].submarine) ship.order.depth = (ship.btLayer ?? 120) + 60;
      } else if (e.kind === 'sunk' || e.kind === 'transient') {
        b.alertUntil = w.time + 600;
      }
    }
  }

  private thinkSub(w: World, b: BotState, s: Ship): void {
    if (w.time < b.evadeUntil) return;
    if (b.passive) {
      // Training target: slow legs at moderate depth, no attacks
      if (w.time > b.legUntil) {
        b.legSign = -b.legSign;
        b.legUntil = w.time + 300;
        s.order = { heading: wrap360(250 + 35 * b.legSign), speedKn: 5, depth: 60 };
      }
      return;
    }
    if (w.time >= b.evadeUntil && b.evadeUntil > 0) {
      b.evadeUntil = 0;
      s.order.speedKn = 4;
    }
    const tracks = w.books.get(s.id)?.tracks() ?? [];
    const pinged = tracks.some((t) => t.sensors.includes('intercept') && w.time - t.lastSeen < 120);
    // Prefer merchants; take on a warship only when it is close (loud)
    const fresh = tracks.filter((t) => w.time - t.lastSeen < 10 && t.sensors.some((x) => x === 'hull' || x === 'towed'));
    const merchants = fresh.filter((t) => botClassify(t) === 'merchant').sort((a, c) => c.se - a.se);
    const threats = fresh.filter((t) => botClassify(t) === 'warship' && t.se > 20);
    const target = merchants[0] ?? threats[0];
    const peeking = w.time < b.peekUntil;
    s.order.depth = peeking ? PERISCOPE_DEPTH : pinged ? (s.btLayer ?? 150) + 30 : 60;
    if (peeking && s.depth <= PERISCOPE_DEPTH + 0.5) s.mastUp = true;
    if (!peeking) s.mastUp = false;
    if (!target) {
      s.order.speedKn = 4;
      return;
    }
    // Close the target with a lead angle; slow when close to stay quiet
    s.order.heading = wrap360(target.bearing + 15 * b.legSign);
    s.order.speedKn = target.se > 12 ? 3 : 6;
    if (w.time > b.legUntil) {
      b.legSign = -b.legSign;
      b.legUntil = w.time + 240;
    }
    // Needs a range before shooting: take a short periscope look now and then (not while hunted)
    const rangeFresh = target.range !== undefined && target.rangeAt !== undefined && w.time - target.rangeAt < 120;
    if (!rangeFresh && !pinged && target.se > 6 && w.time > b.peekAgain) {
      b.peekUntil = w.time + 60;
      b.peekAgain = w.time + 420;
    }
    const close = rangeFresh && target.range! < 7000;
    if (close && w.time - b.lastShot > SUB_SHOT_COOLDOWN) {
      const r = fireTorpedo(w, s, { heading: target.bearing, enableAfter: 1500, mode: 'passive', searchDepth: 15 });
      if (typeof r !== 'string') b.lastShot = w.time;
    }
  }

  private thinkFrigate(w: World, b: BotState, s: Ship): void {
    if (w.time < b.evadeUntil) return;
    if (b.evadeUntil > 0 && w.time >= b.evadeUntil) {
      b.evadeUntil = 0;
      setTowedDecoy(w, s, false);
    }
    if (s.towedLength === 0) s.towedLength = 600;
    // Screen ahead of the convoy (own team's positions are known over datalink)
    const merchants = w.ships.filter((m) => m.team === s.team && m.cls === 'merchant' && m.alive);
    if (merchants.length) {
      const cx = merchants.reduce((a, m) => a + m.pos.x, 0) / merchants.length;
      const cy = merchants.reduce((a, m) => a + m.pos.y, 0) / merchants.length;
      const ahead = w.convoy ? headingVec(w.convoy.guideHeading) : { x: 0, y: 1 };
      const station = { x: cx + ahead.x * 3500, y: cy + ahead.y * 3500 };
      const toStation = bearing(s.pos, station);
      if (w.time > b.legUntil) {
        b.legSign = -b.legSign;
        b.legUntil = w.time + 180;
      }
      s.order.heading = distance(s.pos, station) > 2500 ? toStation : wrap360(toStation + 50 * b.legSign);
      s.order.speedKn = distance(s.pos, station) > 4000 ? 18 : 12;
    }
    // Ping in bursts (3 of every 10 min), continuously after an alarm
    s.activeSonar = w.time < b.alertUntil || w.time % 600 < 180;
    if (w.time - b.lastShot < FFG_ROCKET_COOLDOWN) return;
    const friends = w.ships.filter((f) => f.team === s.team && f.alive);
    for (const t of w.books.get(s.id)?.tracks() ?? []) {
      if (t.range === undefined || t.rangeAt === undefined || w.time - t.rangeAt > 30 || !t.sensors.includes('active')) continue;
      const v = headingVec(t.bearing);
      const p = { x: s.pos.x + v.x * t.range, y: s.pos.y + v.y * t.range };
      if (friends.some((f) => distance(f.pos, p) < 1200)) continue;
      if (launchAswRocket(w, s, p) === true) {
        b.lastShot = w.time;
        return;
      }
    }
  }
}
