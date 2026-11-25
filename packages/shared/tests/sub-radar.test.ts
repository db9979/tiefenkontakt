import { describe, expect, it } from 'vitest';
import { DEFAULT_ENV, NM, Rng, createShip, runSensors, stepShip, type Ship } from '../src/index.js';

const ctx = (ships: Ship[]) => ({ ships, env: DEFAULT_ENV, time: 1000, rng: new Rng(3) });

function boat(): Ship {
  const s = createShip({ id: 'u', cls: 'ssk', name: 'U', team: 'east', pos: { x: 0, y: 0 }, heading: 0, speedKn: 3, depth: 14 });
  s.order.depth = 14;
  s.mastUp = true;
  s.mastExt = 1;
  s.radarOn = true;
  return s;
}

describe('submarine radar on the mast', () => {
  it('finds ships out to its short horizon, not beyond', () => {
    const near = createShip({ id: 'n', cls: 'merchant', name: 'N', team: 'neutral', pos: { x: 0, y: 10 * NM }, heading: 90, speedKn: 9 });
    const far = createShip({ id: 'f', cls: 'merchant', name: 'F', team: 'neutral', pos: { x: 0, y: 18 * NM }, heading: 90, speedKn: 9 });
    const hits = runSensors(ctx([boat(), near, far])).filter((d) => d.observerId === 'u' && d.sensor === 'radar').map((d) => d.targetId);
    expect(hits).toContain('n');
    expect(hits).not.toContain('f');
  });

  it('is silent with the mast down, and lowering the mast switches it off', () => {
    const s = boat();
    const tgt = createShip({ id: 'n', cls: 'merchant', name: 'N', team: 'neutral', pos: { x: 0, y: 5 * NM }, heading: 90, speedKn: 9 });
    s.mastExt = 0.5; // still hoisting
    expect(runSensors(ctx([s, tgt])).some((d) => d.observerId === 'u' && d.sensor === 'radar')).toBe(false);
    s.mastUp = false;
    stepShip(s, 0.1, 1000);
    expect(s.radarOn).toBe(false);
  });

  it('every frigate with ESM hears it as a submarine radar', () => {
    const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 20 * NM }, heading: 180, speedKn: 15 });
    const d = runSensors(ctx([boat(), ffg])).find((x) => x.observerId === 'f' && x.sensor === 'esm');
    expect(d?.emitter).toBe('KIEBITZ-U');
    const quiet = boat();
    quiet.radarOn = false;
    expect(runSensors(ctx([quiet, ffg])).some((x) => x.observerId === 'f' && x.sensor === 'esm' && x.targetId === 'u')).toBe(false);
  });
});
