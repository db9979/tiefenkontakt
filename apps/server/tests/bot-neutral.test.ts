import { describe, expect, it } from 'vitest';
import { createConvoy, createShip, createWorld, stepWorld, type ContactTrack } from '@tk/shared';
import { NEUTRAL_RECOGNISE_S, isNeutral, lineSetClass, newMemory } from '../src/bots/common.js';

describe('bots and neutral traffic', () => {
  it('a neutral is recognised from its own contact after a few minutes; a merchant never is', () => {
    const sub = createShip({ id: 'u', cls: 'ssk', name: 'U', team: 'east', pos: { x: 0, y: 0 }, heading: 0, speedKn: 3, depth: 40 });
    // Tanker and merchant 6 km to the north, about 15° apart
    const tanker = createShip({ id: 'n1', cls: 'tanker', name: 'N1', team: 'neutral', pos: { x: -1600, y: 6000 }, heading: 270, speedKn: 10 });
    const merchant = createShip({ id: 'm1', cls: 'merchant', name: 'M1', team: 'west', pos: { x: 0, y: 6000 }, heading: 90, speedKn: 9 });
    const w = createWorld([sub, tanker, merchant], 5, { layerDepth: 80, layerLoss: 12, seaState: 1 });
    const m = newMemory('u');
    const check = () => {
      const book = w.books.get('u')!;
      const out: Record<string, boolean> = {};
      for (const t of book.tracks()) {
        const id = book.targetIdOf(t.label);
        if (id) out[id] = isNeutral(w, sub, t, m);
      }
      return out;
    };
    while (w.time < NEUTRAL_RECOGNISE_S + 30) stepWorld(w);
    const late = check();
    expect(late.n1).toBe(true);
    expect(late.m1).toBe(false);
  });

  it('a neutral behind a convoy ship on almost the same bearing is still recognised (the old bearing check missed it)', () => {
    const sub = createShip({ id: 'u', cls: 'ssk', name: 'U', team: 'east', pos: { x: 0, y: 0 }, heading: 0, speedKn: 3, depth: 40 });
    const tanker = createShip({ id: 'n1', cls: 'tanker', name: 'N1', team: 'neutral', pos: { x: -300, y: 9000 }, heading: 270, speedKn: 4 });
    const merchant = createShip({ id: 'm1', cls: 'merchant', name: 'M1', team: 'west', pos: { x: 0, y: 5000 }, heading: 0, speedKn: 3 });
    const w = createWorld([sub, tanker, merchant], 5, { layerDepth: 80, layerLoss: 12, seaState: 1 });
    w.convoy = createConvoy([merchant], [{ x: 0, y: 40_000 }], 3);
    const m = newMemory('u');
    while (w.time < NEUTRAL_RECOGNISE_S + 30) stepWorld(w);
    const book = w.books.get('u')!;
    const res: Record<string, boolean> = {};
    for (const t of book.tracks()) {
      const id = book.targetIdOf(t.label);
      if (id) res[id] = isNeutral(w, sub, t, m);
    }
    expect(res.n1).toBe(true);
    expect(res.m1).toBe(false);
  });

  it('recognition comes from the track alone (F30): lines, optics, cues and the hold, never the true side', () => {
    const sub = createShip({ id: 'u', cls: 'ssk', name: 'U', team: 'east', pos: { x: 0, y: 0 }, heading: 0, depth: 40 });
    const w = createWorld([sub], 5, { layerDepth: 80, layerLoss: 12, seaState: 1 });
    w.time = 1000;
    const track = (tonals: number[], extra: Partial<ContactTrack> = {}): ContactTrack => ({
      label: 'S9', firstSeen: 950, lastSeen: 1000, bearing: 10, se: 10, sensors: ['hull'], history: [],
      evidence: { tonals: tonals.map((hz) => ({ hz, snr: 20 })), shaftHz: 0.5, bladeHz: 2.2 } as ContactTrack['evidence'], ...extra,
    });
    const TANKER = [9, 50, 100];
    const FREIGHTER = [50, 100, 150, 37.5];
    expect(lineSetClass(TANKER.map((hz) => ({ hz, snr: 20 })))).toBe('tanker');
    expect(lineSetClass(FREIGHTER.map((hz) => ({ hz, snr: 20 })))).toBe('merchant');
    // Tanker lines, held only 50 s and no other cue: not yet
    expect(isNeutral(w, sub, track(TANKER))).toBe(false);
    // ... held four minutes, or seen on radar: neutral (whatever ship it really is: no target in this world at all)
    expect(isNeutral(w, sub, track(TANKER, { firstSeen: 1000 - NEUTRAL_RECOGNISE_S }))).toBe(true);
    expect(isNeutral(w, sub, track(TANKER, { sensors: ['hull', 'radar'] }))).toBe(true);
    // Freighter lines: a convoy ship, however long it is held
    expect(isNeutral(w, sub, track(FREIGHTER, { firstSeen: 0 }))).toBe(false);
    // The eye decides: a ferry seen through the periscope is neutral, a freighter seen is not
    expect(isNeutral(w, sub, track([], { classified: 'faehre' }))).toBe(true);
    expect(isNeutral(w, sub, track(TANKER, { classified: 'merchant', firstSeen: 0 }))).toBe(false);
  });
});
