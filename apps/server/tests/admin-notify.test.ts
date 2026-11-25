import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminMail } from '../src/admin-mail.js';
import { clientErrorReport, feedbackReport, playerReport, redact, type FeedbackItem, type ReportItem } from '../src/admin-live-mails.js';
import { AdminNotifier, MailBatch, clientError, notifyConfig } from '../src/admin-notify.js';
import type { Mail } from '../src/mailer.js';

const EVIL = `<img src=x onerror="alert(1)"> & 'q'`;
const ESCAPED = '&#60;img src=x onerror=&#34;alert(1)&#34;&#62; &#38; &#39;q&#39;';
const T = Date.UTC(2026, 10, 25, 20, 15);

function render(r: ReturnType<typeof feedbackReport>) {
  const m = adminMail('ops@example.com', r);
  expect(m.html).toContain('LAGEMELDUNG');
  expect(m.text).toContain('+++ ENDE DER NACHRICHT +++');
  expect(m.html).not.toMatch(/<img src=x/);
  return { html: m.html!, text: m.text };
}

const fb = (o: Partial<FeedbackItem> = {}): FeedbackItem => ({
  at: T, callsign: 'Seewolf', rating: 2, tags: ['fehler', 'ruckeln'], text: `Torpedo blieb hängen ${EVIL}`,
  mission: 'fjord', side: 'east', cls: 'ssk', won: false, quality: 'mittel', ...o,
});
const rep = (o: Partial<ReportItem> = {}): ReportItem => ({
  at: T, reporter: 'Seewolf', reported: `Rammer${EVIL}`, reportedId: 'g-0123456789abcdef', matchId: 'm-42',
  reason: 'Beleidigung', evidence: `Rammer: du ${EVIL}\nSeewolf: lass das`, ...o,
});

describe('feedback mail', () => {
  it('has every field, escaped in HTML and readable in text', () => {
    const r = feedbackReport([fb()], 0, 'https://tk.example/x');
    expect(r.subject).toBe('Tiefenkontakt Feedback: 2/5 von Seewolf');
    expect(r.tone).toBe('warn');
    const { html, text } = render(r);
    for (const s of [html, text]) {
      for (const v of ['★★☆☆☆ 2/5', 'Seewolf', '2026-11-25 20:15 UTC', 'Fehler, Ruckeln', 'fjord', 'Ostpakt', 'ssk', 'verloren', 'mittel', 'Torpedo blieb hängen', 'https://tk.example/']) expect(s).toContain(v);
    }
    expect(html).toContain(ESCAPED);
    expect(text).toContain(EVIL);
  });

  it('several in one mail with the average; guests and missing fields', () => {
    const r = feedbackReport([fb({ rating: 5, tags: ['super'], text: '' }), fb({ callsign: undefined, rating: 4, tags: [], mission: undefined, side: undefined, won: undefined })], 3);
    expect(r.subject).toBe('Tiefenkontakt Feedback: 2 neue (Ø 4.5)');
    const { text } = render(r);
    expect(text).toContain('Gast');
    expect(text).toContain('3 weitere');
    const second = text.slice(text.indexOf('FEEDBACK 2'));
    for (const k of ['Ausgang:', 'Mission:', 'Seite:', 'Stichworte:']) expect(second).not.toContain(k);
  });
});

describe('player report mail', () => {
  it('has every field and the evidence as a log', () => {
    const r = playerReport([rep()], 0, 'https://tk.example');
    expect(r.subject).toBe(`Tiefenkontakt Meldung: Seewolf meldet Rammer${EVIL}`);
    const { html, text } = render(r);
    for (const s of [html, text]) for (const v of ['g-0123456789abcdef', 'Seewolf', 'Beleidigung', 'm-42', '2026-11-25 20:15 UTC', 'lass das']) expect(s).toContain(v);
    expect(html).toContain(`Rammer${ESCAPED}`);
    expect(playerReport([rep(), rep()]).subject).toBe('Tiefenkontakt Meldungen: 2 neue');
  });
});

describe('client error mail', () => {
  it('groups by message, counts, and keeps tokens out', () => {
    const e = (msg: string, o = {}) => ({ at: T, msg, stack: `Error: ${msg}\n    at tick (main.js:1:2)`, where: '#reset=SECRETTOKEN123', ua: 'Firefox/130', user: 'Seewolf', ...o });
    const r = clientErrorReport([e('TypeError: x is undefined'), e('TypeError: x is undefined', { user: undefined, ua: 'Safari/17' }), e(`Boom ${EVIL}`)], 2);
    expect(r.subject).toBe('Tiefenkontakt Client-Fehler: 5 (2 verschiedene)');
    const { html, text } = render(r);
    for (const s of [html, text]) {
      expect(s).not.toContain('SECRETTOKEN123');
      for (const v of ['TypeError: x is undefined', '#reset=…', 'Firefox/130', 'Safari/17', 'main.js:1:2', 'Seewolf']) expect(s).toContain(v);
    }
    expect(html).toContain(ESCAPED);
  });

  it('redacts tokens in any form', () => {
    expect(redact('https://x/#verify=abcDEF_123-x and ?token=t0k&x=1 tk_session=s3')).toBe('https://x/#verify=… and ?token=…&x=1 tk_session=…');
  });

  it('cuts the posted body to size', () => {
    const c = clientError({ msg: 'x'.repeat(500), stack: 5, where: '#lobby' }, 'UA', 'Kap', T);
    expect(c).toEqual({ at: T, msg: 'x'.repeat(300), stack: undefined, where: '#lobby', ua: 'UA', user: 'Kap' });
  });
});

describe('collecting', () => {
  afterEach(() => vi.useRealTimers());

  it('sends the first item at once and the rest together after the gap', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const out: [number[], number][] = [];
    const b = new MailBatch<number>(60_000, (items, dropped) => void out.push([items, dropped]), 2);
    b.push(1);
    expect(out).toEqual([[[1], 0]]);
    b.push(2);
    b.push(3);
    b.push(4);
    expect(out).toHaveLength(1);
    expect(b.pending).toBe(3);
    vi.advanceTimersByTime(60_000);
    expect(out[1]).toEqual([[2, 3], 1]);
    vi.advanceTimersByTime(600_000);
    expect(out).toHaveLength(2);
  });

  it('settings: recipient, switch, skipped kinds and gaps', () => {
    const c = notifyConfig({ MAIL_FROM: 'a@x.de', ADMIN_MAIL_SKIP: 'Fehler', ADMIN_MAIL_FEEDBACK_MIN: '0', PUBLIC_URL: 'https://tk.example' });
    expect(c.to).toBe('a@x.de');
    expect([...c.kinds]).toEqual(['feedback', 'meldung']);
    expect(c.gapMs).toEqual({ feedback: 0, meldung: 5 * 60_000, fehler: 60 * 60_000 });
    expect(notifyConfig({ ADMIN_MAIL_TO: 'm@x.de', ALERT_TO: 'o@x.de' }).to).toBe('m@x.de');
    expect(notifyConfig({ ADMIN_MAIL: '0', MAIL_FROM: 'a@x.de' }).kinds.size).toBe(0);
  });

  it('notifier mails each kind to the admin, nothing without recipient or when skipped', async () => {
    const sent: Mail[] = [];
    const mailer = { send: async (m: Mail) => void sent.push(m) };
    const n = new AdminNotifier(mailer, notifyConfig({ ADMIN_MAIL_TO: 'mod@x.de', ADMIN_MAIL_SKIP: 'fehler', PUBLIC_URL: 'https://tk.example' }));
    n.feedback({ rating: 5, tags: [], text: 'Klasse' }, 'Seewolf');
    n.report(rep());
    n.clientError({ at: T, msg: 'boom' });
    await Promise.all(n.pending);
    expect(sent.map((m) => [m.to, m.subject])).toEqual([
      ['mod@x.de', 'Tiefenkontakt Feedback: 5/5 von Seewolf'],
      ['mod@x.de', `Tiefenkontakt Meldung: Seewolf meldet Rammer${EVIL}`],
    ]);
    expect(sent.every((m) => m.html && m.text && m.inline?.length === 1)).toBe(true);
    const quiet = new AdminNotifier(mailer, notifyConfig({}));
    quiet.feedback({ rating: 1, tags: [], text: '' });
    expect(quiet.feedbackBatch.pending).toBe(0);
  });
});
