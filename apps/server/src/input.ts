import {
  CLASSES,
  KN,
  PERISCOPE_DEPTH,
  dropDepthCharge,
  dropXbt,
  sendBuoy,
  sendDip,
  sendHeloTorpedo,
  callMpa,
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
  crewOf,
  emergencyBlow,
  sendMad,
  executeOrder,
} from '@tk/shared';
import { z } from 'zod';

const deg = z.number().finite().min(0).max(360);
const team = z.enum(['west', 'east']);

export const clientMsgSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('create_match'), name: z.string().trim().min(1).max(40), private: z.boolean().optional() }),
  z.object({ t: z.literal('join_code'), matchId: z.string().regex(/^[a-f0-9]{8}$/) }),
  z.object({ t: z.literal('join'), matchId: z.string().max(40), team }),
  z.object({ t: z.literal('leave') }),
  z.object({ t: z.literal('pick_class'), cls: z.enum(['ssn', 'ssk', 'ssc', 'ssa', 'ffg', 'kor', 'ffv']) }),
  z.object({ t: z.literal('ready'), ready: z.boolean() }),
  z.object({ t: z.literal('order'), heading: deg.optional(), speedKn: z.number().finite().min(0).max(40).optional(), depth: z.number().finite().min(0).max(700).optional() }),
  z.object({ t: z.literal('blow') }),
  z.object({ t: z.literal('mad'), bearing: deg, range: z.number().finite().min(200).max(30_000) }),
  z.object({ t: z.literal('toggle'), what: z.enum(['mast', 'snorkel', 'radar', 'active', 'decoy', 'silent', 'battle', 'buoyant', 'vds']), on: z.boolean() }),
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
  z.object({ t: z.literal('lobby_chat'), text: z.string().trim().min(1).max(200) }),
  z.object({ t: z.literal('report'), from: z.string().trim().min(1).max(40), reason: z.string().trim().min(1).max(200) }),
  z.object({ t: z.literal('pulse'), pulse: z.enum(['cw', 'lfm']) }),
  z.object({ t: z.literal('bt') }),
  z.object({ t: z.literal('lesson_done') }),
  z.object({ t: z.literal('station'), index: z.number().int().min(0).max(4) }),
  z.object({ t: z.literal('quick') }),
  z.object({ t: z.literal('spectate'), matchId: z.string().max(40) }),
  z.object({
    t: z.literal('settings'),
    mission: z.enum(['groenland', 'schelf', 'fjord', 'duell', 'hafen', 'eigene', 'fuehlung', 'meerenge', 'aufklaerung']).optional(),
    custom: z.object({ convoyKn: z.number().min(5).max(14), seabed: z.enum(['tief', 'schelf', 'fjord']), subFrac: z.number().min(0.2).max(0.9) }).optional(),
    merchants: z.number().int().min(2).max(12).optional(),
    timeOfDay: z.enum(['tag', 'daemmerung', 'nacht']).optional(),
    seaState: z.number().int().min(0).max(6).optional(),
    timeLimitMin: z.number().int().min(10).max(90).optional(),
    fillBots: z.boolean().optional(),
    botSkill: z.enum(['leicht', 'normal', 'schwer']).optional(),
    weather: z.enum(['wechselhaft', 'stabil']).optional(),
  }),
  z.object({ t: z.literal('training'), lesson: z.enum(['klassifizieren', 'tma', 'angriff', 'ujagd']) }),
  z.object({ t: z.literal('crew'), captainId: z.string().max(64).nullable() }),
  z.object({ t: z.literal('repair'), system: z.enum(['antrieb', 'sonar', 'waffen', 'leck']) }),
  z.object({ t: z.literal('execute_order'), id: z.string().max(16) }),
  z.object({ t: z.literal('buoy'), bearing: deg, range: z.number().finite().min(500).max(30_000), deep: z.boolean(), active: z.boolean().optional() }),
  z.object({ t: z.literal('dip'), bearing: deg, range: z.number().finite().min(500).max(30_000), deep: z.boolean() }),
  z.object({ t: z.literal('helotorp'), bearing: deg, range: z.number().finite().min(500).max(30_000) }),
  z.object({ t: z.literal('mpa'), bearing: deg, range: z.number().finite().min(0).max(80_000) }),
  z.object({
    t: z.literal('classify'), label: z.string().min(1).max(24),
    choice: z.enum(['merchant', 'warship', 'submarine', 'torpedo', 'bio', 'unknown']),
  }),  // Voice radio: join/leave, WebRTC signalling to a team mate (size-limited), push-to-talk
  z.object({
    t: z.literal('voice'), op: z.enum(['join', 'leave', 'signal', 'ptt']),
    to: z.string().max(64).optional(), on: z.boolean().optional(),
    data: z.object({
      sdp: z.object({ type: z.enum(['offer', 'answer']), sdp: z.string().max(20_000) }).optional(),
      ice: z.object({ candidate: z.string().max(1000), sdpMid: z.string().max(64).nullable().optional(), sdpMLineIndex: z.number().int().min(0).max(64).nullable().optional() }).optional(),
    }).optional(),
  }),
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
  { t: 'order' | 'toggle' | 'towed' | 'fire' | 'steer' | 'rocket' | 'dc' | 'noisemaker' | 'pulse' | 'bt' | 'buoy' | 'repair' | 'dip' | 'helotorp' | 'mpa' | 'blow' | 'mad' | 'execute_order' }
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
        if (!m.on && (s.snorkelStuckUntil ?? 0) > w.time) return 'Schnorchelventil klemmt noch';
        s.snorkel = m.on;
        if (m.on) s.order.depth = PERISCOPE_DEPTH;
      } else if (m.what === 'radar') {
        if (spec.submarine) return 'Kein Radar an Bord';
        s.radarOn = m.on;
      } else if (m.what === 'active') {
        if (spec.hull.activeSl === undefined) return 'Kein Aktivsonar';
        s.activeSonar = m.on;
      } else if (m.what === 'silent') {
        crewOf(s).silent = m.on;
      } else if (m.what === 'battle') {
        crewOf(s).battle = m.on;
      } else if (m.what === 'vds') {
        const vds = spec.vds;
        if (!vds) return 'Kein Tiefensonar (VDS) an Bord';
        if (m.on && s.speed / KN > vds.maxSpeedKn) return `Erst unter ${vds.maxSpeedKn} kn`;
        // Lower the body below the layer (40 m under it), or to 150 m without a layer
        const layer = s.btLayer ?? w.env.layerDepth;
        s.vdsOrder = m.on ? Math.min(vds.maxDepth, layer !== undefined ? layer + 40 : 150) : 0;
      } else if (m.what === 'buoyant') {
        if (!spec.submarine) return 'Nur für U-Boote';
        s.buoyAntenna = m.on;
      } else {
        setTowedDecoy(w, s, m.on);
      }
      return;
    case 'towed': {
      const max = spec.towed?.maxLength ?? 0;
      if (!max) return 'Kein Schleppsonar';
      if ((s.towedLostUntil ?? 0) > w.time && m.length > 0) return 'Schleppsonar verloren · Ersatz wird klargemacht';
      // The winch streams or recovers the array over minutes (kinematics)
      s.towedOrder = Math.min(m.length, max);
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
    case 'pulse':
      if (spec.hull.activeSl === undefined) return 'Kein Aktivsonar';
      s.pulse = m.pulse;
      return;
    case 'bt': {
      if (spec.submarine) return 'Das Boot misst die Schicht beim Durchtauchen';
      const r = dropXbt(w, s);
      return r === true ? undefined : r;
    }
    case 'repair':
      s.repair = m.system;
      return;
    case 'blow': {
      const r = emergencyBlow(w, s);
      return r === true ? undefined : r;
    }
    case 'mad': {
      const v = headingVec(m.bearing);
      const r = sendMad(w, s, { x: s.pos.x + v.x * m.range, y: s.pos.y + v.y * m.range });
      return r === true ? undefined : r;
    }
    case 'dip':
    case 'helotorp':
    case 'mpa': {
      const v = headingVec(m.bearing);
      const p = { x: s.pos.x + v.x * m.range, y: s.pos.y + v.y * m.range };
      const r = m.t === 'dip' ? sendDip(w, s, p, m.deep) : m.t === 'helotorp' ? sendHeloTorpedo(w, s, p) : callMpa(w, s, p, m.bearing);
      return r === true ? undefined : r;
    }
    case 'buoy': {
      const v = headingVec(m.bearing);
      const r = sendBuoy(w, s, { x: s.pos.x + v.x * m.range, y: s.pos.y + v.y * m.range }, m.deep, m.active ?? false);
      return r === true ? undefined : r;
    }
    case 'execute_order': {
      const r = executeOrder(w, s, m.id);
      return r === true ? undefined : r;
    }
    case 'noisemaker': {
      const r = launchNoisemaker(w, s);
      return r === true ? undefined : r;
    }
  }
}
