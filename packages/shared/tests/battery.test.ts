import { describe, expect, it } from 'vitest';
import {
  CLASSES,
  PERISCOPE_DEPTH,
  batteryChargePctH,
  batteryDrainPctH,
  batteryEndurance,
  createShip,
  startBatteryPct,
  stepShip,
} from '@tk/shared';

const pctOf = (s: { cls: 'ssk' | 'ssa' | string; battery?: number }) => (100 * s.battery!) / CLASSES[s.cls as 'ssk'].battery!.capacityKnH;

function runHour(s: ReturnType<typeof createShip>, t0 = 0): void {
  for (let t = t0; t < t0 + 3600; t++) stepShip(s, 1, t);
}

describe('SSK battery (C5)', () => {
  it('drains 1 + v³/70 % per hour of the capacity', () => {
    expect(batteryDrainPctH(0)).toBe(1);
    expect(batteryDrainPctH(10)).toBeCloseTo(1 + 1000 / 70);
    const s = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: 0 }, heading: 0, speedKn: 6, depth: 80 });
    s.order.speedKn = 6;
    const before = pctOf(s);
    runHour(s);
    expect(before - pctOf(s)).toBeCloseTo(batteryDrainPctH(6), 0);
  });

  it('charges 40 − drain(v) % per hour on the snorkel', () => {
    expect(batteryChargePctH(4)).toBeCloseTo(40 - 1 - 64 / 70);
    const s = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: 0 }, heading: 0, speedKn: 4, depth: PERISCOPE_DEPTH });
    s.battery = CLASSES.ssk.battery!.capacityKnH * 0.3;
    s.snorkel = true;
    s.snorkelExt = 1;
    s.order = { heading: 0, speedKn: 4, depth: PERISCOPE_DEPTH };
    runHour(s);
    expect(pctOf(s) - 30).toBeCloseTo(batteryChargePctH(4), 0);
  });

  it('the AIP boat does not drain below its AIP speed, and shows no endurance limit there', () => {
    const s = createShip({ id: 'a', cls: 'ssa', name: 'A', pos: { x: 0, y: 0 }, heading: 0, speedKn: 4, depth: 80 });
    s.order.speedKn = 4;
    const before = s.battery;
    runHour(s);
    expect(s.battery).toBe(before);
    expect(batteryEndurance(s)).toBeUndefined();
    s.speed = 10 * 0.514444;
    expect(batteryEndurance(s)).toBeGreaterThan(0);
  });

  it('endurance at the present speed follows from charge and drain', () => {
    const s = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: 0 }, heading: 0, speedKn: 10, depth: 80 });
    s.battery = CLASSES.ssk.battery!.capacityKnH * 0.5;
    expect(batteryEndurance(s)! / 3600).toBeCloseTo(50 / batteryDrainPctH(10), 3);
  });

  it('starts 40–70 % charged, beginners at least 60 %', () => {
    expect(startBatteryPct(() => 0)).toBe(40);
    expect(startBatteryPct(() => 0.999)).toBeCloseTo(70, 1);
    expect(startBatteryPct(() => 0, true)).toBe(60);
    expect(startBatteryPct(() => 0.999, true)).toBeLessThanOrEqual(70);
  });
});
