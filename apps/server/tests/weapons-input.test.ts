import { describe, expect, it } from 'vitest';
import { KN, PERISCOPE_DEPTH, createShip, createWorld, installWeapons, type ClientMsg } from '@tk/shared';
import { applyCommand, parseClientMsg, type GameCommand } from '../src/input.js';

function sub(speedKn = 4, depth = 60) {
  const u = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: 0 }, heading: 0, speedKn, depth });
  const w = createWorld([u], 1);
  installWeapons(w);
  return { w, u };
}

const fire = (extra: Partial<Extract<ClientMsg, { t: 'fire' }>> = {}) =>
  ({ t: 'fire', heading: 90, enableAfter: 2000, mode: 'passive', searchDepth: 15, speedKn: 40, ...extra }) as GameCommand;

describe('fire orders (C8)', () => {
  it('accepts a salvo of up to four with a spread, and rejects more', () => {
    expect(parseClientMsg(JSON.stringify(fire({ salvo: 4, spread: 3 })))).toBeDefined();
    expect(parseClientMsg(JSON.stringify(fire({ salvo: 5, spread: 3 })))).toBeUndefined();
    expect(parseClientMsg(JSON.stringify(fire({ salvo: 2, spread: 30 })))).toBeUndefined();
  });

  it('a salvo order fires the fan; without salvo one torpedo goes', () => {
    const { w, u } = sub();
    expect(applyCommand(w, u, fire({ salvo: 3, spread: 4 }))).toBeUndefined();
    expect(w.weapons!.torpedoes.map((t) => t.heading)).toEqual([86, 90, 94]);
    expect(applyCommand(w, u, fire())).toBeUndefined();
    expect(w.weapons!.torpedoes).toHaveLength(4);
  });

  it('too fast to fire: refused with the reason', () => {
    const { w, u } = sub(18);
    expect(applyCommand(w, u, fire())).toMatch(/^Abschuss nur bis 15 kn/);
    expect(w.weapons!.torpedoes).toHaveLength(0);
  });
});

describe('mast order above 10 kn (C9)', () => {
  it('is refused', () => {
    const { w, u } = sub(12, PERISCOPE_DEPTH);
    u.speed = 12 * KN;
    expect(applyCommand(w, u, { t: 'toggle', what: 'mast', on: true })).toBe('Mast und Sehrohr erst unter 10 kn');
    u.speed = 8 * KN;
    expect(applyCommand(w, u, { t: 'toggle', what: 'mast', on: true })).toBeUndefined();
    expect(u.mastUp).toBe(true);
  });
});
