import { describe, expect, it } from 'vitest';
import type { ServerMsg } from '@tk/shared';
import { Lobby } from '../src/lobby.js';
import type { Conn } from '../src/match.js';
import { rankFor } from '../src/stats.js';

function conn(id: string, rank?: string): Conn & { inbox: ServerMsg[] } {
  const inbox: ServerMsg[] = [];
  return { playerId: id, callsign: id, inbox, send: (m) => inbox.push(m), rank };
}

describe('lobby extras', () => {
  it('lobby chat reaches everyone in the match lobby, ranks are shown on the slot', () => {
    const lobby = new Lobby();
    const a = conn('w1', 'Kapitänleutnant');
    const b = conn('e1');
    for (const c of [a, b]) {
      lobby.connect(c);
      lobby.resume(c);
    }
    lobby.handle(a, { t: 'create_match', name: 'Chat' });
    const m = lobby.matchOf('w1')!;
    lobby.handle(b, { t: 'join', matchId: m.id, team: 'east' });
    lobby.handle(b, { t: 'lobby_chat', text: 'Ich nehme die Nordflanke' });
    const last = [...a.inbox].reverse().find((x) => x.t === 'match');
    expect(last?.t === 'match' && last.match.chat?.at(-1)?.text).toBe('Ich nehme die Nordflanke');
    expect(last?.t === 'match' && last.match.slots.find((s) => s.playerId === 'w1')?.rank).toBe('Kapitänleutnant');
  });

  it('the first complete snapshot carries the mission briefing', () => {
    const lobby = new Lobby();
    const a = conn('w1');
    const b = conn('e1');
    for (const c of [a, b]) {
      lobby.connect(c);
      lobby.resume(c);
    }
    lobby.handle(a, { t: 'create_match', name: 'Brief' });
    const m = lobby.matchOf('w1')!;
    lobby.handle(b, { t: 'join', matchId: m.id, team: 'east' });
    lobby.handle(a, { t: 'ready', ready: true });
    lobby.handle(b, { t: 'ready', ready: true });
    m.stop();
    for (let i = 0; i < 12; i++) m.tick();
    const snaps = b.inbox.filter((x) => x.t === 'snap');
    const first = snaps[0];
    expect(first?.t === 'snap' && first.s.briefing?.goal).toContain('Konvoi');
    expect(first?.t === 'snap' && first.s.briefing?.intel.some((l) => l.startsWith('Aufklärung'))).toBe(true);
    const later = snaps[1];
    expect(later?.t === 'snap' && later.s.briefing).toBeUndefined();
  });

  it('ranks follow service points', () => {
    expect(rankFor(0)).toBe('Leutnant zur See');
    expect(rankFor(350)).toBe('Kapitänleutnant');
    expect(rankFor(5000)).toBe('Kapitän zur See');
  });
});
