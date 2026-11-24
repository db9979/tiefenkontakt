import { describe, expect, it } from 'vitest';
import { DEFAULT_ENV, compassStem, createShip, createWorld, trueDeg3, type AlertView, type PlayerSlot, type World } from '@tk/shared';
import { alertsFor } from '../src/match-events.js';

/** Texts the server builds show true degrees; the numbers in the protocol stay in the game frame. */

function setup(region?: 'gibraltar') {
  const sub = createShip({ id: 's', cls: 'ssk', name: 'U', team: 'east', pos: { x: 0, y: 0 }, heading: 0, playerId: 'p' });
  const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', team: 'west', pos: { x: 0, y: 5000 }, heading: 0 });
  const w = createWorld([sub, ffg], 1, { ...DEFAULT_ENV, seabed: { kind: 'tief', seed: 1, ...(region ? { region } : {}) } });
  const slot: PlayerSlot = { playerId: 'p', callsign: 'p', team: 'east', cls: 'ssk', ready: true };
  const got: AlertView[] = [];
  const ctx = {
    slots: [slot],
    shipOf: (id: string) => (id === 'p' ? sub : undefined),
    aboard: (id: string) => (id === 's' ? [slot] : []),
    alert: (_: string, a: AlertView) => void got.push(a),
  };
  const run = (w2: World) => alertsFor(w2, [
    { kind: 'torpedo_alert', time: 0, shipId: 's', bearing: 0 },
    { kind: 'hit', time: 0, shipId: 'f', x: 0, y: 5000 },
  ], ctx);
  return { w, got, run };
}

describe('true bearings in server texts', () => {
  it('Gibraltar (route bearing 88): game bearing 0 reads 088, the alert number stays 0', () => {
    const { w, got, run } = setup('gibraltar');
    run(w);
    expect(got[0]!.text).toBe('TORPEDO PEILUNG 088');
    expect(got[0]!.bearing).toBe(0);
    expect(got[1]!.text).toBe('EXPLOSION PEILUNG 088');
    expect(got[1]!.bearing).toBe(0);
  });

  it('region-less worlds are unchanged', () => {
    const { w, got, run } = setup();
    run(w);
    expect(got[0]!.text).toBe('TORPEDO PEILUNG 000');
    expect(got[1]!.text).toBe('EXPLOSION PEILUNG 000');
  });

  it('helpers wrap, round and name the compass direction', () => {
    const gib = { env: { seabed: { kind: 'tief' as const, seed: 1, region: 'gibraltar' as const } } };
    const none = { env: {} };
    expect(trueDeg3(gib, 300)).toBe('028');
    expect(trueDeg3(gib, -100)).toBe('348');
    expect(trueDeg3(none, 359.7)).toBe('000');
    expect(trueDeg3(none, 45)).toBe('045');
    expect(trueDeg3(gib, 0, 10)).toBe('090');
    expect(compassStem(gib, 0)).toBe('Ost');
    expect(compassStem(none, 0)).toBe('Nord');
  });
});
