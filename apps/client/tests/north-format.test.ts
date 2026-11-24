import { afterEach, describe, expect, it } from 'vitest';
import { gameDeg, setNorthRegion, toNorthUp, trueDeg } from '../src/north.js';
import { deg3, tdeg1, tdeg3 } from '../src/widgets/format.js';

describe('north-up degree display', () => {
  afterEach(() => setNorthRegion(undefined));

  it('shows game-frame directions as true degrees with the sea area offset', () => {
    setNorthRegion('faroebank'); // convoy route runs 320° true
    expect(tdeg3(0)).toBe('320');
    expect(tdeg3(50)).toBe('010');
    expect(tdeg1(45.5)).toBe('5,5');
    // deg3 stays a plain formatter
    expect(deg3(50)).toBe('050');
  });

  it('turns typed true degrees back into the game frame', () => {
    setNorthRegion('gibraltar'); // 88°
    for (const t of [0, 45, 88, 270, 359]) expect(trueDeg(gameDeg(t))).toBeCloseTo(t, 9);
    expect(gameDeg(88)).toBe(0);
    // A game-frame vector along the route points east (bearing 88 ≈ east) north-up
    const v = toNorthUp(0, 1);
    expect(v.x).toBeCloseTo(Math.sin((88 * Math.PI) / 180), 9);
    expect(v.y).toBeCloseTo(Math.cos((88 * Math.PI) / 180), 9);
  });

  it('procedural seabeds have no offset', () => {
    setNorthRegion(undefined);
    expect(tdeg3(123)).toBe('123');
    expect(gameDeg(123)).toBe(123);
  });
});
