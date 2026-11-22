import { describe, expect, it } from 'vitest';
import { applyHitDamage, type ServerMsg } from '@tk/shared';
import { Lobby } from '../src/lobby.js';
import type { Conn } from '../src/match.js';

function conn(id: string): Conn & { inbox: ServerMsg[] } {
  const inbox: ServerMsg[] = [];
  return { playerId: id, callsign: id, inbox, send: (m) => inbox.push(m) };
}

describe('compartment damage over the wire', () => {
  it('bulkhead and priority orders reach the ship; the snapshot carries the compartments and crew reports', () => {
    const lobby = new Lobby();
    const a = conn('w1');
    const b = conn('e1');
    for (const c of [a, b]) {
      lobby.connect(c);
      lobby.resume(c);
    }
    lobby.handle(a, { t: 'create_match', name: 'Schott' });
    const m = lobby.matchOf('w1')!;
    lobby.handle(b, { t: 'join', matchId: m.id, team: 'east' });
    lobby.handle(a, { t: 'ready', ready: true });
    lobby.handle(b, { t: 'ready', ready: true });
    m.stop();
    m.tick();
    const ship = m.world!.ships.find((s) => s.playerId === 'w1')!;
    applyHitDamage(ship, 60, m.world!.rng, { u: 0.6, byId: 'x', w: m.world, fireChance: 1 });
    lobby.handle(a, { t: 'compartment', index: 2, action: 'seal' });
    lobby.handle(a, { t: 'compartment', index: 1, action: 'priority' });
    expect(ship.comps![2]!.sealed).toBe(true);
    expect(ship.dcComp).toBe(1);
    for (let i = 0; i < 20; i++) m.tick();
    const snap = [...a.inbox].reverse().find((x) => x.t === 'snap');
    expect(snap?.t === 'snap' && snap.s.own.comps?.[2]?.sealed).toBe(true);
    expect(snap?.t === 'snap' && snap.s.own.dcComp).toBe(1);
    const alerts = a.inbox.flatMap((x) => (x.t === 'snap' ? x.s.alerts : []));
    expect(alerts.some((x) => x.text.startsWith('SCHOTT GESCHLOSSEN'))).toBe(true);
    expect(alerts.some((x) => x.text.startsWith('WASSEREINBRUCH'))).toBe(true);
    // Bad input is refused by validation
    lobby.handle(a, { t: 'compartment', index: 42, action: 'seal' } as never);
    expect(ship.comps!.length).toBeLessThan(10);
  });
});
