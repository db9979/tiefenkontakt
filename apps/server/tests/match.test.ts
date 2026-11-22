import { describe, expect, it } from 'vitest';
import type { ServerMsg, Snapshot } from '@tk/shared';
import { parseClientMsg } from '../src/input.js';
import { ABANDON_MS, Lobby } from '../src/lobby.js';
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

/** Alerts and radio are deltas: collect them over all snapshots, like the client does. */
function allOf(c: { inbox: ServerMsg[] }, key: 'alerts' | 'radio') {
  return c.inbox.flatMap((m) => (m.t === 'snap' ? (m.s[key] as unknown[]) : [])) as Snapshot['alerts'] & Snapshot['radio'];
}

function setup() {
  const lobby = new Lobby();
  const west = fakeConn('w1');
  const east = fakeConn('e1');
  lobby.connect(west);
  lobby.resume(west);
  lobby.connect(east);
  lobby.resume(east);
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
    expect((allOf(east, 'radio') as Snapshot['radio']).at(-1)?.text).toBe('Konvoi in Sicht');
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
  it('keeps an abandoned running match paused, then drops it after the grace period', () => {
    const { lobby, m, west, east } = setup();
    lobby.disconnect(west);
    lobby.disconnect(east);
    const t = m.world!.time;
    m.tick();
    expect(m.world!.time).toBe(t);
    lobby.prune(Date.now());
    expect(lobby.allMatches()).toContain(m);
    lobby.prune(Date.now() + ABANDON_MS + 1000);
    expect(lobby.allMatches()).not.toContain(m);
  });
});

describe('reconnect', () => {
  it('a returning player gets the same ship back and the match continues', () => {
    const { lobby, m, west } = setup();
    for (let i = 0; i < 5; i++) m.tick();
    const shipId = lastSnap(west)!.own.id;
    lobby.disconnect(west);
    const back = fakeConn('w1');
    expect(lobby.connect(back)).toBe(true);
    lobby.resume(back);
    expect(back.inbox.some((x) => x.t === 'match' && x.match.state === 'running')).toBe(true);
    for (let i = 0; i < 3; i++) m.tick();
    expect(lastSnap(back)!.own.id).toBe(shipId);
  });

  it('a second window replaces the first', () => {
    const { lobby, m, west } = setup();
    let closed = '';
    west.close = (r) => (closed = r);
    const tab2 = fakeConn('w1');
    lobby.connect(tab2);
    lobby.resume(tab2);
    expect(closed).toBe('replaced');
    lobby.disconnect(west); // the old socket closing must not drop the new one
    m.tick();
    m.tick();
    expect(lastSnap(tab2)).toBeDefined();
  });
});

describe('manual classification', () => {
  it('sonar contacts arrive unclassified; the player classifies, the enemy never sees it', () => {
    const { lobby, m, east, west } = setup();
    // Wait for a hull-sonar contact (masking by louder ships can delay the first one)
    let c;
    for (let i = 0; i < 400 && !c; i++) {
      m.tick();
      if (i >= 40) c = lastSnap(east)!.contacts.find((x) => x.sensors.includes('hull') && x.evidence);
    }
    if (!c) throw new Error('no hull contact');
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
    expect((allOf(west, 'alerts') as Snapshot['alerts']).some((a) => a.kind === 'transient')).toBe(true);
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
  lobby.resume(solo);
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
    for (const c of [cap, mate, sub]) {
      lobby.connect(c);
      lobby.resume(c);
    }
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

describe('server restart', () => {
  it('a saved match is restored paused and continues when the player returns', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { MatchStore } = await import('../src/match-store.js');
    const dir = mkdtempSync(join(tmpdir(), 'tk-'));
    const { lobby, m, west } = setup();
    for (let i = 0; i < 20; i++) m.tick();
    const time = m.world!.time;
    const shipId = lastSnap(west)!.own.id;
    new MatchStore(dir).saveAll(lobby);
    m.stop();

    const lobby2 = new Lobby();
    expect(new MatchStore(dir).loadAll(lobby2)).toBe(1);
    const restored = lobby2.allMatches()[0]!;
    restored.stop();
    expect(restored.world!.time).toBe(time);
    const back = fakeConn('w1');
    expect(lobby2.connect(back)).toBe(true);
    lobby2.resume(back);
    restored.tick();
    restored.tick();
    expect(lastSnap(back)!.own.id).toBe(shipId);
    expect(restored.world!.time).toBeGreaterThan(time);
  });
});

describe('debrief', () => {
  it('reveals true tracks and statistics only after the end', () => {
    const { m, west, east } = setup();
    for (let i = 0; i < 60; i++) m.tick();
    expect(west.inbox.some((x) => x.t === 'debrief')).toBe(false);
    m.world!.time = m.settings.timeLimitMin * 60 * m.settings.timeScale;
    m.tick();
    const d = west.inbox.find((x) => x.t === 'debrief');
    expect(d && d.t === 'debrief' ? d.d.frames.length : 0).toBeGreaterThan(0);
    if (d?.t !== 'debrief') throw new Error('no debrief');
    expect(d.d.ships.some((s) => s.cls === 'ssn')).toBe(true);
    expect(d.d.stats.map((s) => s.callsign).sort()).toEqual(['e1', 'w1']);
    expect(east.inbox.some((x) => x.t === 'debrief')).toBe(true);
  });
});

describe('training', () => {
  it('starts a private lesson immediately and ends the U-Jagd lesson on success', () => {
    const lobby = new Lobby();
    const p = fakeConn('t1');
    const other = fakeConn('o1');
    for (const c of [p, other]) {
      lobby.connect(c);
      lobby.resume(c);
    }
    lobby.handle(p, { t: 'training', lesson: 'ujagd' });
    const m = lobby.matchOf('t1')!;
    m.stop();
    expect(m.state).toBe('running');
    const lists = other.inbox.filter((x) => x.t === 'lobby');
    expect(lists.every((x) => x.t === 'lobby' && x.matches.length === 0)).toBe(true);
    m.tick();
    expect(lastSnap(p)!.lesson).toBe('ujagd');
    expect(lastSnap(p)!.own.cls).toBe('ffg');
    m.world!.ships.find((s) => s.id === 'p_bot-train')!.alive = false;
    m.tick();
    expect(p.inbox.some((x) => x.t === 'end' && x.reason.includes('geschafft'))).toBe(true);
  });
});

describe('missions and settings', () => {
  it('lobby settings choose the mission; the snapshot carries depth and light', () => {
    const lobby = new Lobby();
    const a = fakeConn('w1');
    lobby.connect(a);
    lobby.resume(a);
    lobby.handle(a, { t: 'create_match', name: 'Nacht' });
    const m = lobby.matchOf('w1')!;
    lobby.handle(a, { t: 'settings', mission: 'schelf', timeOfDay: 'nacht', seaState: 5 });
    expect(m.settings).toMatchObject({ mission: 'schelf', timeOfDay: 'nacht', seaState: 5 });
    lobby.handle(a, { t: 'ready', ready: true });
    m.stop();
    m.tick();
    const s = lastSnap(a)!;
    expect(s.env.light).toBeLessThan(0.3);
    expect(s.env.bottom).toBeLessThan(300);
    expect(s.env.seabed?.kind).toBe('schelf');
  });
});

describe('quick match, stations and spectators', () => {
  it('quick match fills the smaller team of an open lobby', () => {
    const lobby = new Lobby();
    const a = fakeConn('a');
    const b = fakeConn('b');
    for (const c of [a, b]) {
      lobby.connect(c);
      lobby.resume(c);
    }
    lobby.handle(a, { t: 'quick' });
    lobby.handle(b, { t: 'quick' });
    const m = lobby.matchOf('a')!;
    expect(lobby.matchOf('b')).toBe(m);
    expect(new Set(m.slots.map((s) => s.team)).size).toBe(2);
  });

  it('stations are shared aboard; spectators see only delayed truth', () => {
    const { lobby, m, west } = setup();
    lobby.handle(west, { t: 'station', index: 2 });
    for (let i = 0; i < 2; i++) m.tick();
    expect(lastSnap(west)!.stations).toEqual([{ callsign: 'w1', station: 2 }]);
    const fan = fakeConn('fan');
    lobby.connect(fan);
    lobby.resume(fan);
    for (let i = 0; i < 1200; i++) m.tick();
    lobby.handle(fan, { t: 'spectate', matchId: m.id });
    const msg = fan.inbox.find((x) => x.t === 'spectate');
    if (msg?.t !== 'spectate') throw new Error('no spectate');
    const newest = msg.d.frames[msg.d.frames.length - 1]?.[0] ?? 0;
    expect(newest).toBeLessThanOrEqual(m.world!.time - msg.delayS);
    expect(msg.d.ships.length).toBeGreaterThan(0);
  });
});

describe('leaving on purpose', () => {
  it('drops a running match when the last player leaves explicitly', () => {
    const { lobby, m, west, east } = setup();
    lobby.handle(west, { t: 'leave' });
    expect(lobby.allMatches()).toContain(m);
    lobby.handle(east, { t: 'leave' });
    expect(lobby.allMatches()).not.toContain(m);
  });
});

describe('new missions', () => {
  it('duel: submarines on both sides, no convoy, ends when one side is gone', async () => {
    const { buildScenario, DEFAULT_SETTINGS } = await import('../src/scenario.js');
    const { evaluate } = await import('../src/rules.js');
    const slots = [
      { playerId: 'a', callsign: 'A', team: 'west' as const, cls: 'ssn' as const, ready: true },
      { playerId: 'b', callsign: 'B', team: 'east' as const, cls: 'ssk' as const, ready: true },
    ];
    const w = buildScenario(slots, { ...DEFAULT_SETTINGS, mission: 'duell' }, 3);
    expect(w.ships.some((s) => s.cls === 'merchant')).toBe(false);
    expect(w.convoy).toBeUndefined();
    expect(evaluate(w, 1e9, 'duell')).toBeUndefined();
    w.ships.find((s) => s.id === 'p_b')!.alive = false;
    expect(evaluate(w, 1e9, 'duell')?.winner).toBe('west');
  });

  it('harbor: merchants at anchor; custom mission uses its own convoy speed and seabed', async () => {
    const { buildScenario, DEFAULT_SETTINGS } = await import('../src/scenario.js');
    const slots = [{ playerId: 'a', callsign: 'A', team: 'west' as const, cls: 'ffg' as const, ready: true }];
    const harbor = buildScenario(slots, { ...DEFAULT_SETTINGS, mission: 'hafen' }, 3);
    expect(harbor.ships.filter((s) => s.cls === 'merchant').every((s) => s.order.speedKn === 0)).toBe(true);
    const own = buildScenario(slots, { ...DEFAULT_SETTINGS, mission: 'eigene', merchants: 4, custom: { convoyKn: 12, seabed: 'schelf', subFrac: 0.3 } }, 3);
    expect(own.ships.filter((s) => s.cls === 'merchant')).toHaveLength(4);
    expect(own.convoy?.baseSpeedKn).toBe(12);
    expect(own.env.seabed?.kind).toBe('schelf');
  });

  it('in the duel the west side may pick submarines, otherwise not', () => {
    const lobby = new Lobby();
    const a = fakeConn('w1');
    lobby.connect(a);
    lobby.resume(a);
    lobby.handle(a, { t: 'create_match', name: 'Duell' });
    const m = lobby.matchOf('w1')!;
    lobby.handle(a, { t: 'pick_class', cls: 'ssn' });
    expect(m.slots[0]!.cls).toBe('ffg');
    lobby.handle(a, { t: 'settings', mission: 'duell' });
    expect(m.slots[0]!.cls).toBe('ssn');
    lobby.handle(a, { t: 'pick_class', cls: 'ssk' });
    expect(m.slots[0]!.cls).toBe('ssk');
  });
});
