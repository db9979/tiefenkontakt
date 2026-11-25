import type { AdminReport, Block, Row, Tone } from './admin-mail.js';

/**
 * The concrete operator mails: watchdog alert, recovery and daily report (watchdog.ts),
 * host health-check alerts (scripts/alert.ts), the nightly bot-arena report
 * (scripts/arena-report.ts) and the weekly restore test of the backups
 * (scripts/restore-test.ts). Each returns an AdminReport; adminMail() renders it.
 * Subjects stay as they were, so mail filters keep working.
 */

/**
 * Buttons to the game (the admin area sits in the lobby) and its health endpoint. Only the
 * origin of PUBLIC_URL is used, so a path, query or user:password in it never reaches a mail.
 */
function siteLinks(url: string | undefined, health = false): { label: string; url: string }[] {
  let base: string;
  try {
    base = new URL(url ?? '').origin;
  } catch {
    return [];
  }
  if (base === 'null') return [];
  return [{ label: 'ADMIN-BEREICH (LOBBY)', url: `${base}/` }, ...(health ? [{ label: 'SERVERSTATUS', url: `${base}/api/health` }] : [])];
}

const WATCH_FOOTER = [
  'Automatisch vom Wachdienst des Spielservers (watchdog.ts). Empfänger: ALERT_TO, sonst MAIL_FROM.',
  'Abstellen mit ALERT=0, Grenzwerte über ALERT_* in der .env.',
];

export interface WatchdogAlert { site: string; label: string; detail: string; since: number; gapH: number; url?: string }

export function watchdogAlert(a: WatchdogAlert): AdminReport {
  return {
    subject: `${a.site} ALARM: ${a.label}`, tone: 'alarm', precedence: 'ALARM', from: 'WACHDIENST SPIELSERVER',
    title: a.label.toUpperCase(), headline: `${a.label}.`, site: a.site, summary: a.detail,
    blocks: [{
      kind: 'rows', title: 'Befund', rows: [
        ['Meldung', a.label, 'alarm'], ['Messwert', a.detail], ['Seit', new Date(a.since).toISOString()],
        ['Erinnerung', `frühestens in ${a.gapH} h; eine Entwarnung kommt, sobald es wieder passt`],
      ],
    }],
    links: siteLinks(a.url, true), footer: WATCH_FOOTER,
  };
}

export interface WatchdogRecovered { site: string; label: string; now: string; before: string; duration: string; url?: string }

export function watchdogRecovered(r: WatchdogRecovered): AdminReport {
  return {
    subject: `${r.site} wieder OK: ${r.label}`, tone: 'ok', precedence: 'ENTWARNUNG', from: 'WACHDIENST SPIELSERVER',
    title: `ENTWARNUNG: ${r.label.toUpperCase()}`, headline: `Entwarnung: ${r.label} ist behoben.`, site: r.site,
    blocks: [{ kind: 'rows', title: 'Verlauf', rows: [['Jetzt', r.now, 'ok'], ['Vorher', r.before, 'warn'], ['Dauer', r.duration]] }],
    links: siteLinks(r.url), footer: WATCH_FOOTER,
  };
}

export interface WatchdogDaily {
  site: string;
  /** Labels of the open warnings. */
  active: string[];
  status: Record<string, string | number>;
  readings: Row[];
  url?: string;
}

export function watchdogDaily(d: WatchdogDaily): AdminReport {
  const open = d.active.length;
  return {
    subject: `${d.site} Tagesbericht: ${open ? `${open} offene Warnung(en)` : 'alles OK'}`,
    tone: open ? 'warn' : 'ok', precedence: 'ROUTINE', from: 'WACHDIENST SPIELSERVER', title: 'TAGESBERICHT', site: d.site,
    headline: open ? `${open} offene Warnung(en)` : 'Alles OK', summary: open ? `Offene Warnungen: ${d.active.join(', ')}` : 'Keine offenen Warnungen.',
    blocks: [
      ...(open ? [{ kind: 'rows', title: 'Offene Warnungen', rows: d.active.map((l): Row => ['Warnung', l, 'alarm']) } as Block] : []),
      ...(Object.keys(d.status).length ? [{ kind: 'rows', title: 'Spielbetrieb', rows: Object.entries(d.status).map(([k, v]): Row => [k, String(v)]) } as Block] : []),
      { kind: 'rows', title: 'Messwerte', rows: d.readings },
    ],
    links: siteLinks(d.url, true), footer: ['Täglich vom Wachdienst (ALERT_DAILY=1, Stunde ALERT_DAILY_HOUR in UTC).', ...WATCH_FOOTER],
  };
}

/** Free text from scripts/healthcheck.sh into blocks: "Key: value" lines become rows, "Heading:" + lines a log. */
export function textBlocks(text: string): Block[] {
  const out: Block[] = [];
  for (const para of text.replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
    const lines = para.split('\n').filter((l) => l.trim());
    if (!lines.length) continue;
    const head = /^([^:]{1,40}):\s*$/.exec(lines[0]!);
    if (head && lines.length > 1) {
      out.push({ kind: 'log', title: head[1], lines: lines.slice(1) });
      continue;
    }
    for (const l of lines) {
      const kv = /^([^:/]{1,24}): (.+)$/.exec(l);
      const last = out.at(-1);
      if (kv) {
        if (last?.kind === 'rows' && !last.title) last.rows.push([kv[1]!, kv[2]!]);
        else out.push({ kind: 'rows', rows: [[kv[1]!, kv[2]!]] });
      } else if (last?.kind === 'text' && !last.title) last.paras.push(l);
      else out.push({ kind: 'text', paras: [l] });
    }
  }
  return out;
}

/** Health-check or other host alert sent through scripts/alert.ts. */
export function operatorAlert(subject: string, text: string, url?: string): AdminReport {
  const tone: Tone = /wieder (erreichbar|ok)|entwarnung/i.test(subject) ? 'ok' : /alarm|fehlgeschlagen|antwortet nicht|ausfall/i.test(subject) ? 'alarm' : 'warn';
  const headline = subject.replace(/^Tiefenkontakt\s*(ALARM:\s*)?/i, '').trim() || subject;
  return {
    subject, tone, precedence: tone === 'ok' ? 'ENTWARNUNG' : tone === 'alarm' ? 'ALARM' : 'HINWEIS',
    from: 'HEALTHCHECK HOST', title: headline.toUpperCase(), headline,
    blocks: text.trim() && text.trim() !== subject ? textBlocks(text) : [],
    links: siteLinks(url, true),
    footer: ['Vom Health-Check auf dem Host (scripts/healthcheck.sh, alle 5 min per cron).', 'Pause: touch ~/.tk-health-pause, wieder an: Datei löschen.'],
  };
}

export interface ArenaRun { games: number; minutes: number; band: number; ok: boolean; output: string[]; url?: string }

/** Nightly bot-arena report from the output lines of scripts/bot-arena.ts. */
export function arenaReport(a: ArenaRun): AdminReport {
  const bilanz = a.output.find((l) => l.startsWith('Bilanz'));
  const m = bilanz ? /Westbund (\d+) · Ostpakt (\d+)/.exec(bilanz) : null;
  const west = m ? Number(m[1]) : undefined, east = m ? Number(m[2]) : undefined;
  const share = west !== undefined && east !== undefined && west + east > 0 ? Math.round((west / (west + east)) * 100) : undefined;
  const lo = Math.round(a.band * 100), hi = Math.round((1 - a.band) * 100);
  const summaryRows: Row[] = [
    ['Ergebnis', m ? `Westbund ${west} : Ostpakt ${east}` : 'keine Bilanz (Lauf abgebrochen?)', m ? undefined : 'alarm'],
    ['Anteil West', share !== undefined ? `${share} % (erlaubt ${lo}–${hi} %)` : '?', a.ok ? 'ok' : 'alarm'],
    ['Partien', `${a.games} KI gegen KI, Dauer ${a.minutes} min`],
  ];
  for (const part of (bilanz ?? '').split(/ \| | · /).slice(2)) {
    const k = /^Ø Ortung/.test(part) ? 'Ø Ortung' : /^Befehle/.test(part) ? 'Befehle erfüllt/nicht' : 'Kennzahl';
    summaryRows.push([k, part.replace(/^Ø Ortung |^Befehle erfüllt\/nicht: /, '')]);
  }
  const missions = [...(a.output.find((l) => l.startsWith('Missionen:')) ?? '').matchAll(/(\S+) (\d+):(\d+) \(Minentreffer Frachter (\d+)\)/g)]
    .map((x) => [x[1]!, x[2]!, x[3]!, x[4]!]);
  const games: string[][] = [];
  const other: string[] = [];
  for (const l of a.output) {
    if (l.startsWith('Bilanz') || l.startsWith('Missionen:')) continue;
    const g = /^(\S+)\s+(west|east)\s+(\d+) min \| Frachter (\d+)[^|]*\| U-Boote (\d+) \| Eskorten (\d+) \|/.exec(l);
    if (g) {
      const parts = l.split(' | ');
      games.push([g[1]!, g[2] === 'west' ? 'West' : 'Ost', g[3]!, g[4]!, g[5]!, g[6]!, parts.at(-2)?.trim() ?? '']);
    } else other.push(l);
  }
  const blocks: Block[] = [{ kind: 'rows', title: 'Bilanz', rows: summaryRows }];
  if (missions.length) blocks.push({ kind: 'table', title: 'Pro Mission', head: ['Mission', 'West', 'Ost', 'Minen'], rows: missions, align: ['l', 'r', 'r', 'r'] });
  if (other.length) blocks.push({ kind: 'log', title: 'Meldungen', lines: other.slice(-40) });
  if (games.length) blocks.push({ kind: 'table', title: 'Alle Partien', head: ['Mission', 'Sieg', 'min', 'Fr.', 'U', 'Esk.', 'Grund'], rows: games, align: ['l', 'l', 'r', 'r', 'r', 'r', 'l'] });
  return {
    subject: `Tiefenkontakt Arena: ${m ? `${west}:${east}` : '?'} ${a.ok ? '· im Band' : '· AUSSERHALB DES BANDS'}`,
    tone: a.ok ? 'ok' : 'alarm', precedence: a.ok ? 'ROUTINE' : 'DRINGEND', from: 'BOT-ARENA', title: 'NÄCHTLICHER BALANCE-BERICHT',
    headline: m ? `Westbund ${west} : Ostpakt ${east} ${a.ok ? '– im Band' : '– außerhalb des Bands'}` : 'Arena-Lauf ohne Bilanz',
    summary: `${a.games} Partien KI gegen KI; der Westbund soll ${lo}–${hi} % gewinnen.`,
    blocks, links: siteLinks(a.url),
    footer: ['Nächtlich per cron im Spielcontainer (scripts/install-arena-cron.sh). Empfänger: ARENA_REPORT_TO, sonst MAIL_FROM.'],
  };
}

export interface RestoreRun { passed: boolean; failures: string[]; warnings: string[]; lines: string[]; url?: string }

/** Weekly restore test of the newest backup (scripts/restore-test.ts). */
export function restoreReport(r: RestoreRun): AdminReport {
  const backup = r.lines.find((l) => l.startsWith('Backup: '))?.slice(8);
  const duration = r.lines.find((l) => l.startsWith('Dauer '))?.slice(6);
  const hi = r.lines.findIndex((l) => l.startsWith('Zeilen '));
  const counts: string[][] = [];
  if (hi >= 0) {
    for (const l of r.lines.slice(hi + 1)) {
      const c = /^ {2}(\S+)\s+(\S+)(?:\s+(\S+))?$/.exec(l);
      if (!c) break;
      counts.push([c[1]!, c[2]!, ...(c[3] !== undefined ? [c[3]] : [])]);
    }
  }
  const withLive = counts.some((c) => c.length === 3);
  const rows: Row[] = [
    ['Ergebnis', r.passed ? 'bestanden' : 'FEHLGESCHLAGEN', r.passed ? 'ok' : 'alarm'],
    ['Fehler', String(r.failures.length), r.failures.length ? 'alarm' : undefined],
    ['Hinweise', String(r.warnings.length), r.warnings.length ? 'warn' : undefined],
    ...(backup ? [['Backup', backup] as Row] : []),
    ...(duration ? [['Dauer', duration] as Row] : []),
  ];
  const tone: Tone = !r.passed ? 'alarm' : r.warnings.length ? 'warn' : 'ok';
  return {
    subject: `Tiefenkontakt Restore-Test: ${r.passed ? `OK${r.warnings.length ? ` (${r.warnings.length} Hinweis(e))` : ''}` : 'FEHLGESCHLAGEN'}`,
    tone, precedence: r.passed ? 'ROUTINE' : 'DRINGEND', from: 'BACKUP-PRÜFUNG', title: 'WÖCHENTLICHER RESTORE-TEST',
    headline: r.passed ? 'Backup lässt sich wiederherstellen' : 'Backup lässt sich NICHT sauber wiederherstellen',
    summary: 'Neuestes Backup kopiert, Integrität geprüft, Zeilen verglichen und ein Testserver damit gestartet.',
    blocks: [
      { kind: 'rows', title: 'Ergebnis', rows },
      ...(r.failures.length ? [{ kind: 'log', title: 'Fehler', lines: r.failures.map((f) => `✗ ${f}`) } as Block] : []),
      ...(r.warnings.length ? [{ kind: 'log', title: 'Hinweise', lines: r.warnings.map((w) => `! ${w}`) } as Block] : []),
      ...(counts.length ? [{ kind: 'table', title: 'Zeilen je Tabelle', head: withLive ? ['Tabelle', 'Backup', 'Live'] : ['Tabelle', 'Backup'], rows: counts, align: ['l', 'r', 'r'] } as Block] : []),
      { kind: 'log', title: 'Protokoll', lines: r.lines },
    ],
    links: siteLinks(r.url),
    footer: ['Sonntags per cron (scripts/install-health-cron.sh, restore-test.ts --mail). Empfänger: ALERT_TO, sonst MAIL_FROM.'],
  };
}
