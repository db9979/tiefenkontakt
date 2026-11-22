import { KN, bearing, distance, scatterConvoy, shipById, type AlertView, type GameEvent, type PlayerSlot, type Ship, type World } from '@tk/shared';

/** Turning simulation events into per-player alerts (what each crew can hear or is told). */

const EXPLOSION_HEARING = 40_000;
/** Hearing ranges of transients (U-Jagd: tube flooding ~8 NM, launch ~35 NM). */
const TRANSIENT_RANGE = { flood: 14_800, launch: 65_000, mishap: 9_000, blow: 25_000 } as const;
const TRANSIENT_TEXT = { flood: 'TRANSIENT · ROHR WIRD GEFLUTET', launch: 'TRANSIENT · MECHANISCHER STARTLÄRM', mishap: 'TRANSIENT · METALLISCHER SCHLAG', blow: 'TRANSIENT · TAUCHZELLEN WERDEN ANGEBLASEN' } as const;

const SIGHTING_TEXT = { mast: 'SEHROHR', snorkel: 'SCHNORCHEL', surfaced: 'U-BOOT AUFGETAUCHT' } as const;

export interface AlertContext {
  slots: PlayerSlot[];
  shipOf(playerId: string): Ship | undefined;
  aboard(shipId: string): PlayerSlot[];
  alert(playerId: string, a: AlertView): void;
}

export function alertsFor(w: World, fresh: GameEvent[], ctx: AlertContext): void {
  for (const e of fresh) {
    if (e.kind === 'grounded') {
      for (const slot of ctx.aboard(e.shipId)) ctx.alert(slot.playerId, { time: e.time, kind: 'sunk', text: 'AUF GRUND GELAUFEN · SCHÄDEN' });
    } else if (e.kind === 'torpedo_alert') {
      for (const slot of ctx.aboard(e.shipId)) {
        ctx.alert(slot.playerId, { time: e.time, kind: 'torpedo', bearing: e.bearing, text: `TORPEDO PEILUNG ${e.bearing.toFixed(0).padStart(3, '0')}` });
      }
    } else if (e.kind === 'boat') {
      for (const slot of ctx.aboard(e.shipId)) ctx.alert(slot.playerId, { time: e.time, kind: 'boat', text: e.text, what: undefined });
    } else if (e.kind === 'sighting') {
      const b = e.bearing.toFixed(0).padStart(3, '0');
      const r = (Math.round(e.range / 100) / 10).toFixed(1).replace('.', ',');
      for (const slot of ctx.aboard(e.shipId)) {
        ctx.alert(slot.playerId, { time: e.time, kind: 'sighting', bearing: e.bearing, range: e.range, what: e.what, label: e.label, text: `AUSGUCK · ${SIGHTING_TEXT[e.what]} PEILUNG ${b} · CA. ${r} KM` });
      }
    } else if (e.kind === 'sunk') {
      const victim = shipById(w, e.shipId);
      if (!victim) continue;
      if (victim.cls === 'merchant' && w.convoy) scatterConvoy(w.convoy, victim.pos, w.time);
      for (const s of ctx.slots) {
        const own = ctx.shipOf(s.playerId);
        if (!own) continue;
        if (own.id === victim.id) ctx.alert(s.playerId, { time: e.time, kind: 'sunk', text: 'SCHIFF SINKT' });
        else if (distance(own.pos, victim.pos) < EXPLOSION_HEARING) {
          const b = bearing(own.pos, victim.pos);
          ctx.alert(s.playerId, { time: e.time, kind: 'hit', bearing: b, text: `EXPLOSION / SINKGERÄUSCHE PEILUNG ${b.toFixed(0).padStart(3, '0')}` });
        }
      }
    }
  }
  for (const e of fresh) {
    if (e.kind !== 'transient') continue;
    for (const s of ctx.slots) {
      const own = ctx.shipOf(s.playerId);
      if (!own?.alive || own.id === e.sourceId) continue;
      const reach = TRANSIENT_RANGE[e.what] * (1 - 0.05 * w.env.seaState) * (own.speed / KN > 15 ? 0.5 : 1);
      if (distance(own.pos, e) > reach) continue;
      const b = (bearing(own.pos, e) + w.rng.gauss(0, 2) + 360) % 360;
      ctx.alert(s.playerId, { time: e.time, kind: 'transient', bearing: b, text: `${TRANSIENT_TEXT[e.what]} · PEILUNG ${b.toFixed(0).padStart(3, '0')}` });
    }
  }
  for (const d of w.lastDetections) {
    if (d.time !== w.time || (d.sensor !== 'intercept' && d.sensor !== 'esm')) continue;
    const kind = d.sensor === 'intercept' ? 'ping' : 'esm';
    const b = d.bearing.toFixed(0).padStart(3, '0');
    for (const slot of ctx.aboard(d.observerId)) {
      ctx.alert(slot.playerId, { time: d.time, kind, bearing: d.bearing, text: kind === 'ping' ? `AKTIVSONAR PEILUNG ${b}` : `ESM PEILUNG ${b}` });
    }
  }
}
