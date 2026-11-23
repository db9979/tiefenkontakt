import { afterEach, describe, expect, it, vi } from 'vitest';
import { Lobby } from '../src/lobby.js';
import { metrics } from '../src/metrics.js';

describe('load cap', () => {
  afterEach(() => vi.restoreAllMocks());

  it('refuses new matches while the simulation keeps the server busy', () => {
    const lobby = new Lobby();
    vi.spyOn(metrics, 'simLoad').mockReturnValue(0.9);
    expect(lobby.create('Voll')).toMatch(/ausgelastet/);
    vi.spyOn(metrics, 'simLoad').mockReturnValue(0.2);
    expect(typeof lobby.create('Frei')).toBe('object');
  });

  it('measures the share of time spent in match ticks', () => {
    expect(metrics.simLoad()).toBeGreaterThanOrEqual(0);
    expect(metrics.snapshot({}).simLoad).toBeGreaterThanOrEqual(0);
  });
});
