import { describe, expect, it } from 'vitest';
import { ContactBook, Rng, createShip, inScopeView, runSensors, type Detection, type Environment, type World } from '@tk/shared';
import { sweepScope } from '../src/bots/sub.js';

const day: Environment = { layerDepth: 100, layerLoss: 12, seaState: 2, light: 1 };

describe('sub bot periscope sweep', () => {
  it('finds a ship ahead within one sweep and never sees outside where it looks', () => {
    const boat = createShip({ id: 'b', cls: 'ssk', name: 'B', pos: { x: 0, y: 0 }, heading: 0, speedKn: 3, depth: 15, team: 'east' });
    boat.mastUp = true;
    // One ship fine on the bow, one on the quarter
    const ahead = createShip({ id: 'a', cls: 'merchant', name: 'A', pos: { x: 2500, y: 3000 }, heading: 90, speedKn: 0, team: 'west' });
    const quarter = createShip({ id: 'q', cls: 'ffg', name: 'Q', pos: { x: -2000, y: -3000 }, heading: 90, speedKn: 0, team: 'west' });
    const book = new ContactBook();
    const w = { time: 0, books: new Map([[boat.id, book]]), ships: [boat, ahead, quarter] } as unknown as World;
    const rng = new Rng(4);
    const seen: Detection[] = [];
    for (let t = 0; t < 26; t++) {
      w.time = t;
      sweepScope(w, boat);
      expect(boat.scope).toBeDefined();
      for (const d of runSensors({ ships: w.ships, env: day, time: t, rng }).filter((x) => x.sensor === 'periscope' && x.observerId === boat.id)) {
        const target = w.ships.find((s) => s.id === d.targetId)!;
        expect(inScopeView(boat.scope, (Math.atan2(target.pos.x, target.pos.y) * 180) / Math.PI)).toBe(true);
        seen.push(d);
        book.ingest(d);
      }
    }
    // The ship ahead is found in the first seconds and then watched at 6×
    expect(seen.find((d) => d.targetId === 'a')!.time).toBeLessThan(4);
    expect(seen.filter((d) => d.targetId === 'a' && d.mag === 6).length).toBeGreaterThan(8);
    // The one on the quarter turns up as the sweep comes round
    expect(seen.some((d) => d.targetId === 'q')).toBe(true);
    // Not every second: the optic looks at one sector at a time
    expect(seen.filter((d) => d.targetId === 'q').length).toBeLessThan(10);
  });

  it('keeps the scope where it was with the mast down', () => {
    const boat = createShip({ id: 'b', cls: 'ssk', name: 'B', pos: { x: 0, y: 0 }, heading: 0, speedKn: 3, depth: 60, team: 'east' });
    const w = { time: 5, books: new Map(), ships: [boat] } as unknown as World;
    sweepScope(w, boat);
    expect(boat.scope).toBeUndefined();
  });
});
