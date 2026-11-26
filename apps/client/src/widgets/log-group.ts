import type { LogEntry } from './callouts.js';

/** Message list (side tab MELD): bursts of new-contact reports folded into one line. */

/** The log keeps this many reports; when full, routine ones go before alarms and command traffic. */
export const LOG_MAX = 120;

/** Add a report, dropping the oldest routine one when the log is full (S28: a ping flood must not push orders out). */
export function pushLog(log: LogEntry[], e: LogEntry): void {
  log.push(e);
  if (log.length <= LOG_MAX) return;
  const i = log.findIndex((x) => x.level !== 'alarm' && !x.keep);
  log.splice(i < 0 ? 0 : i, 1);
}

/** Seconds within which new-contact reports count as one burst. */
const BURST_S = 10;

/** "S1–S6" for a run of numbers with one prefix, else the labels listed: "S1–S3, E1, E2". */
export function labelRange(labels: string[]): string {
  const by = new Map<string, number[]>();
  const other: string[] = [];
  for (const l of labels) {
    const m = /^([A-Za-z]+)(\d+)$/.exec(l);
    if (!m) other.push(l);
    else by.set(m[1]!, [...(by.get(m[1]!) ?? []), Number(m[2])]);
  }
  const parts: string[] = [];
  for (const [p, ns] of by) {
    ns.sort((a, b) => a - b);
    let a = ns[0]!;
    for (let k = 1; k <= ns.length; k++) {
      if (k < ns.length && ns[k] === ns[k - 1]! + 1) continue;
      const b = ns[k - 1]!;
      parts.push(b - a >= 2 ? `${p}${a}–${p}${b}` : a === b ? `${p}${a}` : `${p}${a}, ${p}${b}`);
      a = ns[k]!;
    }
  }
  return [...parts, ...other].join(', ');
}

/** A report's text with its figures taken out: reports that differ only in bearing, range or time look alike. */
export function shape(text: string): string {
  return text.replace(/\d+(?:[,.]\d+)?°?/g, '#');
}

/**
 * Log rows in time order with bursts of new-contact reports folded into one row
 * ("6 neue Kontakte (S1–S6)"), and floods of the same report within seconds (four depth charges
 * in one second, a pinger every few seconds) folded into one row with the latest wording and the
 * count (shown "4×", S28);
 * a folded row keeps the index of the burst's last report.
 */
export function groupLog<T extends { e: LogEntry; i: number }>(rows: T[], en = false): (T | { e: LogEntry; i: number })[] {
  const out: (T | { e: LogEntry; i: number })[] = [];
  for (let k = 0; k < rows.length; k++) {
    const r = rows[k]!;
    if (r.e.group !== 'contact') {
      // The same report again and again: one row with the count
      const sh = shape(r.e.text);
      let j = k;
      while (j + 1 < rows.length && rows[j + 1]!.e.group !== 'contact' && rows[j + 1]!.e.level === r.e.level
        && rows[j + 1]!.e.time - rows[j]!.e.time <= BURST_S && shape(rows[j + 1]!.e.text) === sh) j++;
      if (j === k) out.push(r);
      else {
        const last = rows[j]!;
        out.push({ i: last.i, e: { ...last.e, count: j - k + 1 } });
        k = j;
      }
      continue;
    }
    let j = k;
    while (j + 1 < rows.length && rows[j + 1]!.e.group === 'contact' && rows[j + 1]!.e.time - r.e.time <= BURST_S) j++;
    if (j === k) {
      out.push(r);
      continue;
    }
    const burst = rows.slice(k, j + 1);
    const last = burst[burst.length - 1]!;
    const labels = burst.map((x) => x.e.label).filter((l): l is string => !!l);
    const n = burst.length;
    out.push({ i: last.i, e: { ...last.e, label: undefined, text: en ? `${n} new contacts (${labelRange(labels)})` : `${n} neue Kontakte (${labelRange(labels)})` } });
    k = j;
  }
  return out;
}
