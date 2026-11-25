import { CLASSES, KN, NM, mastExposed, orderResults, type ClassId, type Debrief, type PhotoRecord, type Habits, type PlayerSlot, type PlayerStats, type World } from '@tk/shared';
import type { MatchResult } from './rules.js';
import { classGroupKey } from './snapshot.js';
import { emptySamples, gradeFigures, sampleContacts, type ContactSamples } from './debrief-grade.js';

const FRAME_EVERY = 15; // sim s

export interface RecorderState {
  frames: Debrief['frames'];
  torpedoes: Debrief['torpedoes'];
  lastFrame: number;
  distance: Record<string, number>;
  lastPos: Record<string, [number, number]>;
  /** Habit samples per player ship: n samples, and counts at PD / above layer / fast / pinging. */
  habits?: Record<string, [number, number, number, number, number]>;
  /** Periscope and bridge photos, graded when taken. */
  photos?: PhotoRecord[];
  /** Since when each submarine's mast (or snorkel) has been showing (sim s). */
  mastSince?: Record<string, number>;
  /** Exact classes assigned from the recognition book, per classification group and target id. */
  ident?: Record<string, Record<string, ClassId>>;
  /** Contacts held and being held, for the debrief grade (debrief-grade.ts). */
  contacts?: ContactSamples;
}

function habitsOf(h?: [number, number, number, number, number]): Habits | undefined {
  if (!h || h[0] < 4) return undefined;
  const f = (i: number) => Math.round((h[i]! / h[0]) * 100) / 100;
  return { pd: f(1), above: f(2), fast: f(3), ping: f(4) };
}

/** Mine kills (victim had one of our mines go off under it) and torpedo attacks lived through. */
export function feats(w: World, shipId: string, kills: { t: number; shipId: string }[], alive: boolean): Pick<PlayerStats, 'mineKills' | 'attacksSurvived'> {
  let mineKills = 0;
  for (const k of kills) {
    if (w.events.some((e) => e.kind === 'mine' && e.what === 'detonated' && e.shipId === k.shipId && Math.round(e.time) <= k.t)) mineKills++;
  }
  const attacks = alive ? w.events.filter((e) => e.kind === 'torpedo_alert' && e.shipId === shipId).length : 0;
  return { mineKills: mineKills || undefined, attacksSurvived: attacks || undefined };
}

/** Records ground truth during the match; it is only revealed in the debrief after the end. */
export class Recorder {
  s: RecorderState = { frames: [], torpedoes: [], lastFrame: -1e9, distance: {}, lastPos: {} };

  step(w: World): void {
    const ms = (this.s.mastSince ??= {});
    for (const x of w.ships) {
      if (!CLASSES[x.cls].submarine) continue;
      if (x.alive && mastExposed(x)) ms[x.id] ??= w.time;
      else delete ms[x.id];
    }
    if (w.time - this.s.lastFrame < FRAME_EVERY) return;
    this.s.lastFrame = w.time;
    sampleContacts(w, (this.s.contacts ??= emptySamples()), FRAME_EVERY);
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

  /** Remember (or clear) the exact class a group assigned to a target from the recognition book. */
  ident(group: string, targetId: string, cls?: ClassId): void {
    const g = ((this.s.ident ??= {})[group] ??= {});
    if (cls) g[targetId] = cls;
    else delete g[targetId];
  }

  debrief(w: World, slots: PlayerSlot[], result: MatchResult): Debrief {
    const events: Debrief['events'] = [];
    for (const e of w.events) {
      if (e.kind === 'sunk') events.push({ t: Math.round(e.time), kind: 'sunk', shipId: e.shipId, byId: e.byId });
      else if (e.kind === 'arrived') events.push({ t: Math.round(e.time), kind: 'arrived', shipId: e.shipId });
      else if (e.kind === 'weapon') events.push({ t: Math.round(e.time), kind: 'shot', shipId: e.sourceId, what: e.what });
    }
    const orders = orderResults(w);
    const stats: PlayerStats[] = slots.map((p) => {
      // A player who went aboard a teammate after sinking keeps the own ship's figures
      const shipId = `p_${p.transferred ? p.playerId : p.crewOf ?? p.playerId}`;
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
        orderPoints: orders.list.some((o) => o.team === p.team) ? orders.points[p.team] : undefined,
        ...feats(w, shipId, kills, !!ship?.alive),
        ...gradeFigures(w, this.s.contacts, shipId, ship ? this.s.ident?.[classGroupKey(ship)] : undefined),
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
      band: result.band,
      duration: Math.round(w.time),
      region: w.env.seabed?.region,
      orders: orders.list.length ? orders.list : undefined,
      photos: this.s.photos?.length ? this.s.photos : undefined,
    };
  }
}
