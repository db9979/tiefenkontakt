import {
  CLASSES,
  PERISCOPE_DEPTH,
  dropDepthCharge,
  fireTorpedo,
  headingVec,
  isAtPeriscopeDepth,
  launchAswRocket,
  launchNoisemaker,
  setTowedDecoy,
  steerTorpedo,
  type ClientMsg,
  type Ship,
  type World,
} from '@tk/shared';
import { z } from 'zod';

const deg = z.number().finite().min(0).max(360);
const team = z.enum(['west', 'east']);

export const clientMsgSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('create_match'), name: z.string().trim().min(1).max(40) }),
  z.object({ t: z.literal('join'), matchId: z.string().max(40), team }),
  z.object({ t: z.literal('leave') }),
  z.object({ t: z.literal('pick_class'), cls: z.enum(['ssn', 'ssk', 'ffg']) }),
  z.object({ t: z.literal('ready'), ready: z.boolean() }),
  z.object({ t: z.literal('order'), heading: deg.optional(), speedKn: z.number().finite().min(0).max(40).optional(), depth: z.number().finite().min(0).max(500).optional() }),
  z.object({ t: z.literal('toggle'), what: z.enum(['mast', 'snorkel', 'radar', 'active', 'decoy']), on: z.boolean() }),
  z.object({ t: z.literal('towed'), length: z.number().finite().min(0).max(2000) }),
  z.object({
    t: z.literal('fire'), heading: deg, enableAfter: z.number().finite().min(0).max(30_000),
    mode: z.enum(['passive', 'active']), searchDepth: z.number().finite().min(5).max(500), speedKn: z.number().finite().min(20).max(50),
  }),
  z.object({ t: z.literal('steer'), torpId: z.string().max(20), heading: deg }),
  z.object({ t: z.literal('rocket'), bearing: deg, range: z.number().finite().min(1000).max(20_000) }),
  z.object({ t: z.literal('dc'), depth: z.number().finite().min(20).max(400) }),
  z.object({ t: z.literal('noisemaker') }),
  z.object({ t: z.literal('radio'), text: z.string().trim().min(1).max(200) }),
]);

export function parseClientMsg(raw: string): ClientMsg | undefined {
  try {
    const r = clientMsgSchema.safeParse(JSON.parse(raw));
    return r.success ? (r.data as ClientMsg) : undefined;
  } catch {
    return undefined;
  }
}

export type GameCommand = Extract<
  ClientMsg,
  { t: 'order' | 'toggle' | 'towed' | 'fire' | 'steer' | 'rocket' | 'dc' | 'noisemaker' }
>;

/** Apply an in-game command to the player's own ship. Returns an error text or undefined. */
export function applyCommand(w: World, s: Ship, m: GameCommand): string | undefined {
  if (!s.alive) return 'Dein Schiff ist gesunken';
  const spec = CLASSES[s.cls];
  switch (m.t) {
    case 'order':
      if (m.heading !== undefined) s.order.heading = m.heading % 360;
      if (m.speedKn !== undefined) s.order.speedKn = Math.min(m.speedKn, spec.maxSpeedKn);
      if (m.depth !== undefined && spec.submarine) s.order.depth = Math.min(m.depth, spec.maxDepth);
      return;
    case 'toggle':
      if (m.what === 'mast') {
        if (!spec.submarine) return 'Nur für U-Boote';
        if (m.on && !isAtPeriscopeDepth(s)) return `Erst auf Sehrohrtiefe (${PERISCOPE_DEPTH} m)`;
        s.mastUp = m.on;
      } else if (m.what === 'snorkel') {
        if (!spec.battery) return 'Nur für Diesel-U-Boote';
        s.snorkel = m.on;
        if (m.on) s.order.depth = PERISCOPE_DEPTH;
      } else if (m.what === 'radar') {
        if (spec.submarine) return 'Kein Radar an Bord';
        s.radarOn = m.on;
      } else if (m.what === 'active') {
        if (spec.hull.activeSl === undefined) return 'Kein Aktivsonar';
        s.activeSonar = m.on;
      } else {
        setTowedDecoy(w, s, m.on);
      }
      return;
    case 'towed': {
      const max = spec.towed?.maxLength ?? 0;
      if (!max) return 'Kein Schleppsonar';
      s.towedLength = Math.min(m.length, max);
      s.lastTurnAt = w.time;
      return;
    }
    case 'fire': {
      const r = fireTorpedo(w, s, { heading: m.heading, enableAfter: m.enableAfter, mode: m.mode, searchDepth: m.searchDepth, speedKn: m.speedKn });
      return typeof r === 'string' ? r : undefined;
    }
    case 'steer':
      return steerTorpedo(w, s, m.torpId, m.heading) ? undefined : 'Draht gerissen';
    case 'rocket': {
      const v = headingVec(m.bearing);
      const r = launchAswRocket(w, s, { x: s.pos.x + v.x * m.range, y: s.pos.y + v.y * m.range });
      return r === true ? undefined : r;
    }
    case 'dc': {
      const r = dropDepthCharge(w, s, m.depth);
      return r === true ? undefined : r;
    }
    case 'noisemaker': {
      const r = launchNoisemaker(w, s);
      return r === true ? undefined : r;
    }
  }
}
