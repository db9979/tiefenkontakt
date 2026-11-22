import { CLASSES, KN, NM, type Debrief, type Habits, type PlayerSlot, type PlayerStats, type World } from '@tk/shared';
import type { MatchResult } from './rules.js';

const FRAME_EVERY = 15; // sim s

export interface RecorderState {
  frames: Debrief['frames'];
  torpedoes: Debrief['torpedoes'];
  lastFrame: number;
  distance: Record<string, number>;
  lastPos: Record<string, [number, number]>;
  /** Habit samples per player ship: n samples, and counts at PD / above layer / fast / pinging. */
  habits?: Record<string, [number, number, number, number, number]>;
}

function habitsOf(h?: [number, number, number, number, number]): Habits | undefined {
  if (!h || h[0] < 4) return undefined;
  const f = (i: number) => Math.round((h[i]! / h[0]) * 100) / 100;
  return { pd: f(1), above: f(2), fast: f(3), ping: f(4) };
}

/** Records ground truth during the match; it is only revealed in the debrief after the end. */
export class Recorder {
  s: RecorderState = { frames: [], torpedoes: [], lastFrame: -1e9, distance: {}, lastPos: {} };

  step(w: World): void {
    if (w.time - this.s.lastFrame < FRAME_EVERY) return;
    this.s.lastFrame = w.time;
    const r = (v: number) => Math.round(v);
    this.s.frames.push([r(w.time), w.ships.map((x) => [x.id, r(x.pos.x), r(x.pos.y), r(x.heading), x.alive ? 1 : 0])]);
    this.s.torpedoes.push([r(w.time), (w.weapons?.torpedoes ?? []).map((t) => [t.id, r(t.pos.x), r(t.pos.y)])]);
    for (const x of w.ships) {
      const prev = this.s.lastPos[x.id];
      if (prev) this.s.distance[x.id] = (this.s.distance[x.id] ?? 0) + Math.hypot(x.pos.x - prev[0], x.pos.y - prev[1]);
      this.s.lastPos[x.id] = [x.pos.x, x.pos.y];
      if (!x.alive || !x.id.startsWith('p_') || x.id.startsWith('p_bot-')) continue;
      const h = ((this.s.habits ??= {})[x.id] ??= [0, 0, 0, 0, 0]);
      const sub = CLASSES[x.cls].submarine;
      h[0]++;
      if (sub && x.depth <= 20) h[1]++;
      if (sub && w.env.layerDepth > 0 && x.depth < w.env.layerDepth) h[2]++;
      if (x.speed / KN > 12) h[3]++;
      if (x.activeSonar) h[4]++;
    }
  }

  debrief(w: World, slots: PlayerSlot[], result: MatchResult): Debrief {
    const events: Debrief['events'] = [];
    for (const e of w.events) {
      if (e.kind === 'sunk') events.push({ t: Math.round(e.time), kind: 'sunk', shipId: e.shipId, byId: e.byId });
      else if (e.kind === 'arrived') events.push({ t: Math.round(e.time), kind: 'arrived', shipId: e.shipId });
      else if (e.kind === 'weapon') events.push({ t: Math.round(e.time), kind: 'shot', shipId: e.sourceId, what: e.what });
    }
    const stats: PlayerStats[] = slots.map((p) => {
      const shipId = `p_${p.crewOf ?? p.playerId}`;
      const ship = w.ships.find((x) => x.id === shipId);
      const mine = (what: string) => events.filter((e) => e.kind === 'shot' && e.shipId === shipId && e.what === what).length;
      const kills = events.filter((e) => e.kind === 'sunk' && e.byId === shipId);
      const enemyIds = new Set(w.ships.filter((x) => ship && x.team !== ship.team).map((x) => x.id));
      const book = w.books.get(shipId);
      const first = book?.entries().filter(([id]) => enemyIds.has(id)).map(([, tr]) => tr.firstSeen);
      return {
        playerId: p.playerId,
        callsign: p.callsign,
        team: p.team,
        cls: p.cls,
        survived: !!ship?.alive,
        shots: mine('torpedo'),
        rockets: mine('rocket'),
        buoys: mine('buoy'),
        kills: kills.length,
        tonnageSunk: kills.reduce((a, e) => a + CLASSES[w.ships.find((x) => x.id === e.shipId)?.cls ?? 'merchant'].tonnage, 0),
        firstContactS: first && first.length ? Math.round(Math.min(...first)) : undefined,
        distanceNm: Math.round(((this.s.distance[shipId] ?? 0) / NM) * 10) / 10,
        won: p.team === result.winner,
        habits: habitsOf(this.s.habits?.[shipId]),
      };
    });
    return {
      ships: w.ships.map((x) => ({ id: x.id, name: x.name, cls: x.cls, team: x.team, player: x.id.startsWith('p_') })),
      frames: this.s.frames,
      torpedoes: this.s.torpedoes,
      events,
      stats,
      winner: result.winner,
      reason: result.reason,
      duration: Math.round(w.time),
    };
  }
}
