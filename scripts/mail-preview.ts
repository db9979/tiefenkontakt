/**
 * Renders every mail the server sends (player and operator) with sample data into HTML
 * files, the inline header picture embedded, plus index.html linking them all. Nothing is sent.
 *   node --import tsx scripts/mail-preview.ts [out folder=mail-preview]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { adminMail } from '../apps/server/src/admin-mail.js';
import { arenaReport, operatorAlert, restoreReport, watchdogAlert, watchdogDaily, watchdogRecovered } from '../apps/server/src/admin-mails.js';
import { clientErrorReport, feedbackReport, playerReport } from '../apps/server/src/admin-live-mails.js';
import type { Mail } from '../apps/server/src/mailer.js';
import { resetMail, testMail, verifyMail } from '../apps/server/src/mail-templates.js';

const out = resolve(process.argv[2] ?? 'mail-preview');
const url = 'https://tiefenkontakt.example';
const site = 'Tiefenkontakt (tiefenkontakt.example)';
const to = 'admin@example.com';
const H = 3_600_000;

const mails: [string, Mail][] = [
  ['spieler-bestaetigen', verifyMail('kap@example.com', 'Seewolf', `${url}/#verify=BEISPIEL`)],
  ['spieler-passwort', resetMail('kap@example.com', 'Seewolf', `${url}/#reset=BEISPIEL`)],
  ['testmail', testMail(to, url)],
  ['wachdienst-alarm', adminMail(to, watchdogAlert({ site, label: 'Wenig freier Speicherplatz', detail: '3.0 GB frei von 100.0 GB (3.0 %) in /data; Grenze: 10 % / 1.0 GB', since: Date.now() - 2 * H, gapH: 6, url }))],
  ['wachdienst-entwarnung', adminMail(to, watchdogRecovered({ site, label: 'Backup fehlgeschlagen', now: 'Backup tiefenkontakt-20261125-030000.db geschrieben', before: 'Fehler: disk I/O error', duration: '1 Tage 0 h', url }))],
  ['wachdienst-tagesbericht', adminMail(to, watchdogDaily({
    site, active: ['Kein frisches Backup'], status: { Partien: 3, Spieler: 7, 'Konten': 128 }, url,
    readings: [['Speicherplatz', '41.2 GB frei von 100.0 GB (41.2 %) in /data'], ['Speicher', '182 MB RSS'], ['Event-Loop', '4 ms (p99)'], ['Spieltakt', '1.7 ms (p95)'], ['Backup', '50.3 h alt']],
  }))],
  ['healthcheck-alarm', adminMail(to, operatorAlert('Tiefenkontakt ALARM: Server antwortet nicht (speech)', `http://localhost:8787/api/health antwortet seit etwa 12 min nicht (3 Prüfungen in Folge).
Maßnahme: Container neu gestartet (Neustart 1 von höchstens 3)

docker compose ps:
NAME                         STATUS
tiefenkontakt-tiefenkontakt-1   Restarting (1) 5 seconds ago

Letzte Logzeilen:
tiefenkontakt-1  | [ERROR] Uncaught <TypeError>: Cannot read properties of undefined (reading 'slots')
tiefenkontakt-1  |     at Match.tick (match.ts:412)`, url))],
  ['healthcheck-entwarnung', adminMail(to, operatorAlert('Tiefenkontakt wieder erreichbar (speech)', `Der Server antwortet wieder auf http://localhost:8787/api/health.
Ausfall: etwa 17 min, 4 fehlgeschlagene Prüfungen, 1 automatische(r) Neustart(s).`, url))],
  ['arena-bericht', adminMail(to, arenaReport({
    games: 4, minutes: 6, band: 0.35, ok: true, url, output: [
      'groenland west   42 min | Frachter 3 (FK 0) | U-Boote 1 | Eskorten 0 | Torpedos 4 Raketen 1 Bojen 2 SSM 0/0 Funk 3 | FK 0/0 Minen 0/0/F0 | Befehle W 1/1 O 0/1 | Konvoi durchgekommen | 812 ms',
      'schelf    east   37 min | Frachter 5 (FK 1) | U-Boote 0 | Eskorten 1 | Torpedos 6 Raketen 0 Bojen 0 SSM 1/1 Funk 1 | FK 2/1 Minen 4/1/F1 | Befehle W 0/1 O 1/1 | Konvoi zerschlagen | 790 ms',
      'fjord     west   51 min | Frachter 1 (FK 0) | U-Boote 2 | Eskorten 0 | Torpedos 3 Raketen 2 Bojen 4 SSM 0/0 Funk 2 | FK 0/0 Minen 0/0/F0 | Befehle W 1/1 O 0/1 | alle U-Boote verloren | 905 ms',
      'hafen     east   29 min | Frachter 4 (FK 0) | U-Boote 0 | Eskorten 2 | Torpedos 8 Raketen 0 Bojen 1 SSM 0/0 Funk 0 | FK 0/0 Minen 2/0/F0 | Befehle W 0/1 O 1/1 | Zeit abgelaufen | 701 ms',
      'Bilanz: Westbund 2 · Ostpakt 2 · Ø Ortung West 4200 m, Ost 3100 m | Befehle erfüllt/nicht: W 2/2 O 2/2',
      'Missionen: groenland 1:0 (Minentreffer Frachter 0) · schelf 0:1 (Minentreffer Frachter 1) · fjord 1:0 (Minentreffer Frachter 0) · hafen 0:1 (Minentreffer Frachter 0)',
    ],
  }))],
  ['restore-test', adminMail(to, restoreReport({
    passed: true, failures: [], warnings: ['Spiegel ist nicht aktuell: neuestes dort tiefenkontakt-20261121-030000.db'], url, lines: [
      'Restore-Test 2026-11-22T04:15:00.000Z', 'Backup: /backups/tiefenkontakt-20261122-030000.db (2.1 MB, 1.2 h alt)',
      '! Spiegel ist nicht aktuell: neuestes dort tiefenkontakt-20261121-030000.db', '✓ integrity_check ok', '✓ alle Pflichttabellen vorhanden', '',
      'Zeilen       Backup      Live   (Live: /data/tiefenkontakt.db)', '  badges                 41        41', '  campaign_runs           9         9',
      '  matches               212       214', '  ratings                55        55', '  results               340       344', '  users                  128       128', '',
      '✓ Server mit dem Backup antwortet auf /api/health', '✓ /api/leaderboard: 20 Einträge', 'Dauer 4.2 s',
    ],
  }))],
  ['restore-test-fehler', adminMail(to, restoreReport({
    passed: false, failures: ['integrity_check: *** in database main *** Page 12: btreeInitPage() returns error code 11'], warnings: [], url,
    lines: ['Restore-Test 2026-11-22T04:15:00.000Z', 'Backup: /backups/tiefenkontakt-20261122-030000.db (2.1 MB, 1.2 h alt)', '✗ integrity_check: *** in database main *** Page 12: btreeInitPage() returns error code 11', 'Dauer 0.8 s'],
  }))],
  ['feedback', adminMail(to, feedbackReport([{
    at: Date.now() - 600_000, callsign: 'Seewolf', rating: 2, tags: ['fehler', 'ruckeln'], mission: 'fjord', side: 'east', cls: 'ssk', won: false, quality: 'mittel',
    text: 'Nach dem zweiten Torpedo blieb das Feuerleitpult hängen, erst ein Neuladen half. Sonst sehr stimmungsvoll!',
  }, { at: Date.now() - 120_000, rating: 5, tags: ['super'], text: '', mission: 'groenland', side: 'west', cls: 'ffg', won: true, quality: 'hoch' }], 0, url))],
  ['meldung', adminMail(to, playerReport([{
    at: Date.now() - 60_000, reporter: 'Seewolf', reported: 'Rammbock', reportedId: 'g-3f9a1c0d2b7e4a51', matchId: 'm-8c21f0', reason: 'Beleidigung im Funk',
    evidence: '20:14 Rammbock: ihr seid alle zu blöd zum Tauchen\n20:15 Seewolf: lass das bitte\n20:15 Rammbock: heul doch',
  }], 0, url))],
  ['client-fehler', adminMail(to, clientErrorReport([
    ...[1, 2, 3, 4, 5, 6].map((i) => ({ at: Date.now() - i * 300_000, msg: "TypeError: Cannot read properties of undefined (reading 'bearing')",
      stack: "TypeError: Cannot read properties of undefined (reading 'bearing')\n    at drawContacts (index-3fa1.js:1:48211)\n    at frame (index-3fa1.js:1:50112)",
      where: i % 2 ? '#lobby' : '#reset=abcDEFghiJKL123', ua: i % 2 ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1) Safari/604.1' : 'Mozilla/5.0 Firefox/132.0', user: i % 3 ? 'Seewolf' : undefined })),
    { at: Date.now(), msg: 'Uncaught RangeError: Maximum call stack size exceeded', where: '/', ua: 'Chrome/131' },
  ], 0, url))],
];

mkdirSync(out, { recursive: true });
const items: string[] = [];
for (const [name, m] of mails) {
  let html = m.html ?? `<pre>${m.text}</pre>`;
  for (const img of m.inline ?? []) html = html.replaceAll(`cid:${img.cid}`, `data:${img.type};base64,${img.data.toString('base64')}`);
  writeFileSync(resolve(out, `${name}.html`), html);
  writeFileSync(resolve(out, `${name}.txt`), `Betreff: ${m.subject}\n\n${m.text}`);
  items.push(`<li><a href="${name}.html">${name}</a> · <a href="${name}.txt">Text</a> — ${m.subject.replace(/</g, '&lt;')}</li>`);
}
writeFileSync(resolve(out, 'index.html'), `<!DOCTYPE html><meta charset="utf-8"><title>Mail-Vorschau</title><body style="background:#020807;color:#cfe8e0;font:14px monospace;padding:20px"><h1>Mail-Vorschau</h1><ul>${items.join('')}</ul>`);
console.log(`${mails.length} Mails in ${out}`);
