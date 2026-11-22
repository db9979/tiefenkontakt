import { describe, expect, it } from 'vitest';
import { createShip, createWorld, installBoats, installIncidents, installWeapons, isConvoyShip, stepWorld, whaleEmitters } from '../src/index.js';

const env = { layerDepth: 0, layerLoss: 0, seaState: 2, light: 1 };
const run = (w: ReturnType<typeof createWorld>, secs: number) => { for (let i = 0; i < secs * 10; i++) stepWorld(w); };

function world() {
  const f = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0, speedKn: 10, team: 'west' });
  const u = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 3000, y: 0 }, heading: 0, speedKn: 3, depth: 15, team: 'east' });
  const w = createWorld([f, u], 9, env);
  installWeapons(w);
  installBoats(w);
  installIncidents(w);
  return { w, f, u };
}

describe('incidents at sea', () => {
  it('a driftnet tears off a towed array and fouls a shallow boat', () => {
    const { w, f, u } = world();
    f.towedLength = f.towedOrder = 900;
    w.env.incidents!.nets.push({ x: 0, y: 300, r: 900, until: 1e9 }, { x: 3000, y: 300, r: 900, until: 1e9 });
    run(w, 2);
    expect(f.towedLength).toBe(0);
    expect(f.towedLostUntil).toBeGreaterThan(w.time);
    expect(u.snagged).toBe(true);
  });

  it('whales are noise sources for passive sonar, and neutral traffic is not convoy', () => {
    const { w } = world();
    w.env.incidents!.whales.push({ id: 'W1', x: 5000, y: 5000, heading: 0, until: 1e9 });
    expect(whaleEmitters(w)[0]?.sig).toBe('bio');
    const n = createShip({ id: 'n1', cls: 'merchant', name: 'N', pos: { x: 0, y: 0 }, heading: 0, team: 'neutral' });
    expect(isConvoyShip(n)).toBe(false);
  });

  it('something happens every 15 to 30 minutes', () => {
    const { w } = world();
    run(w, 3600);
    const st = w.env.incidents!;
    const happened = st.nets.length + st.whales.length + st.neutrals + w.events.filter((e) => e.kind === 'boat' && ['front', 'rudder', 'valve', 'gas'].includes(e.what)).length;
    expect(happened).toBeGreaterThanOrEqual(1);
  });
});
