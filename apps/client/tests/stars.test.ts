import { describe, expect, it } from 'vitest';
import { sunPosition } from '@tk/shared';
import { starCatalog, starPlace, sunRa } from '../src/widgets/sea3d/astro.js';

const angle = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe('night sky', () => {
  it('Polaris stands at the latitude, due north', () => {
    for (const lat of [36, 60.7, 74.7]) {
      for (const hour of [0, 7, 22]) {
        const p = starPlace(37.95, 89.264, { lat, month: 1, turn: 0 }, hour);
        expect(Math.abs(p.el - lat)).toBeLessThan(0.8);
        expect(angle(p.az, 0) * Math.cos((p.el * Math.PI) / 180)).toBeLessThan(0.8);
      }
    }
  });

  it('Vega is near the zenith at midnight in July, Sirius low in the south in January', () => {
    // Mid-July, 23:00 local solar time, 51.5° N: Vega (RA 18h37m, Dec +38.8°) on the meridian, high in the south
    const vega = starPlace(279.23, 38.78, { lat: 51.5, month: 7, turn: 0 }, 23);
    expect(vega.el).toBeGreaterThan(74);
    expect(vega.el).toBeLessThan(80);
    expect(angle(vega.az, 180)).toBeLessThan(25);
    // Mid-January at midnight, 50° N: Sirius (RA 6h45m, Dec -16.7°) just past the meridian, about 22° up
    const sirius = starPlace(101.29, -16.72, { lat: 50, month: 1, turn: 0 }, 0);
    expect(sirius.el).toBeGreaterThan(18);
    expect(sirius.el).toBeLessThan(24);
    expect(sirius.az).toBeGreaterThan(185);
    expect(sirius.az).toBeLessThan(210);
    // Gibraltar, July: Vega rises in the northeast in the evening
    expect(starPlace(279.23, 38.78, { lat: 36, month: 7, turn: 0 }, 19).az).toBeLessThan(70);
  });

  it('the sun as a star lands where sunPosition puts it', () => {
    for (const month of [1, 4, 7, 10]) {
      const dec = (Math.asin(Math.sin((23.44 * Math.PI) / 180) * Math.sin((sunRa(month) * Math.PI) / 180)) * 180) / Math.PI;
      for (const hour of [6, 12, 20]) {
        const s = starPlace(sunRa(month), dec, { lat: 60, month, turn: 0 }, hour);
        const ref = sunPosition(60, month, hour);
        expect(Math.abs(s.el - ref.el)).toBeLessThan(1);
        expect(angle(s.az, ref.az)).toBeLessThan(2);
      }
    }
  });

  it('turns with the map like the sun does', () => {
    const at = { lat: 60.7, month: 10, turn: 320 };
    const p = starPlace(37.95, 89.264, at, 2);
    expect(angle(p.az, 40)).toBeLessThan(1.5);
  });

  it('catalogue: about a thousand stars, few bright and many faint', () => {
    const c = starCatalog();
    expect(c.mag.length).toBeGreaterThan(900);
    const bright = [...c.mag].filter((m) => m < 1.5).length;
    const faint = [...c.mag].filter((m) => m > 3.5).length;
    expect(bright).toBeGreaterThan(15);
    expect(bright).toBeLessThan(30);
    expect(faint).toBeGreaterThan(bright * 20);
    // Sirius first: RA 101.29°, Dec -16.72°, V -1.46
    expect(c.mag[0]).toBeCloseTo(-1.46, 1);
    const [x, y, z] = [c.pos[0]!, c.pos[1]!, c.pos[2]!];
    expect((Math.asin(z) * 180) / Math.PI).toBeCloseTo(-16.72, 1);
    expect(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360).toBeCloseTo(101.29, 1);
  });
});
