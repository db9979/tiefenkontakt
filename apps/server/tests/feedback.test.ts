import { describe, expect, it } from 'vitest';
import { AuthStore } from '../src/auth.js';
import { FeedbackStore, feedbackSchema } from '../src/feedback.js';

describe('feedback', () => {
  it('validates, stores and lists newest first with the average', () => {
    expect(feedbackSchema.safeParse({ rating: 6 }).success).toBe(false);
    expect(feedbackSchema.safeParse({ rating: 3, tags: ['hack'] }).success).toBe(false);
    expect(feedbackSchema.safeParse({ rating: 3, text: 'x'.repeat(1001) }).success).toBe(false);
    const store = new FeedbackStore(new AuthStore(':memory:').db);
    store.add(feedbackSchema.parse({ rating: 2, tags: ['ruckeln'], text: ' Ruckelt im Sehrohr ', mission: 'fjord', side: 'east', cls: 'ssk' }), 'Kaleu', 1000);
    store.add(feedbackSchema.parse({ rating: 5 }), undefined, 2000);
    const l = store.list();
    expect(l.count).toBe(2);
    expect(l.average).toBeCloseTo(3.5);
    expect(l.rows[0]).toMatchObject({ rating: 5, callsign: undefined, tags: [] });
    expect(l.rows[1]).toMatchObject({ rating: 2, callsign: 'Kaleu', tags: ['ruckeln'], text: 'Ruckelt im Sehrohr', side: 'east' });
  });
});

describe('naval rank', () => {
  it('gives the lowest rank to negative or broken point totals instead of crashing', async () => {
    const { rankFor } = await import('../src/stats.js');
    expect(rankFor(-40)).toBe('Leutnant zur See');
    expect(rankFor(Number.NaN)).toBe('Leutnant zur See');
    expect(rankFor(800)).toBe('Korvettenkapitän');
  });
});
