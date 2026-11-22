import { describe, expect, it } from 'vitest';
import { PERISCOPE_DEPTH, type ServerMsg } from '@tk/shared';
import { parseClientMsg } from '../src/input.js';
import { Lobby } from '../src/lobby.js';
import type { Conn } from '../src/match.js';

function fakeConn(id: string): Conn & { inbox: ServerMsg[] } {
  const inbox: ServerMsg[] = [];
  return { playerId: id, callsign: id.toUpperCase(), inbox, send: (m) => inbox.push(m) };
}

const voiceMsgs = (c: { inbox: ServerMsg[] }, op: string) => c.inbox.filter((m) => m.t === 'voice' && m.op === op) as Extract<ServerMsg, { t: 'voice' }>[];
const errors = (c: { inbox: ServerMsg[] }) => c.inbox.filter((m) => m.t === 'error').map((m) => (m as { msg: string }).msg);

function setup() {
  const lobby = new Lobby();
  const [w1, w2, e1] = [fakeConn('w1'), fakeConn('w2'), fakeConn('e1')];
  for (const c of [w1, w2, e1]) {
    lobby.connect(c);
    lobby.resume(c);
  }
  lobby.handle(w1, { t: 'create_match', name: 'Funk' });
  const m = lobby.matchOf('w1')!;
  lobby.handle(w2, { t: 'join', matchId: m.id, team: 'west' });
  lobby.handle(e1, { t: 'join', matchId: m.id, team: 'east' });
  lobby.handle(e1, { t: 'pick_class', cls: 'ssk' });
  for (const c of [w1, w2, e1]) lobby.handle(c, { t: 'ready', ready: true });
  m.stop();
  return { lobby, m, w1, w2, e1 };
}

describe('voice radio', () => {
  it('validates voice messages', () => {
    expect(parseClientMsg(JSON.stringify({ t: 'voice', op: 'ptt', on: true }))).toBeDefined();
    expect(parseClientMsg(JSON.stringify({ t: 'voice', op: 'signal', to: 'x', data: { sdp: { type: 'offer', sdp: 'x'.repeat(30_000) } } }))).toBeUndefined();
    expect(parseClientMsg(JSON.stringify({ t: 'voice', op: 'shout' }))).toBeUndefined();
  });

  it('team mates get each other as peers and signalling stays inside the team', () => {
    const { lobby, w1, w2, e1 } = setup();
    for (const c of [w1, w2, e1]) lobby.handle(c, { t: 'voice', op: 'join' });
    expect(voiceMsgs(w1, 'config')).toHaveLength(1);
    const peers = voiceMsgs(w1, 'peers').pop() as Extract<ServerMsg, { op: 'peers' }>;
    expect(peers.peers.map((p) => p.playerId)).toEqual(['w2']);
    lobby.handle(w1, { t: 'voice', op: 'signal', to: 'w2', data: { ice: { candidate: 'c' } } });
    expect(voiceMsgs(w2, 'signal')).toHaveLength(1);
    lobby.handle(e1, { t: 'voice', op: 'signal', to: 'w1', data: { ice: { candidate: 'spy' } } });
    expect(voiceMsgs(w1, 'signal')).toHaveLength(0);
  });

  it('a submerged boat may not talk; with the mast up it may, and the escort takes a bearing', () => {
    const { lobby, m, w1, w2, e1 } = setup();
    for (const c of [w1, w2, e1]) lobby.handle(c, { t: 'voice', op: 'join' });
    const boat = m.shipOf('e1')!;
    boat.depth = 80;
    lobby.handle(e1, { t: 'voice', op: 'ptt', on: true });
    expect(errors(e1).some((e) => /Funkmast/.test(e))).toBe(true);
    boat.depth = PERISCOPE_DEPTH;
    boat.mastUp = true;
    boat.mastExt = 1;
    e1.inbox.length = 0;
    lobby.handle(e1, { t: 'voice', op: 'ptt', on: true });
    expect(errors(e1)).toHaveLength(0);
    const frigate = m.shipOf('w1')!;
    const heard = m.world!.books.get(frigate.id)?.entries().some(([, t]) => t.sensors.includes('esm'));
    expect(heard).toBe(true);
    // The frigates hear each other: state shows the link and who is talking
    lobby.handle(w2, { t: 'voice', op: 'ptt', on: true });
    const st = voiceMsgs(w1, 'state').pop() as Extract<ServerMsg, { op: 'state' }>;
    expect(st.canTx).toBe(true);
    expect(st.links.find((l) => l.playerId === 'w2')).toMatchObject({ talking: true });
    expect(st.links.find((l) => l.playerId === 'w2')!.q).toBeGreaterThan(0);
  });
});
