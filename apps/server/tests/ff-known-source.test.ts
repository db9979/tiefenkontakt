import { describe, expect, it } from 'vitest';
import type { Ship, World } from '@tk/shared';
import { FastForward } from '../src/fast-forward.js';

/** A solo player in a region-less world with nothing in the books. */
function solo() {
  const w = { time: 100, ships: [], books: new Map() } as unknown as World;
  const ship = { id: 's1', alive: true, team: 'east' } as unknown as Ship;
  const ff = new FastForward({ voters: () => ['p'], shipOf: () => ship, world: () => w });
  return { ff, w };
}

describe('Zeitraffer and repeated pings (S29)', () => {
  it('stops on the first ping of a source, not on its repeats, and names the reason', () => {
    const { ff, w } = solo();
    ff.request('p', true);
    ff.alert('p', { kind: 'ping', bearing: 87 }, 100);
    expect(ff.on).toBe(false);
    expect(ff.view('p').stopped).toBe('Ortungsimpuls 087°');
    ff.request('p', true);
    // Same pinger 30 s later, a few degrees on: keeps running
    ff.alert('p', { kind: 'ping', bearing: 90 }, 130);
    expect(ff.on).toBe(true);
    // Another pinger on another bearing: stops
    w.time = 140;
    ff.alert('p', { kind: 'ping', bearing: 200 }, 140);
    expect(ff.on).toBe(false);
  });

  it('a ping heard before the fast-forward started counts as known', () => {
    const { ff } = solo();
    ff.alert('p', { kind: 'ping', bearing: 10 }, 50);
    ff.request('p', true);
    ff.alert('p', { kind: 'ping', bearing: 12 }, 80);
    expect(ff.on).toBe(true);
    // A torpedo always stops it
    ff.alert('p', 'torpedo', 90);
    expect(ff.on).toBe(false);
  });
});
