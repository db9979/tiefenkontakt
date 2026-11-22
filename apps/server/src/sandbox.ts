import {
  CLASSES, KN, NEUTRAL_CLASSES, createLoadout, createShip, depthAt, headingVec, isConvoyShip,
  type ClassId, type SandboxClientMsg, type ServerMsg, type TruthView, type World,
} from '@tk/shared';
import type { Conn, Match } from './match.js';

/**
 * Sandbox / training mode: a god's-eye truth view, time controls (pause, 1×–10×) and spawning
 * helpers. Everything here is refused unless the match was set up as a sandbox: the truth
 * picture is never built for a normal match.
 */

export const SANDBOX_MAX_SCALE = 10;
const MAX_SPAWNED = 20;
const PUSH_MS = 500;

/** What the hub needs from the lobby (kept narrow to avoid a circular import). */
export interface SandboxHost {
  allMatches(): Match[];
  matchOf(playerId: string): Match | undefined;
  connOf(playerId: string): Conn | undefined;
}

/** The truth picture of a world. Only call for sandbox matches. */
export function truthView(w: World): TruthView {
  const r = (v: number) => Math.round(v);
  return {
    time: r(w.time),
    ships: w.ships.map((s) => ({
      id: s.id, name: s.name, cls: s.cls, team: s.team, x: r(s.pos.x), y: r(s.pos.y), heading: r(s.heading),
      speedKn: Math.round((s.speed / KN) * 10) / 10, depth: r(s.depth), alive: s.alive,
    })),
    torpedoes: (w.weapons?.torpedoes ?? []).map((t) => ({ id: t.id, ownerId: t.ownerId, x: r(t.pos.x), y: r(t.pos.y) })),
  };
}

export class SandboxHub {
  /** Players per match who switched the truth view on. */
  private truth = new Map<string, Set<string>>();
  private spawned = new Map<string, number>();
  private timer?: ReturnType<typeof setInterval>;

  constructor(private host: SandboxHost) {}

  start(): void {
    this.timer ??= setInterval(() => this.push(), PUSH_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Send every player of a running sandbox the time scale, and the truth to those who asked. */
  push(): void {
    for (const m of this.host.allMatches()) {
      if (!m.settings.sandbox || m.state !== 'running' || !m.world) {
        this.truth.delete(m.id);
        continue;
      }
      const on = this.truth.get(m.id);
      let view: TruthView | undefined;
      for (const s of m.slots) {
        if (s.bot || this.host.matchOf(s.playerId) !== m) continue;
        const c = this.host.connOf(s.playerId);
        if (!c) continue;
        const msg: ServerMsg = { t: 'sandbox', scale: m.settings.timeScale };
        if (on?.has(s.playerId)) msg.truth = view ??= truthView(m.world);
        c.send(msg);
      }
    }
  }

  /** A sandbox command from a player in match m. Returns an error text. */
  handle(conn: Conn, m: Match, msg: SandboxClientMsg): string | undefined {
    if (!m.settings.sandbox) return 'Nur im Sandkasten (Übungsmodus) möglich';
    const w = m.world;
    if (m.state !== 'running' || !w) return 'Sandkasten läuft noch nicht';
    switch (msg.op) {
      case 'truth': {
        const set = this.truth.get(m.id) ?? new Set<string>();
        if (msg.on) set.add(conn.playerId);
        else set.delete(conn.playerId);
        this.truth.set(m.id, set);
        this.push();
        return undefined;
      }
      case 'speed': {
        const n = Math.round(msg.scale ?? 1);
        if (!(n >= 0 && n <= SANDBOX_MAX_SCALE)) return 'Zeitraffer 0–10';
        m.setTimeScale(n);
        this.push();
        return undefined;
      }
      case 'spawn':
        return this.spawn(conn, m, w, msg);
      case 'steer': {
        const s = w.ships.find((x) => x.id === msg.id);
        if (!s || !s.alive) return 'Einheit nicht gefunden';
        if (s.playerId && !s.playerId.startsWith('bot-')) return 'Spielerschiffe steuern ihre Kapitäne';
        if (isConvoyShip(s)) return 'Konvoifrachter folgen dem Geleit';
        const spec = CLASSES[s.cls];
        if (msg.heading !== undefined) s.order.heading = ((msg.heading % 360) + 360) % 360;
        if (msg.speedKn !== undefined) s.order.speedKn = Math.max(0, Math.min(spec.maxSpeedKn, msg.speedKn));
        if (msg.depth !== undefined && spec.submarine) s.order.depth = Math.min(spec.maxDepth, msg.depth);
        return undefined;
      }
      case 'remove': {
        const i = w.ships.findIndex((x) => x.id === msg.id);
        if (i < 0 || w.ships[i]!.playerId) return 'Nur Ziele ohne Kapitän lassen sich entfernen';
        w.weapons?.loadouts.delete(w.ships[i]!.id);
        w.ships.splice(i, 1);
        return undefined;
      }
    }
  }

  private spawn(conn: Conn, m: Match, w: World, msg: SandboxClientMsg): string | undefined {
    const own = m.shipOf(conn.playerId);
    const cls = msg.cls as ClassId | undefined;
    if (!own || !cls || !CLASSES[cls]) return 'Klasse fehlt';
    const n = (this.spawned.get(m.id) ?? 0) + 1;
    if (n > MAX_SPAWNED) return `Höchstens ${MAX_SPAWNED} Ziele im Sandkasten`;
    this.spawned.set(m.id, n);
    const v = headingVec(msg.bearing ?? 0);
    const range = msg.range ?? 5000;
    const pos = { x: own.pos.x + v.x * range, y: own.pos.y + v.y * range };
    const spec = CLASSES[cls];
    const neutral = (NEUTRAL_CLASSES as readonly string[]).includes(cls);
    const enemy = own.team === 'west' ? 'east' : 'west';
    // Spawned merchants sail on their own (neutral), not in the convoy formation
    const team = neutral || cls === 'merchant' ? 'neutral' : enemy;
    const bottom = w.env.seabed ? depthAt(w.env.seabed, pos.x, pos.y) : 3000;
    const depth = spec.submarine ? Math.max(18, Math.min(msg.depth ?? 60, spec.maxDepth, bottom - 25)) : undefined;
    const ship = createShip({
      id: `sb${n}`, cls, team, name: `Ziel ${n} (${spec.name})`, pos, heading: msg.heading ?? 0,
      speedKn: Math.min(spec.maxSpeedKn, msg.speedKn ?? 6), depth,
    });
    w.ships.push(ship);
    w.weapons?.loadouts.set(ship.id, createLoadout(cls));
    return undefined;
  }
}
