import { describe, expect, it } from 'vitest';
import { groupLog, labelRange } from '../src/widgets/log-group.js';
import type { LogEntry } from '../src/widgets/callouts.js';

const contact = (time: number, label: string): LogEntry => ({ time, label, level: 'info', text: `Neuer Kontakt ${label}, Peilung 100`, group: 'contact' });

describe('message list grouping', () => {
  it('writes label runs compactly', () => {
    expect(labelRange(['S1', 'S2', 'S3', 'S4', 'S5', 'S6'])).toBe('S1–S6');
    expect(labelRange(['S2', 'S1', 'E1', 'E2'])).toBe('S1, S2, E1, E2');
    expect(labelRange(['S1', 'S2', 'S3', 'S7', 'X'])).toBe('S1–S3, S7, X');
  });
  it('folds a burst of new-contact reports into one row', () => {
    const log: LogEntry[] = [...['S1', 'S2', 'S3', 'S4', 'S5', 'S6'].map((l) => contact(1, l)), { time: 2, level: 'warn', text: 'ESM PEILUNG 331' }, contact(104, 'E1')];
    const rows = groupLog(log.map((e, i) => ({ e, i })));
    expect(rows.map((r) => r.e.text)).toEqual(['6 neue Kontakte (S1–S6)', 'ESM PEILUNG 331', 'Neuer Kontakt E1, Peilung 100']);
    expect(rows[0]!.i).toBe(5);
    expect(groupLog([contact(0, 'S1'), contact(30, 'S2')].map((e, i) => ({ e, i }))).length).toBe(2);
  });
});
