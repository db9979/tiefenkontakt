import { DatabaseSync } from 'node:sqlite';
import type { ServerMsg } from '@tk/shared';
import { Lobby } from '../src/lobby.js';
import type { Conn } from '../src/match.js';
import { describe, expect, it } from 'vitest';
import { ModerationStore, adminList } from '../src/moderation.js';

describe('moderation', () => {
  it('admins come from the ADMIN list, case-insensitive', () => {
    const m = new ModerationStore(new DatabaseSync(':memory:'), adminList(' Seewolf, Kaleun '));
    expect(m.isAdmin('seewolf')).toBe(true);
    expect(m.isAdmin('KALEUN')).toBe(true);
    expect(m.isAdmin('Gast-123')).toBe(false);
    expect(m.isAdmin(undefined)).toBe(false);
  });

  it('records one report per reporter, reported player and match', () => {
    const m = new ModerationStore(new DatabaseSync(':memory:'), adminList(''));
    const r = { reporter: 'A', reported: 'B', reportedId: 'u-2', matchId: 'm1', reason: 'Beleidigung', evidence: 'B: …' };
    expect(m.report(r)).toBe(true);
    expect(m.report(r)).toBe(false);
    expect(m.report({ ...r, matchId: 'm2' })).toBe(true);
    expect(m.reports()).toHaveLength(2);
    m.dismissReport(m.reports()[0]!.id);
    expect(m.reports()).toHaveLength(1);
  });

  it('bans by player id or address until they expire', () => {
    const m = new ModerationStore(new DatabaseSync(':memory:'), adminList(''));
    m.ban({ playerId: 'g-abc', callsign: 'Troll-123', ip: '10.0.0.5', until: 2000, reason: 'Spam' });
    expect(m.bannedFor('g-abc', undefined, 1000)?.reason).toBe('Spam');
    expect(m.bannedFor('g-neu', '10.0.0.5', 1000)).toBeDefined();
    expect(m.bannedFor('g-neu', '10.0.0.6', 1000)).toBeUndefined();
    expect(m.bannedFor('g-abc', undefined, 3000)).toBeUndefined();
    m.unban(m.bans(1000)[0]!.id);
    expect(m.bannedFor('g-abc', undefined, 1000)).toBeUndefined();
  });
});

describe('moderation in the lobby', () => {
  function conn(id: string) {
    const inbox: ServerMsg[] = [];
    const c: Conn & { inbox: ServerMsg[]; closed?: number } = { playerId: id, callsign: id, inbox, send: (m) => inbox.push(m), close: (_r, code) => (c.closed = code) };
    return c;
  }
  function setup() {
    const lobby = new Lobby();
    const [a, b, e] = [conn('w1'), conn('w2'), conn('e1')];
    for (const c of [a, b, e]) {
      lobby.connect(c);
      lobby.resume(c);
    }
    lobby.handle(a, { t: 'create_match', name: 'Mod' });
    const m = lobby.matchOf('w1')!;
    lobby.handle(b, { t: 'join', matchId: m.id, team: 'west' });
    lobby.handle(e, { t: 'join', matchId: m.id, team: 'east' });
    for (const c of [a, b, e]) lobby.handle(c, { t: 'ready', ready: true });
    m.stop();
    return { lobby, m, a, b, e };
  }

  it('reports reach the hook with the sender and their lines', () => {
    const { lobby, m, a, b } = setup();
    const seen: string[] = [];
    lobby.onReport = (c, match, from) => {
      const s = match.senderOf(from)!;
      seen.push(`${c.playerId}>${s.playerId}:${s.evidence}`);
      return undefined;
    };
    lobby.handle(b, { t: 'radio', text: 'Ihr seid alle Anfänger' });
    const name = m.shipOf('w2')!.name;
    lobby.handle(a, { t: 'report', from: name, reason: 'Beleidigung' });
    expect(seen).toEqual([`w1>w2:${name}: Ihr seid alle Anfänger`]);
    expect(a.inbox.some((x) => x.t === 'error' && x.msg.includes('Moderation'))).toBe(true);
  });

  it('kick removes a player, a ban also cuts the link, ending a match frees everyone', () => {
    const { lobby, m, a, b, e } = setup();
    expect(lobby.kick('w2')?.callsign).toBe('w2');
    expect(lobby.matchOf('w2')).toBeUndefined();
    expect(b.inbox.some((x) => x.t === 'removed')).toBe(true);
    lobby.kick('e1', true);
    expect(e.closed).toBe(4001);
    expect(lobby.endMatch(m.id)).toBe(true);
    expect(lobby.matchOf('w1')).toBeUndefined();
    expect(a.inbox.some((x) => x.t === 'removed')).toBe(true);
    expect(lobby.adminView()).toHaveLength(0);
  });
});
