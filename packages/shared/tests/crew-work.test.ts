import { describe, expect, it } from 'vitest';
import {
  PERISCOPE_DEPTH, createShip, createWorld, crewOf, fireTorpedo, installBoats, installWeapons, stepWorld, type Environment, type World,
} from '../src/index.js';

const env: Environment = { layerDepth: 0, layerLoss: 0, seaState: 2, light: 1 };
const run = (w: World, secs: number) => { for (let i = 0; i < secs * 10; i++) stepWorld(w); };
const mishaps = (w: World) => w.events.filter((e) => e.kind === 'transient' && e.what === 'mishap');

function world(depth = 100) {
  const u = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: 0 }, heading: 0, speedKn: 4, depth, team: 'east' });
  u.order = { heading: 0, speedKn: 4, depth };
  const w = createWorld([u], 5, env);
  installWeapons(w);
  installBoats(w);
  return { w, u };
}

describe('crew simplifications (C16)', () => {
  it('no random mishaps: a quiet boat stays quiet for hours', () => {
    const { w, u } = world();
    crewOf(u).fatigue = 1;
    crewOf(u).morale = 0;
    run(w, 4 * 3600);
    expect(mishaps(w)).toHaveLength(0);
  });

  it('under silent running a reload and the trim pumps are heard', () => {
    const { w, u } = world();
    crewOf(u).silent = true;
    fireTorpedo(w, u, { heading: 90 });
    run(w, 5);
    const texts = w.events.filter((e) => e.kind === 'boat' && e.what === 'mishap').map((e) => (e as { text: string }).text);
    expect(texts).toContain('NACHLADEN IST LAUT · RUHE IM BOOT GESTÖRT');
    expect(texts).toContain('TRIMMPUMPEN LAUFEN · HÖRBAR');
    expect(mishaps(w).length).toBe(2);
  });

  it('without silent running reloading and trimming make no transient', () => {
    const { w, u } = world();
    fireTorpedo(w, u, { heading: 90 });
    run(w, 5);
    expect(mishaps(w)).toHaveLength(0);
  });

  it('a crash dive from periscope depth at speed is heard once', () => {
    const { w, u } = world(PERISCOPE_DEPTH);
    u.order = { heading: 0, speedKn: 17, depth: 150 };
    run(w, 60);
    expect(mishaps(w)).toHaveLength(1);
    expect(w.events.some((e) => e.kind === 'boat' && (e as { text?: string }).text === 'SCHNELLTAUCHEN · FLUTEN UND KLAPPERN IM BOOT')).toBe(true);
  });

  it('an alarm calls battle stations on its own; they stand down after a quiet spell', () => {
    const { w, u } = world();
    expect(crewOf(u).battle).toBe(false);
    w.events.push({ kind: 'torpedo_alert', time: w.time, shipId: 'u', bearing: 90 });
    run(w, 1);
    expect(crewOf(u).battle).toBe(true);
    expect(w.events.some((e) => e.kind === 'boat' && e.what === 'battle')).toBe(true);
    run(w, 1300);
    expect(crewOf(u).battle).toBe(false);
  });

  it('battle stations the captain called himself stay', () => {
    const { w, u } = world();
    crewOf(u).battle = true;
    w.events.push({ kind: 'torpedo_alert', time: w.time, shipId: 'u', bearing: 90 });
    run(w, 1300);
    expect(crewOf(u).battle).toBe(true);
  });
});
