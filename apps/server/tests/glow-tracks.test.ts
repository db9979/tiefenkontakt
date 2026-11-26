import { describe, expect, it } from 'vitest';
import { createShip, createWorld, installWeapons, type Environment, type Torpedo } from '@tk/shared';
import { glowTracksFor } from '../src/glow-tracks.js';

const NIGHT: Environment = { layerDepth: 120, layerLoss: 12, seaState: 2, light: 0.02, lat: 44, month: 8, seed: 7 };

function scene(env: Environment, depth = 12) {
  const own = createShip({ id: 'f', cls: 'ffg', team: 'west', name: 'F', pos: { x: 0, y: 0 }, heading: 0 });
  const boat = createShip({ id: 'u', cls: 'ssk', team: 'east', name: 'U', pos: { x: 0, y: 5000 }, heading: 180, depth: 40 });
  const w = createWorld([own, boat], 1, env);
  const st = installWeapons(w);
  const t = { id: 'T1', kind: 'heavy', ownerId: 'u', pos: { x: 300, y: 900 }, depth, heading: 180, speedKn: 40, searchDepth: depth, enableAfter: 0, mode: 'active', run: 0, maxRun: 20000, wire: false, launchedAt: 0, alerted: [] } as unknown as Torpedo;
  st.torpedoes.push(t);
  return { w, own, t };
}

describe('glowing torpedo tracks for the bridge view', () => {
  it('a running torpedo near a frigate on a dark night in a bloom: its recent path, newest point last', () => {
    const { w, own, t } = scene(NIGHT);
    for (let i = 0; i < 10; i++) {
      glowTracksFor(w, own);
      t.pos.y -= 40;
      w.time += 2;
    }
    const g = glowTracksFor(w, own)!;
    expect(g).toHaveLength(1);
    expect(g[0]!.k).toBeGreaterThan(0.1);
    expect(g[0]!.pts.length).toBeGreaterThanOrEqual(20);
    expect(g[0]!.pts.slice(-2)).toEqual([300, Math.round(t.pos.y)]);
  });

  it('nothing by day, in winter Arctic water, from a deep runner or for a boat', () => {
    const day = scene({ ...NIGHT, light: 1 });
    expect(glowTracksFor(day.w, day.own)).toBeUndefined();
    const arctic = scene({ ...NIGHT, lat: 75, month: 1 });
    expect(glowTracksFor(arctic.w, arctic.own)).toBeUndefined();
    const deep = scene(NIGHT, 120);
    expect(glowTracksFor(deep.w, deep.own)).toBeUndefined();
    const sub = scene(NIGHT);
    expect(glowTracksFor(sub.w, sub.w.ships[1]!)).toBeUndefined();
  });
});
