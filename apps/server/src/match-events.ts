import {
  CLASSES,
  canCopy,
  mastRaised,
  KN,
  bearing,
  distance,
  scatterConvoy,
  shipById,
  type AlertView,
  type GameEvent,
  type PlayerSlot,
  type RadioMsg,
  type Ship,
  type World,
  isConvoyShip,
  trueDeg3,
  esmDangerText,
  esmIntercept,
} from '@tk/shared';

import { airdefAlerts } from './airdef-events.js';
import type { PlayerExtras } from './snapshot.js';

/** Turning simulation events into per-player alerts (what each crew can hear or is told). */

const EXPLOSION_HEARING = 40_000;
/** Hearing ranges of transients (U-Jagd: tube flooding ~8 NM, launch ~35 NM). */
const TRANSIENT_RANGE = { flood: 14_800, launch: 65_000, mishap: 9_000, blow: 25_000, splash: 7_400, sam: 20_000, mine: 40_000, sounding: 4_000, charge: 30_000 } as const;
const TRANSIENT_TEXT = { flood: 'TRANSIENT · ROHR WIRD GEFLUTET', launch: 'TRANSIENT · MECHANISCHER STARTLÄRM', mishap: 'TRANSIENT · METALLISCHER SCHLAG', blow: 'TRANSIENT · TAUCHZELLEN WERDEN ANGEBLASEN', splash: 'TRANSIENT · BOJENEINSCHLAG', sam: 'TRANSIENT · RAKETENSTART ÜBER WASSER', mine: 'TRANSIENT · UNTERWASSERDETONATION', sounding: 'TRANSIENT · ECHOLOTIMPULS (U-BOOT LOTET)', charge: 'TRANSIENT · WASSERBOMBENDETONATION' } as const;

const SIGHTING_TEXT = { mast: 'SEHROHR', snorkel: 'SCHNORCHEL', surfaced: 'U-BOOT AUFGETAUCHT', glow: 'LEUCHTSPUR IM WASSER' } as const;

/** When each surface ship was last reported hit (to tell sinking noises from a new detonation). */
const lastHit = new WeakMap<Ship, number>();

export interface AlertContext {
  slots: PlayerSlot[];
  shipOf(playerId: string): Ship | undefined;
  aboard(shipId: string): PlayerSlot[];
  alert(playerId: string, a: AlertView): void;
  /** Team radio line for a player (AI escorts announcing their roles). */
  radio?(playerId: string, r: RadioMsg): void;
}

/** Add an alert to a player's capped list (counting what falls off the front, for the deltas). */
export function pushAlert(x: PlayerExtras | undefined, a: AlertView): void {
  if (!x) return;
  x.alerts.push(a);
  if (x.alerts.length > 40) {
    x.alerts.shift();
    x.alertsDropped = (x.alertsDropped ?? 0) + 1;
  }
}

export function alertsFor(w: World, fresh: GameEvent[], ctx: AlertContext): void {
  airdefAlerts(w, fresh, ctx);
  for (const e of fresh) {
    if (e.kind === 'grounded') {
      for (const slot of ctx.aboard(e.shipId)) ctx.alert(slot.playerId, { time: e.time, kind: 'sunk', text: 'AUF GRUND GELAUFEN · SCHÄDEN' });
    } else if (e.kind === 'torpedo_alert') {
      for (const slot of ctx.aboard(e.shipId)) {
        ctx.alert(slot.playerId, { time: e.time, kind: 'torpedo', bearing: e.bearing, text: `TORPEDO PEILUNG ${trueDeg3(w, e.bearing)}°` });
      }
    } else if (e.kind === 'boat') {
      const kind = e.what === 'command' ? 'command' : 'boat';
      for (const slot of ctx.aboard(e.shipId)) ctx.alert(slot.playerId, { time: e.time, kind, text: e.text });
    } else if (e.kind === 'flash') {
      // FLASH orders read aboard (priority) and fleet command's verdict on them
      for (const slot of ctx.aboard(e.shipId)) ctx.alert(slot.playerId, { time: e.time, kind: e.status ? 'command' : 'flash', text: e.text });
    } else if (e.kind === 'teamradio') {
      const from = shipById(w, e.senderId);
      if (!from) continue;
      for (const s of ctx.slots) if (s.team === from.team) ctx.radio?.(s.playerId, { time: e.time, from: from.name, text: e.text });
    } else if (e.kind === 'sighting') {
      const b = trueDeg3(w, e.bearing);
      const r = (Math.round(e.range / 100) / 10).toFixed(1).replace('.', ',');
      for (const slot of ctx.aboard(e.shipId)) {
        ctx.alert(slot.playerId, { time: e.time, kind: 'sighting', bearing: e.bearing, range: e.range, what: e.what, label: e.label, text: `AUSGUCK · ${SIGHTING_TEXT[e.what]} PEILUNG ${b}° · CA. ${r} KM` });
      }
    } else if (e.kind === 'hit') {
      // A warhead on a surface ship: a detonation everyone around hears and lookouts may see
      const victim = shipById(w, e.shipId);
      if (!victim?.alive || (CLASSES[victim.cls].submarine && victim.depth > 1)) continue;
      lastHit.set(victim, e.time);
      for (const s of ctx.slots) {
        const own = ctx.shipOf(s.playerId);
        if (!own || own.id === victim.id || distance(own.pos, e) > EXPLOSION_HEARING) continue;
        const b = bearing(own.pos, e);
        ctx.alert(s.playerId, { time: e.time, kind: 'hit', bearing: b, text: `EXPLOSION PEILUNG ${trueDeg3(w, b)}°` });
      }
    } else if (e.kind === 'sunk') {
      const victim = shipById(w, e.shipId);
      if (!victim) continue;
      // Already reported hit: now only her sinking noises (no new detonation in the picture)
      const sink = e.time - (lastHit.get(victim) ?? -1e9) < 1200 && e.time - (lastHit.get(victim) ?? 0) > 1 ? true : undefined;
      if (isConvoyShip(victim) && w.convoy) scatterConvoy(w.convoy, victim.pos, w.time);
      for (const s of ctx.slots) {
        const own = ctx.shipOf(s.playerId);
        if (!own) continue;
        if (own.id === victim.id) ctx.alert(s.playerId, { time: e.time, kind: 'sunk', text: 'SCHIFF SINKT' });
        else if (distance(own.pos, victim.pos) < EXPLOSION_HEARING) {
          const b = bearing(own.pos, victim.pos);
          ctx.alert(s.playerId, { time: e.time, kind: 'hit', bearing: b, sink, text: `${sink ? 'SINKGERÄUSCHE' : 'EXPLOSION / SINKGERÄUSCHE'} PEILUNG ${trueDeg3(w, b)}°` });
        }
      }
    }
  }
  // Air reconnaissance: fleet command passes the convoy report to boats that can copy it now
  for (const e of fresh) {
    if (e.kind !== 'recon') continue;
    for (const s of ctx.slots) {
      const own = ctx.shipOf(s.playerId);
      if (!own?.alive || own.team !== 'east' || !CLASSES[own.cls].submarine || !(canCopy(own) || mastRaised(own) || own.depth <= 0.5)) continue;
      const b = bearing(own.pos, e);
      const km = Math.round(distance(own.pos, e) / 1000);
      ctx.alert(s.playerId, { time: e.time, kind: 'command', bearing: b, text: `FÜHRUNG · LUFTAUFKLÄRUNG: KONVOI PEILUNG ${trueDeg3(w, b)}° · CA. ${km} KM · KURS ${trueDeg3(w, e.course)}° · ${e.speedKn} KN` });
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
      ctx.alert(s.playerId, { time: e.time, kind: 'transient', bearing: b, text: `${TRANSIENT_TEXT[e.what]} · PEILUNG ${trueDeg3(w, b)}°` });
    }
  }
  for (const d of w.lastDetections) {
    if (d.time !== w.time || (d.sensor !== 'intercept' && d.sensor !== 'esm')) continue;
    const kind = d.sensor === 'intercept' ? 'ping' : 'esm';
    const b = trueDeg3(w, d.bearing);
    // ESM: "ESM PEILUNG 252 · SEEFALKE-2 · FREGATTE? (OBERFLÄCHENSUCHE) · STARK, STEIGEND", danger cue last
    const obs = d.emitter ? shipById(w, d.observerId) : undefined;
    const danger = d.emitter ? esmDangerText(d.emitter, !!obs && CLASSES[obs.cls].submarine) : undefined;
    const em = d.emitter ? ` · ${esmIntercept(d.emitter, d.esmLvl, d.esmTrend)}${danger ? ` · ${danger}` : ''}` : '';
    for (const slot of ctx.aboard(d.observerId)) {
      ctx.alert(slot.playerId, {
        time: d.time, kind, bearing: d.bearing, level: Math.round(d.se), source: d.source,
        ...(d.emitter ? { emitter: d.emitter, esmLvl: d.esmLvl, esmTrend: d.esmTrend } : {}),
        text: kind === 'ping' ? `${d.source === 'dip' ? 'TAUCHSONAR' : 'AKTIVSONAR'} PEILUNG ${b}°` : `ESM PEILUNG ${b}°${em}`,
      });
    }
  }
}
