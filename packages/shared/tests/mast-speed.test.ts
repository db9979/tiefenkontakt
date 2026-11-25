import { describe, expect, it } from 'vitest';
import { KN, MAST_MAX_KN, PERISCOPE_DEPTH, createShip, createWorld, installBoats, installWeapons, stepWorld, type Environment } from '../src/index.js';

const env: Environment = { layerDepth: 0, layerLoss: 0, seaState: 2, light: 1 };
const run = (w: ReturnType<typeof createWorld>, secs: number) => { for (let i = 0; i < secs * 10; i++) stepWorld(w); };

function boatAtPd(kn: number) {
  const u = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: 0 }, heading: 0, speedKn: kn, depth: PERISCOPE_DEPTH, team: 'east' });
  u.order = { heading: 0, speedKn: kn, depth: PERISCOPE_DEPTH };
  const w = createWorld([u], 3, env);
  installWeapons(w);
  installBoats(w);
  return { w, u };
}

describe('mast and periscope speed limit (C9)', () => {
  it('a mast stays up at 8 kn', () => {
    const { w, u } = boatAtPd(8);
    u.mastUp = true;
    run(w, 20);
    expect(u.mastUp).toBe(true);
  });

  it('above 10 kn the crew lowers the mast and reports it', () => {
    const { w, u } = boatAtPd(8);
    u.mastUp = true;
    u.radarOn = true;
    u.order.speedKn = 14;
    run(w, 120);
    expect(u.speed / KN).toBeGreaterThan(MAST_MAX_KN);
    expect(u.mastUp).toBe(false);
    expect(u.radarOn).toBe(false);
    expect(w.events.some((e) => e.kind === 'boat' && e.what === 'mast')).toBe(true);
  });

  it('a mast ordered on the way up waits until she is slow enough', () => {
    const { w, u } = boatAtPd(14);
    u.speed = 14 * KN;
    u.mastPending = true;
    run(w, 10);
    expect(u.mastUp).toBe(false);
    expect(u.mastPending).toBe(true);
    u.order.speedKn = 6;
    run(w, 200);
    expect(u.mastUp).toBe(true);
  });
});
