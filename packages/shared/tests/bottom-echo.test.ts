import { describe, expect, it } from 'vitest';
import { REGIONS, bottomFeatures, createShip, createWorld, encodeGrid, registerGrid, runSensors, type Environment } from '../src/index.js';

/** A flat 300 m bottom round the Messina origin with one rock pinnacle rising to 60 m. */
function chart(): void {
  const r = REGIONS.messina;
  const n = 400, d = 0.002;
  const z = new Int16Array(n * n).fill(-300);
  // Pinnacle about 3 km along the route (bearing 180: south of the origin)
  const pi = Math.round((r.lat - 3000 / 111_320 - (r.lat - (n / 2) * d)) / d), pj = n / 2;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) z[(pi + i) * n + pj + j] = i === 0 && j === 0 ? -60 : -180;
  registerGrid('messina', encodeGrid({ lat0: r.lat - (n / 2) * d, lon0: r.lon - (n / 2) * d, dLat: d, dLon: d, nLat: n, nLon: n, z }));
}

describe('bottom echoes', () => {
  it('a rock pinnacle is a feature and answers a ping with no Doppler', () => {
    chart();
    const env: Environment = { layerDepth: 0, layerLoss: 0, seaState: 2, seabed: { kind: 'fjord', seed: 9, region: 'messina' } };
    const feats = bottomFeatures(env.seabed);
    expect(feats.some((f) => f.kind === 'fels' && f.depth < 120)).toBe(true);
    const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0, speedKn: 5, team: 'west' });
    ffg.activeSonar = true;
    const w = createWorld([ffg], 3, env);
    const dets = runSensors({ ships: w.ships, env, time: 100, rng: w.rng });
    const rock = dets.filter((d) => d.sensor === 'active' && d.targetId.startsWith('R'));
    expect(rock.length).toBeGreaterThan(0);
    expect(rock.every((d) => d.dopplerKn === 0)).toBe(true);
  });
});
