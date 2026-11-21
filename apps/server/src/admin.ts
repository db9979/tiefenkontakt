import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import type { Lobby } from './lobby.js';
import type { ModerationStore } from './moderation.js';

/**
 * Moderator API (accounts listed in ADMIN only):
 *   GET  /api/admin/overview        matches, players, open reports, active bans
 *   POST /api/admin/end    {matchId}
 *   POST /api/admin/kick   {playerId}
 *   POST /api/admin/ban    {playerId, hours, reason}
 *   POST /api/admin/unban  {banId}
 *   POST /api/admin/dismiss {reportId}
 */

const schemas = {
  end: z.object({ matchId: z.string().min(1).max(40) }),
  kick: z.object({ playerId: z.string().min(1).max(40) }),
  ban: z.object({ playerId: z.string().min(1).max(40), hours: z.number().min(1).max(24 * 365), reason: z.string().trim().min(1).max(200) }),
  unban: z.object({ banId: z.number().int() }),
  dismiss: z.object({ reportId: z.number().int() }),
};

type Reply = (status: number, body: unknown) => void;

export function handleAdmin(req: IncomingMessage, body: unknown, reply: Reply, lobby: Lobby, mod: ModerationStore): void {
  const action = (req.url ?? '').slice('/api/admin/'.length);
  if (action === 'overview' && req.method === 'GET') {
    return reply(200, { matches: lobby.adminView(), reports: mod.reports(), bans: mod.bans() });
  }
  if (req.method !== 'POST' || !(action in schemas)) return reply(404, { error: 'Nicht gefunden' });
  const parsed = schemas[action as keyof typeof schemas].safeParse(body);
  if (!parsed.success) return reply(400, { error: 'Ungültige Angaben' });
  const p = parsed.data as { matchId: string; playerId: string; banId: number; reportId: number };
  switch (action) {
    case 'end':
      return lobby.endMatch(p.matchId) ? reply(200, { ok: true }) : reply(404, { error: 'Partie nicht gefunden' });
    case 'kick':
      return lobby.kick(p.playerId) ? reply(200, { ok: true }) : reply(404, { error: 'Spieler nicht gefunden' });
    case 'ban': {
      const { playerId, hours, reason } = parsed.data as z.infer<typeof schemas.ban>;
      const who = lobby.kick(playerId, true);
      const reported = mod.reports().find((r) => r.reportedId === playerId);
      const callsign = who?.callsign ?? reported?.reported ?? playerId;
      // Guests can mint new ids: their address is banned too. Accounts are banned by id only.
      mod.ban({ playerId, callsign, ip: playerId.startsWith('g-') ? who?.ip ?? null : null, until: Date.now() + hours * 3_600_000, reason });
      return reply(200, { ok: true });
    }
    case 'unban':
      mod.unban(p.banId);
      return reply(200, { ok: true });
    case 'dismiss':
      mod.dismissReport(p.reportId);
      return reply(200, { ok: true });
  }
}
