import { describe, expect, it } from 'vitest';
import type { ServerMsg, Snapshot } from '@tk/shared';
import { parseClientMsg } from '../src/input.js';
import { Lobby } from '../src/lobby.js';
import type { Conn } from '../src/match.js';

function fakeConn(id: string): Conn & { inbox: ServerMsg[] } {
  const inbox: ServerMsg[] = [];
  return { playerId: id, callsign: id, inbox, send: (m) => inbox.push(m) };
}

function lastSnap(c: { inbox: ServerMsg[] }): Snapshot | undefined {
  for (let i = c.inbox.length - 1; i >= 0; i--) {
    const m = c.inbox[i]!;
    if (m.t === 'snap') return m.s;
  }
  return undefined;
}

function setup() {
  const lobby = new Lobby();
  const west = fakeConn('w1');
  const east = fakeConn('e1');
  lobby.connect(west);
  lobby.connect(east);
  lobby.handle(west, { t: 'create_match', name: 'Test' });
  const m = lobby.matchOf('w1')!;
  lobby.handle(east, { t: 'join', matchId: m.id, team: 'east' });
  lobby.handle(east, { t: 'pick_class', cls: 'ssn' });
  lobby.handle(west, { t: 'ready', ready: true });
  lobby.handle(east, { t: 'ready', ready: true });
  m.stop(); // drive ticks manually
  return { lobby, m, west, east };
}

describe('match lifecycle', () => {
  it('starts when everyone is ready and streams snapshots', () => {
    const { m, west, east } = setup();
    expect(m.state).toBe('running');
    for (let i = 0; i < 20; i++) m.tick();
    expect(lastSnap(west)?.own.cls).toBe('ffg');
    expect(lastSnap(east)?.own.cls).toBe('ssn');
  });

  it('never leaks enemy ship ids or positions (fog of war)', () => {
    const { m, west, east } = setup();
    for (let i = 0; i < 600; i++) m.tick();
    const subId = m.shipOf('e1')!.id;
    const ffgId = m.shipOf('w1')!.id;
    const westText = west.inbox.filter((x) => x.t === 'snap').map((x) => JSON.stringify(x)).join('');
    const eastText = east.inbox.filter((x) => x.t === 'snap').map((x) => JSON.stringify(x)).join('');
    expect(westText).not.toContain(subId);
    expect(eastText).not.toContain(ffgId);
    expect(eastText).not.toContain('"m1"');
    const s = lastSnap(east)!;
    expect(s.friendlies).toHaveLength(0);
    for (const c of s.contacts) expect(Object.keys(c)).not.toContain('targetId');
  });

  it('surface ships see the convoy over datalink', () => {
    const { m, west } = setup();
    for (let i = 0; i < 20; i++) m.tick();
    expect(lastSnap(west)!.friendlies.filter((f) => f.cls === 'merchant')).toHaveLength(8);
  });

  it('submarine radio needs the mast and is DF-able by the escort', () => {
    const { lobby, m, west, east } = setup();
    lobby.handle(east, { t: 'radio', text: 'Konvoi in Sicht' });
    expect(east.inbox.some((x) => x.t === 'error' && x.msg.includes('Funkmast'))).toBe(true);
    const sub = m.shipOf('e1')!;
    sub.depth = 18;
    sub.order.depth = 18;
    sub.mastUp = true;
    lobby.handle(east, { t: 'radio', text: 'Konvoi in Sicht' });
    for (let i = 0; i < 4; i++) m.tick();
    expect(lastSnap(west)!.contacts.some((c) => c.label.startsWith('E'))).toBe(true);
    expect(lastSnap(east)!.radio.at(-1)?.text).toBe('Konvoi in Sicht');
  });

  it('a running match ends with a winner', () => {
    const { m, west } = setup();
    m.world!.time = m.settings.timeLimitMin * 60 * m.settings.timeScale;
    m.tick();
    expect(m.state).toBe('ended');
    expect(west.inbox.some((x) => x.t === 'end')).toBe(true);
  });
});

describe('input validation', () => {
  it('rejects malformed and out-of-range messages', () => {
    expect(parseClientMsg('not json')).toBeUndefined();
    expect(parseClientMsg(JSON.stringify({ t: 'order', speedKn: 999 }))).toBeUndefined();
    expect(parseClientMsg(JSON.stringify({ t: 'radio', text: 'x'.repeat(500) }))).toBeUndefined();
    expect(parseClientMsg(JSON.stringify({ t: 'order', heading: 90 }))).toEqual({ t: 'order', heading: 90 });
  });
});

describe('lobby cleanup', () => {
  it('removes a running match once every player has left', () => {
    const { lobby, m } = setup();
    lobby.disconnect('w1');
    lobby.disconnect('e1');
    const probe = fakeConn('p');
    lobby.connect(probe);
    const list = probe.inbox.find((x) => x.t === 'lobby');
    expect(list && list.t === 'lobby' ? list.matches.map((x) => x.id) : []).not.toContain(m.id);
  });
});

describe('manual classification', () => {
  it('sonar contacts arrive unclassified; the player classifies, the enemy never sees it', () => {
    const { lobby, m, east, west } = setup();
    for (let i = 0; i < 40; i++) m.tick();
    const s = lastSnap(east)!;
    const c = s.contacts.find((x) => x.sensors.includes('hull'))!;
    expect(c.classified).toBeUndefined();
    expect(c.evidence).toBeDefined();
    lobby.handle(east, { t: 'classify', label: c.label, choice: 'merchant' });
    m.tick();
    m.tick();
    expect(lastSnap(east)!.contacts.find((x) => x.label === c.label)?.assigned).toBe('merchant');
    expect(JSON.stringify(lastSnap(west))).not.toContain('"assigned":"merchant"');
  });

  it('rejects unknown labels', () => {
    const { lobby, m, east } = setup();
    m.tick();
    lobby.handle(east, { t: 'classify', label: 'S99', choice: 'warship' });
    expect(east.inbox.some((x) => x.t === 'error' && x.msg === 'Kontakt nicht gefunden')).toBe(true);
  });
});

describe('transient alerts and hidden layer', () => {
  it('the escort hears a launch transient; the layer stays unknown until measured', () => {
    const { lobby, m, west, east } = setup();
    m.tick();
    m.tick();
    expect(lastSnap(west)!.env.layerDepth).toBeUndefined();
    const sub = m.shipOf('e1')!;
    const ffg = m.shipOf('w1')!;
    sub.pos = { x: ffg.pos.x + 8000, y: ffg.pos.y };
    lobby.handle(east, { t: 'fire', heading: 270, enableAfter: 3000, mode: 'passive', searchDepth: 20, speedKn: 40 });
    m.tick();
    m.tick();
    expect(lastSnap(west)!.alerts.some((a) => a.kind === 'transient')).toBe(true);
    lobby.handle(west, { t: 'bt' });
    m.tick();
    m.tick();
    expect(lastSnap(west)!.env.layerDepth).toBeGreaterThan(50);
  });
});

describe('AI captains', () => {
  it('fill an empty team and go on the attack', () => {
    const lobby = new Lobby();
    const solo = fakeConn('w1');
    lobby.connect(solo);
    lobby.handle(solo, { t: 'create_match', name: 'Solo' });
    const m = lobby.matchOf('w1')!;
    lobby.handle(solo, { t: 'ready', ready: true });
    m.stop();
    expect(m.slots.filter((s) => s.bot).map((s) => s.cls).sort()).toEqual(['ssk', 'ssn']);
    for (let i = 0; i < 6000 && !m.world!.events.some((e) => e.kind === 'transient'); i++) m.tick();
    expect(m.world!.events.some((e) => e.kind === 'transient' && e.sourceId.startsWith('p_bot'))).toBe(true);
    const text = solo.inbox.filter((x) => x.t === 'snap').map((x) => JSON.stringify(x)).join('');
    expect(text).not.toContain('p_bot');
  });
});

describe('crew on one ship', () => {
  it('a crew member shares the captain ship, sees the same picture and can steer it', () => {
    const lobby = new Lobby();
    const cap = fakeConn('w1');
    const mate = fakeConn('w2');
    const sub = fakeConn('e1');
    for (const c of [cap, mate, sub]) lobby.connect(c);
    lobby.handle(cap, { t: 'create_match', name: 'Crew' });
    const m = lobby.matchOf('w1')!;
    lobby.handle(mate, { t: 'join', matchId: m.id, team: 'west' });
    lobby.handle(sub, { t: 'join', matchId: m.id, team: 'east' });
    lobby.handle(mate, { t: 'crew', captainId: 'w1' });
    for (const c of [cap, mate, sub]) lobby.handle(c, { t: 'ready', ready: true });
    m.stop();
    expect(m.world!.ships.filter((s) => s.cls === 'ffg')).toHaveLength(1);
    lobby.handle(mate, { t: 'order', heading: 90 });
    for (let i = 0; i < 4; i++) m.tick();
    expect(lastSnap(cap)!.own.order.heading).toBe(90);
    expect(lastSnap(mate)!.own.id).toBe(lastSnap(cap)!.own.id);
    expect(lastSnap(mate)!.crew).toEqual(['w1', 'w2']);
  });
});
