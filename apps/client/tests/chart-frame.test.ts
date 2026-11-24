import { afterEach, describe, expect, it } from 'vitest';
import { headingVec } from '@tk/shared';
import { setNorthRegion } from '../src/north.js';
import { chartToScreen, chartToWorld, panDelta, screenDir } from '../src/widgets/chart-frame.js';

const c = { x: 1200, y: -3400 };
const [scale, w, h] = [40, 800, 500];

describe('north-up chart', () => {
  afterEach(() => setNorthRegion(undefined));

  it('screen ↔ world round-trips with a turned sea area', () => {
    for (const region of [undefined, 'faroebank', 'vestfjord', 'gibraltar']) {
      setNorthRegion(region);
      for (const p of [{ x: 0, y: 0 }, { x: 5000, y: 12_000 }, { x: -7300, y: 250 }]) {
        const q = chartToWorld(chartToScreen(p, c, scale, w, h), c, scale, w, h);
        expect(q.x).toBeCloseTo(p.x, 6);
        expect(q.y).toBeCloseTo(p.y, 6);
      }
    }
  });

  it('true north is straight up and the route bearing points its way', () => {
    // Gibraltar: the route (game +y) runs 088 true, so a point ahead on the route is to the right
    setNorthRegion('gibraltar');
    const ahead = chartToScreen({ x: c.x, y: c.y + 4000 }, c, scale, w, h);
    expect(ahead.x - w / 2).toBeCloseTo((4000 / scale) * Math.sin((88 * Math.PI) / 180), 6);
    expect(ahead.y - h / 2).toBeCloseTo((-4000 / scale) * Math.cos((88 * Math.PI) / 180), 6);
    // A game direction of −88° is true north: up on the screen
    const n = screenDir(-88);
    expect(n.x).toBeCloseTo(0, 9);
    expect(n.y).toBeCloseTo(-1, 9);
    // The leader of a heading points where the ship goes on the chart
    const v = headingVec(30);
    const go = chartToScreen({ x: c.x + v.x * 1000, y: c.y + v.y * 1000 }, c, scale, w, h);
    const d = screenDir(30);
    expect((go.x - w / 2) / (1000 / scale)).toBeCloseTo(d.x, 9);
    expect((go.y - h / 2) / (1000 / scale)).toBeCloseTo(d.y, 9);
  });

  it('dragging the chart moves the world under the pointer', () => {
    setNorthRegion('vestfjord');
    const m = { x: 300, y: 200 };
    const before = chartToWorld(m, c, scale, w, h);
    const dp = panDelta(37, -21, scale);
    const after = chartToWorld({ x: m.x + 37, y: m.y - 21 }, { x: c.x + dp.x, y: c.y + dp.y }, scale, w, h);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });
});
