import { describe, expect, it } from 'vitest';
import { adminMail, safeUrl, type AdminReport, type MailContent } from '../src/admin-mail.js';
import { Watchdog, watchdogConfig, type WatchdogProbes } from '../src/watchdog.js';
import { arenaReport, operatorAlert, restoreReport, textBlocks, watchdogAlert, watchdogDaily, watchdogRecovered } from '../src/admin-mails.js';
import { mimeBody } from '../src/mailer.js';
import { verifyMail } from '../src/mail-templates.js';

const EVIL = `<script>alert("x")</script> & 'q'`;
const ESCAPED = '&#60;script&#62;alert(&#34;x&#34;)&#60;/script&#62; &#38; &#39;q&#39;';

/** Renders and checks what every operator mail must have. */
function render(r: AdminReport) {
  const m = adminMail('ops@example.com', r);
  expect(m.to).toBe('ops@example.com');
  expect(m.subject).toBe(r.subject);
  expect(m.html).toMatch(/^<!DOCTYPE html>/);
  expect(m.html).toContain('LAGEMELDUNG');
  expect(m.html).toContain('cid:sonar-header@tiefenkontakt');
  expect(m.inline?.[0]?.cid).toBe('sonar-header@tiefenkontakt');
  expect(m.text).toContain('+++ ENDE DER NACHRICHT +++');
  expect(m.text).toContain(`BETR: ${r.title}`);
  return { m, html: m.html!, text: m.text };
}

describe('operator mail frame', () => {
  it('escapes every text field in the HTML and keeps it raw in the text part', () => {
    const { html, text } = render({
      subject: EVIL, tone: 'alarm', precedence: EVIL, from: EVIL, title: EVIL, headline: EVIL, summary: EVIL, site: EVIL,
      blocks: [
        { kind: 'rows', title: EVIL, rows: [[EVIL, EVIL, 'warn']] },
        { kind: 'table', title: EVIL, head: [EVIL], rows: [[EVIL]] },
        { kind: 'log', title: EVIL, lines: [EVIL] },
        { kind: 'text', title: EVIL, paras: [EVIL] },
      ],
      links: [{ label: EVIL, url: 'https://example.com/?a="><b>' }],
      footer: [EVIL],
    });
    expect(html).not.toContain('<script');
    expect(html).not.toContain('"><b>');
    expect(html).toContain(ESCAPED);
    expect(text).toContain(EVIL);
  });

  it('drops links that are not http(s)', () => {
    expect(safeUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeUrl('data:text/html,x')).toBeUndefined();
    expect(safeUrl('nonsense')).toBeUndefined();
    expect(safeUrl('https://tk.example/x')).toBe('https://tk.example/x');
    const { html, text } = render({
      subject: 's', tone: 'info', precedence: 'ROUTINE', from: 'F', title: 'T', headline: 'H', blocks: [],
      links: [{ label: 'BAD', url: 'javascript:alert(1)' }, { label: 'GOOD', url: 'https://tk.example/' }], footer: [],
    });
    expect(html).not.toContain('javascript:');
    expect(text).not.toContain('BAD');
    expect(html).toContain('href="https://tk.example/"');
    expect(text).toContain('GOOD: https://tk.example/');
  });

  it('is sent as multipart text + HTML with the header picture', () => {
    const { m } = render(operatorAlert('Tiefenkontakt ALARM: Server antwortet nicht (pi)', 'kaputt'));
    const body = mimeBody(m).join('\r\n');
    expect(body).toContain('multipart/alternative');
    expect(body).toContain('Content-Type: text/plain; charset=utf-8');
    expect(body).toContain('Content-Type: text/html; charset=utf-8');
    expect(body).toContain('Content-ID: <sonar-header@tiefenkontakt>');
  });

  it('puts only the origin of PUBLIC_URL into links, never credentials or queries', () => {
    const { html, text } = render(watchdogAlert({ site: 'S', label: 'L', detail: 'D', since: 0, gapH: 6, url: 'https://admin:geheim@tk.example/x?token=abc' }));
    for (const s of [html, text]) {
      expect(s).not.toContain('geheim');
      expect(s).not.toContain('token');
      expect(s).toContain('https://tk.example/api/health');
    }
  });
});

describe('watchdog mails', () => {
  it('alert: label, reading, start time, reminder and links', () => {
    const r = watchdogAlert({ site: 'Tiefenkontakt (tk.example)', label: 'Wenig freier Speicherplatz', detail: `3.0 GB frei ${EVIL}`, since: Date.UTC(2026, 10, 25, 7), gapH: 6, url: 'https://tk.example' });
    expect(r.subject).toBe('Tiefenkontakt (tk.example) ALARM: Wenig freier Speicherplatz');
    const { html, text } = render(r);
    for (const s of [html, text]) {
      expect(s).toContain('Wenig freier Speicherplatz');
      expect(s).toContain('2026-11-25T07:00:00.000Z');
      expect(s).toContain('frühestens in 6 h');
      expect(s).toContain('https://tk.example/');
    }
    expect(html).toContain(`3.0 GB frei ${ESCAPED}`);
    expect(text).toContain(`3.0 GB frei ${EVIL}`);
    expect(html).not.toContain('<script');
  });

  it('recovery: now, before and duration', () => {
    const r = watchdogRecovered({ site: 'Tiefenkontakt', label: 'Hoher Speicherverbrauch', now: '300 MB RSS', before: '900 MB RSS', duration: '2 h 5 min' });
    expect(r.subject).toBe('Tiefenkontakt wieder OK: Hoher Speicherverbrauch');
    const { html, text } = render(r);
    for (const s of [html, text]) for (const v of ['Entwarnung', '300 MB RSS', '900 MB RSS', '2 h 5 min']) expect(s).toContain(v);
  });

  it('daily report: open warnings, game status and every reading', () => {
    const r = watchdogDaily({
      site: 'Tiefenkontakt', active: ['Kein frisches Backup'], status: { Partien: 2, Spieler: 5 },
      readings: [['Speicherplatz', '40 GB frei'], ['Speicher', '120 MB RSS'], ['Event-Loop', '3 ms (p99)'], ['Spieltakt', 'keine Partie'], ['Backup', '3.0 h alt']],
    });
    expect(r.subject).toBe('Tiefenkontakt Tagesbericht: 1 offene Warnung(en)');
    const { html, text } = render(r);
    for (const s of [html, text]) {
      for (const v of ['Kein frisches Backup', 'Partien', 'Spieler', '40 GB frei', '120 MB RSS', '3 ms (p99)', 'keine Partie', '3.0 h alt']) expect(s).toContain(v);
    }
    expect(watchdogDaily({ site: 'T', active: [], status: {}, readings: [] }).subject).toBe('T Tagesbericht: alles OK');
  });
});

describe('watchdog sends the styled mails', () => {
  it('alert content carries text, HTML and the header picture', async () => {
    const sent: MailContent[] = [];
    const probes: WatchdogProbes = {
      disk: () => ({ free: 1e9, total: 100e9 }), rssMb: () => 100, lagMs: () => 1, tickMs: () => undefined, backupAgeH: () => undefined, status: () => ({}),
    };
    const w = new Watchdog(probes, async (m) => void sent.push(m), watchdogConfig({}), 'Tiefenkontakt (tk.example)', 'https://tk.example');
    w.check(0);
    await Promise.all(w.pending);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe('Tiefenkontakt (tk.example) ALARM: Wenig freier Speicherplatz');
    expect(sent[0]!.html).toContain('Wenig freier Speicherplatz');
    expect(sent[0]!.html).toContain('https://tk.example/api/health');
    expect(sent[0]!.text).toContain('1.0 GB frei');
    expect(sent[0]!.inline).toHaveLength(1);
  });
});

describe('host health-check alert', () => {
  const body = `http://localhost:8787/api/health antwortet seit etwa 12 min nicht (3 Prüfungen in Folge).
Maßnahme: Container neu gestartet (Neustart 1 von höchstens 3)

docker compose ps:
NAME   STATUS
tk-1   Restarting

Letzte Logzeilen:
${EVIL}
Error: boom`;

  it('splits key lines into rows and command output into log blocks', () => {
    const b = textBlocks(body);
    expect(b.map((x) => x.kind)).toEqual(['text', 'rows', 'log', 'log']);
    expect(b[1]).toEqual({ kind: 'rows', rows: [['Maßnahme', 'Container neu gestartet (Neustart 1 von höchstens 3)']] });
    expect(b[2]).toMatchObject({ title: 'docker compose ps', lines: ['NAME   STATUS', 'tk-1   Restarting'] });
  });

  it('alarm and recovery tone from the subject, every line kept', () => {
    const r = operatorAlert('Tiefenkontakt ALARM: Server antwortet nicht (pi)', body, 'https://tk.example');
    expect(r.tone).toBe('alarm');
    expect(operatorAlert('Tiefenkontakt wieder erreichbar (pi)', 'x').tone).toBe('ok');
    const { html, text } = render(r);
    for (const s of [html, text]) for (const v of ['12 min', 'Container neu gestartet', 'tk-1   Restarting', 'Error: boom']) expect(s).toContain(v);
    expect(html).toContain(ESCAPED);
    expect(html).not.toContain('<script');
  });
});

describe('arena report', () => {
  const output = [
    'groenland west   42 min | Frachter 3 (FK 0) | U-Boote 1 | Eskorten 0 | Torpedos 4 Raketen 1 Bojen 2 SSM 0/0 Funk 3 | FK 0/0 Minen 0/0/F0 | Befehle W 1/1 O 0/1 | Konvoi durch | 812 ms',
    'schelf    east   37 min | Frachter 5 (FK 1) | U-Boote 0 | Eskorten 1 | Torpedos 6 Raketen 0 Bojen 0 SSM 1/1 Funk 1 | FK 2/1 Minen 4/1/F1 | Befehle W 0/1 O 1/1 | Konvoi versenkt | 790 ms',
    'Bilanz: Westbund 1 · Ostpakt 1 · Ø Ortung West 4200 m, Ost 3100 m | Befehle erfüllt/nicht: W 1/1 O 1/1',
    'Missionen: groenland 1:0 (Minentreffer Frachter 0) · schelf 0:1 (Minentreffer Frachter 1)',
    'Balance außerhalb des Bands: West 50 %',
  ];

  it('summary, per-mission table, every game and other lines', () => {
    const r = arenaReport({ games: 2, minutes: 3, band: 0.35, ok: true, output });
    expect(r.subject).toBe('Tiefenkontakt Arena: 1:1 · im Band');
    const { html, text } = render(r);
    for (const s of [html, text]) {
      for (const v of ['Westbund 1 : Ostpakt 1', '50 % (erlaubt 35–65 %)', '4200 m', 'W 1/1 O 1/1', 'groenland', 'schelf', 'Konvoi durch', 'Konvoi versenkt', 'Balance außerhalb des Bands']) expect(s).toContain(v);
    }
  });

  it('marks a run outside the band and one without a result', () => {
    expect(arenaReport({ games: 2, minutes: 3, band: 0.35, ok: false, output }).subject).toBe('Tiefenkontakt Arena: 1:1 · AUSSERHALB DES BANDS');
    const broken = arenaReport({ games: 2, minutes: 0, band: 0.35, ok: false, output: [`Error: ${EVIL}`] });
    expect(broken.subject).toBe('Tiefenkontakt Arena: ? · AUSSERHALB DES BANDS');
    const { html, text } = render(broken);
    expect(text).toContain(EVIL);
    expect(html).toContain(ESCAPED);
  });
});

describe('restore test report', () => {
  const lines = [
    'Restore-Test 2026-11-22T04:15:00.000Z', 'Backup: /backups/tiefenkontakt-20261122-030000.db (2.1 MB, 1.2 h alt)',
    '✓ integrity_check ok', '! Spiegel ist nicht aktuell: neuestes dort tiefenkontakt-20261121-030000.db', '',
    'Zeilen       Backup      Live   (Live: /data/tiefenkontakt.db)', '  users                 12        12', '  results              340       341', '',
    '✓ Server mit dem Backup antwortet', 'Dauer 4.2 s',
  ];

  it('result, warnings, row counts and the full log', () => {
    const r = restoreReport({ passed: true, failures: [], warnings: ['Spiegel ist nicht aktuell: neuestes dort tiefenkontakt-20261121-030000.db'], lines });
    expect(r.subject).toBe('Tiefenkontakt Restore-Test: OK (1 Hinweis(e))');
    expect(r.blocks.find((b) => b.kind === 'table')).toMatchObject({ head: ['Tabelle', 'Backup', 'Live'], rows: [['users', '12', '12'], ['results', '340', '341']] });
    const { html, text } = render(r);
    for (const s of [html, text]) for (const v of ['bestanden', 'tiefenkontakt-20261122-030000.db', '4.2 s', 'Spiegel ist nicht aktuell', 'integrity_check ok', 'results']) expect(s).toContain(v);
  });

  it('failure', () => {
    const r = restoreReport({ passed: false, failures: [`Tabellen fehlen im Backup: ${EVIL}`], warnings: [], lines: [`✗ Tabellen fehlen im Backup: ${EVIL}`] });
    expect(r.subject).toBe('Tiefenkontakt Restore-Test: FEHLGESCHLAGEN');
    const { html, text } = render(r);
    expect(text).toContain('FEHLGESCHLAGEN');
    expect(html).toContain(ESCAPED);
    expect(html).not.toContain('<script');
  });
});

describe('player mails on the shared frame', () => {
  it('escapes the callsign in HTML and keeps it readable in the text part', () => {
    const m = verifyMail('a@b.de', '<b>Kap</b>', 'https://tk.example/#verify=abc');
    expect(m.html).not.toContain('<b>Kap</b>');
    expect(m.html).toContain('&#60;b&#62;Kap&#60;/b&#62;');
    expect(m.text).toContain('Kapitän <b>Kap</b>.');
    expect(m.html).toContain('FUNKSPRUCH');
  });
});
