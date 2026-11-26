import { FAST_FORWARD_SCALE, angleDiff, trueDeg3, type AlertView, type FastForwardView, type Ship, type World } from '@tk/shared';

/**
 * "Zeitraffer bis Ereignis": the sim runs at 6× until something happens that a captain must
 * see: a new contact, an alarm (torpedo, ping, hit, sighting, radar warning, crew report) or a
 * finished tutorial step. In a solo game (one human aboard anything) it is one button; with
 * several humans every captain and crew member afloat must vote for it, and nobody may hold a
 * hostile contact from the last minute. Any stop clears the votes.
 */

/** A hostile track seen this recently blocks a multiplayer fast-forward. */
export const FRESH_CONTACT_S = 60;
/** Per tick the fast-forward may spend at most this long stepping (ms); the rest of the 100 ms is for snapshots and other matches. */
export const FF_TICK_BUDGET_MS = 45;
/** A stop reason stays in the top bar this long (sim seconds). */
const STOPPED_SHOW_S = 30;

/**
 * A ping or radar intercept within this many degrees of one heard in the last KNOWN_SOURCE_S
 * comes from a source already known (an escort pinging every 30 s): it does not stop the
 * fast-forward again (S29). The first ping of a new source does.
 */
export const SAME_SOURCE_DEG = 12;
export const KNOWN_SOURCE_S = 300;

/** Alerts that stop it: everything but routine traffic from command. */
const STOP_ALERT: Partial<Record<AlertView['kind'], string>> = {
  torpedo: 'Torpedoalarm', ping: 'Ortungsimpuls', hit: 'Treffer', sunk: 'Schiff gesunken', esm: 'Radarwarnung',
  sighting: 'Sichtung', boat: 'Meldung aus dem Boot', transient: 'Geräusch', splash: 'Aufschlag', flash: 'FLASH-Befehl',
};

export interface FastForwardHost {
  /** Players who decide: humans with a ship afloat (own or as crew). */
  voters(): string[];
  shipOf(playerId: string): Ship | undefined;
  world(): World | undefined;
}

export class FastForward {
  on = false;
  private votes = new Set<string>();
  /** Contacts each human-manned ship already holds (target ids): a new one stops the fast-forward. */
  private known = new Map<string, Set<string>>();
  private stopped?: { why: string; at: number };
  /** Pings and radar intercepts each player heard lately (repeats from a known source don't stop it). */
  private heard = new Map<string, { kind: AlertView['kind']; b: number; emitter?: string; t: number }[]>();

  constructor(private host: FastForwardHost) {}

  /** Sim steps for this tick: the lobby's scale, or 6× while running. */
  scale(base: number): number {
    return this.on ? FAST_FORWARD_SCALE : base;
  }

  /** A player switches it on (solo) or votes (multiplayer), or off. Returns an error text. */
  request(playerId: string, on: boolean): string | undefined {
    const w = this.host.world();
    if (!w) return 'Keine laufende Partie';
    const voters = this.host.voters();
    if (!on) {
      this.votes.delete(playerId);
      // A manual stop needs no reason in the top bar (N6): it clears any old one too
      if (this.on) this.stop('', w.time);
      this.stopped = undefined;
      return undefined;
    }
    if (!voters.includes(playerId)) return 'Zeitraffer nur mit eigenem Schiff';
    if (voters.length > 1) {
      const fresh = this.freshHostile(w, voters);
      if (fresh) return `Kein Zeitraffer: ${fresh} hat frischen Feindkontakt`;
    }
    this.votes.add(playerId);
    if (voters.every((id) => this.votes.has(id))) {
      this.remember(w, voters);
      this.on = true;
      this.stopped = undefined;
    }
    return undefined;
  }

  /** After the tick's steps: stop on a new contact, a new voter or (multiplayer) a fresh hostile contact. */
  check(): void {
    const w = this.host.world();
    if (!w) return;
    const voters = this.host.voters();
    if (this.on) {
      const fresh = this.newContact(w, voters);
      if (fresh) this.stop(fresh, w.time);
      else if (!voters.every((id) => this.votes.has(id))) this.stop('Neuer Mitspieler an Bord', w.time);
      else if (voters.length === 0) this.stop('Kein eigenes Schiff mehr', w.time);
    }
    this.remember(w, voters);
  }

  /**
   * An alert for a player: alarms stop it, with the reason and bearing for the top bar
   * ("Ortungsimpuls 087°"). Pings and radar intercepts from a source already heard don't.
   */
  alert(playerId: string, a: AlertView['kind'] | Pick<AlertView, 'kind' | 'bearing' | 'emitter'>, time: number): void {
    const al = typeof a === 'string' ? { kind: a } : a;
    const why = STOP_ALERT[al.kind];
    if (!why) return;
    const repeat = (al.kind === 'ping' || al.kind === 'esm') && al.bearing !== undefined && this.knownSource(playerId, al.kind, al.bearing, al.emitter, time);
    if (!this.on || repeat || !this.host.voters().includes(playerId)) return;
    const w = this.host.world();
    this.stop(al.bearing !== undefined && w ? `${why} ${trueDeg3(w, al.bearing)}°` : why, time);
  }

  /** Note a ping or intercept; true when the same source (bearing, radar) was heard lately. */
  private knownSource(playerId: string, kind: AlertView['kind'], b: number, emitter: string | undefined, t: number): boolean {
    const list = (this.heard.get(playerId) ?? []).filter((h) => t - h.t >= 0 && t - h.t < KNOWN_SOURCE_S);
    const known = list.some((h) => h.kind === kind && h.emitter === emitter && Math.abs(angleDiff(h.b, b)) <= SAME_SOURCE_DEG);
    list.push({ kind, b, emitter, t });
    this.heard.set(playerId, list);
    return known;
  }

  /** The tutorial ticked off a step. */
  lessonStep(time: number): void {
    if (this.on) this.stop('Ausbildungsschritt erledigt', time);
  }

  stop(why: string, time: number): void {
    this.on = false;
    this.votes.clear();
    this.stopped = { why, at: time };
  }

  view(playerId: string): FastForwardView {
    const w = this.host.world();
    const voters = this.host.voters();
    const time = w?.time ?? 0;
    const blocked = !this.on && voters.length > 1 && w ? this.freshHostile(w, voters) : undefined;
    return {
      on: this.on, votes: [...this.votes].filter((id) => voters.includes(id)).length, need: voters.length, mine: this.votes.has(playerId),
      blocked: blocked ? `FRISCHER FEINDKONTAKT (${blocked})` : undefined,
      stopped: this.stopped && time - this.stopped.at < STOPPED_SHOW_S ? this.stopped.why : undefined,
    };
  }

  private hostile(w: World, own: Ship, tid: string): boolean {
    const t = w.ships.find((s) => s.id === tid);
    return !t || (t.team !== own.team && t.team !== 'neutral');
  }

  /** Name of a ship whose book holds a hostile track seen within the last minute. */
  private freshHostile(w: World, voters: string[]): string | undefined {
    for (const id of voters) {
      const s = this.host.shipOf(id);
      if (!s?.alive) continue;
      const fresh = w.books.get(s.id)?.entries().some(([tid, tr]) => w.time - tr.lastSeen < FRESH_CONTACT_S && this.hostile(w, s, tid));
      if (fresh) return s.name;
    }
    return undefined;
  }

  private newContact(w: World, voters: string[]): string | undefined {
    for (const id of voters) {
      const s = this.host.shipOf(id);
      const seen = s && this.known.get(s.id);
      if (!s || !seen) continue;
      for (const [tid] of w.books.get(s.id)?.entries() ?? []) {
        const t = w.ships.find((x) => x.id === tid);
        if (!seen.has(tid) && t?.team !== s.team) return 'Neuer Kontakt';
      }
    }
    return undefined;
  }

  private remember(w: World, voters: string[]): void {
    for (const id of voters) {
      const s = this.host.shipOf(id);
      if (!s) continue;
      const set = this.known.get(s.id) ?? new Set<string>();
      for (const [tid] of w.books.get(s.id)?.entries() ?? []) set.add(tid);
      this.known.set(s.id, set);
    }
  }
}
