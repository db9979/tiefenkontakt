import { describe, expect, it } from 'vitest';
import { BROADCAST_FIRST_S, createShip, createWorld, stepCommandRadio } from '../src/index.js';

describe('fleet command situation report', () => {
  it('counts the convoy\'s warships as escorts, not neutral fishing boats, yachts and ferries', () => {
    const sub = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: 0 }, heading: 0, team: 'east', depth: 18 });
    const ships = [
      sub,
      createShip({ id: 'm1', cls: 'merchant', name: 'M1', pos: { x: 20_000, y: 20_000 }, heading: 90, team: 'west' }),
      createShip({ id: 'm2', cls: 'merchant', name: 'M2', pos: { x: 21_000, y: 20_000 }, heading: 90, team: 'west' }),
      createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 22_000, y: 21_000 }, heading: 90, team: 'west' }),
      createShip({ id: 'n1', cls: 'fischer', name: 'N1', pos: { x: 5000, y: 9000 }, heading: 0, team: 'neutral' }),
      createShip({ id: 'n2', cls: 'yacht', name: 'N2', pos: { x: 7000, y: 3000 }, heading: 0, team: 'neutral' }),
      createShip({ id: 'n3', cls: 'faehre', name: 'N3', pos: { x: 9000, y: 6000 }, heading: 0, team: 'neutral' }),
    ];
    const w = createWorld(ships, 3, { layerDepth: 0, layerLoss: 0, seaState: 2 });
    w.time = BROADCAST_FIRST_S;
    for (let i = 0; i < 70; i++) {
      w.time += 1;
      stepCommandRadio(w, 1);
    }
    const msg = w.events.find((e) => e.kind === 'boat' && e.shipId === 'u' && 'text' in e && /KONVOI/.test(String(e.text)));
    expect(msg && 'text' in msg ? msg.text : '').toMatch(/KONVOI 2 FRACHTER.* 1 GELEITSCHIFFE\./);
  });
});
