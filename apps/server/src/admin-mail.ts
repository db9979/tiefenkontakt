import type { Mail } from './mailer.js';
import { C, MONO, dtg, esc, frameHtml, withHeader } from './mail-frame.js';

/**
 * Operator mails (alerts, recoveries, daily and weekly reports) in the same console look
 * as the player mails: a status banner, data blocks as tables, a log block and link
 * buttons, plus a plain-text part. All content is plain text and escaped here, so values
 * from logs, errors or the shell can't inject markup. Links must be http(s).
 */

export type Tone = 'alarm' | 'warn' | 'ok' | 'info';
/** Label, value and an optional colour for the value. */
export type Row = [label: string, value: string, tone?: Tone];

export type Block =
  | { kind: 'rows'; title?: string; rows: Row[] }
  | { kind: 'table'; title?: string; head: string[]; rows: string[][]; /** 'r' = right-aligned column */ align?: ('l' | 'r')[] }
  | { kind: 'log'; title?: string; lines: string[] }
  | { kind: 'text'; title?: string; paras: string[] };

export interface AdminReport {
  subject: string;
  tone: Tone;
  /** Strip after LAGEMELDUNG, e.g. ALARM, ENTWARNUNG, ROUTINE. */
  precedence: string;
  /** Sender line, e.g. WACHDIENST SERVER. */
  from: string;
  /** BETR line. */
  title: string;
  /** Big status line in the banner. */
  headline: string;
  /** One sentence under the headline. */
  summary?: string;
  blocks: Block[];
  links?: { label: string; url: string }[];
  /** Small print: why this mail came and how to switch it off. */
  footer: string[];
  /** Host or site name shown under the title. */
  site?: string;
}

const TONE: Record<Tone, { color: string; bg: string; mark: string }> = {
  alarm: { color: C.red, bg: '#2a0f0b', mark: '■' },
  warn: { color: C.amber, bg: '#2a2210', mark: '▲' },
  ok: { color: C.g, bg: '#0c2a22', mark: '●' },
  info: { color: C.g2, bg: '#0c2a22', mark: '◆' },
};

/** Only http(s) links: anything else (javascript:, data:, …) is dropped. */
export function safeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/** Colour of a log line by its mark (✓ ok, ! warning, ✗ failure). */
function logTone(line: string): string {
  const t = line.trimStart();
  if (t.startsWith('✗')) return C.red;
  if (t.startsWith('!')) return C.amber;
  if (t.startsWith('✓')) return C.g;
  return C.text;
}

const heading = (t?: string) =>
  t ? `<p style="margin:18px 0 6px;color:${C.dim};font:11px ${MONO};letter-spacing:3px">&#9656; ${esc(t.toUpperCase())}</p>` : '';
/** Wide tables (many columns) get tighter cells so they fit a phone screen. */
const cell = (v: string, color: string, extra = '', compact = false) =>
  `<td style="padding:${compact ? '4px 4px' : '5px 8px'};border-bottom:1px solid ${C.line};color:${color};font:${compact ? 11 : 12}px/1.4 ${MONO};vertical-align:top;${extra}">${esc(v)}</td>`;
const tableOpen = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.line};border-collapse:collapse;background:${C.row}" bgcolor="${C.row}">`;

function blockHtml(b: Block): string {
  switch (b.kind) {
    case 'rows':
      return `${heading(b.title)}${tableOpen}${b.rows.map(([k, v, t]) =>
        `<tr>${cell(k, C.dim, 'width:38%;letter-spacing:1px')}${cell(v, t ? TONE[t].color : C.text, 'word-break:break-word')}</tr>`).join('')}</table>`;
    case 'table': {
      const al = (i: number) => (b.align?.[i] === 'r' ? 'text-align:right;white-space:nowrap' : 'text-align:left');
      const compact = b.head.length > 5;
      const head = `<tr>${b.head.map((h, i) => `<th style="padding:${compact ? '4px 4px' : '5px 8px'};border-bottom:1px solid ${C.g};color:${C.g};font:bold 11px ${MONO};letter-spacing:${compact ? 0 : 1}px;${al(i)}">${esc(h)}</th>`).join('')}</tr>`;
      return `${heading(b.title)}${tableOpen}${head}${b.rows.map((r) => `<tr>${r.map((v, i) => cell(v, C.text, al(i), compact)).join('')}</tr>`).join('')}</table>`;
    }
    case 'log':
      return `${heading(b.title)}<div style="background:#010504;border:1px solid ${C.line};padding:10px 12px;overflow-x:auto">${b.lines.map((l) =>
        `<div style="color:${logTone(l)};font:12px/1.5 ${MONO};white-space:pre-wrap;word-break:break-word">${l.trim() ? esc(l) : '&nbsp;'}</div>`).join('')}</div>`;
    case 'text':
      return `${heading(b.title)}${b.paras.map((p) => `<p style="margin:0 0 10px;color:${C.text};font:13px/1.6 ${MONO};white-space:pre-wrap">${esc(p)}</p>`).join('')}`;
  }
}

function linksHtml(links: { label: string; url: string }[]): string {
  if (!links.length) return '';
  const btn = (l: { label: string; url: string }) =>
    `<td style="padding:0 10px 8px 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#12302a" style="border:1px solid ${C.g};border-radius:3px">
      <a href="${esc(l.url)}" style="display:inline-block;padding:10px 18px;color:#d8fff0;font:bold 12px ${MONO};letter-spacing:2px;text-decoration:none">${esc(l.label)} &#9656;</a></td></tr></table></td>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 6px"><tr>${links.map(btn).join('')}</tr></table>
    ${links.map((l) => `<p style="margin:0 0 2px;font:10px/1.5 ${MONO};word-break:break-all;color:${C.dim}">${esc(l.label)}: <a href="${esc(l.url)}" style="color:${C.g}">${esc(l.url)}</a></p>`).join('')}`;
}

export function adminHtml(r: AdminReport, links = validLinks(r)): string {
  const t = TONE[r.tone];
  const banner = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 6px"><tr>
    <td bgcolor="${t.bg}" style="background:${t.bg};border-left:4px solid ${t.color};padding:12px 14px">
      <div style="color:${t.color};font:bold 16px/1.4 ${MONO};letter-spacing:1px">${t.mark} ${esc(r.headline)}</div>
      ${r.summary ? `<div style="color:${C.text};font:12px/1.6 ${MONO};margin-top:6px">${esc(r.summary)}</div>` : ''}
    </td></tr></table>`;
  return frameHtml({
    kind: 'LAGEMELDUNG', precedence: r.precedence, precedenceColor: t.color, preheader: `${r.headline}${r.summary ? ` – ${r.summary}` : ''}`,
    tagline: `BETRIEB${r.site ? ` · ${r.site}` : ''}`, from: r.from, to: 'ADMIN / MODERATION', subjectLine: r.title, subjectColor: t.color,
    body: `${banner}${r.blocks.map(blockHtml).join('')}${linksHtml(links)}`,
    footer: r.footer.map(esc).join('<br>'),
  });
}

/** Columns padded to equal width for the text part. */
function textTable(head: string[], rows: string[][], align?: ('l' | 'r')[]): string[] {
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const fmt = (r: string[]) => r.map((v, i) => (align?.[i] === 'r' ? v.padStart(w[i]!) : v.padEnd(w[i]!))).join('  ').trimEnd();
  return [fmt(head), w.map((n) => '-'.repeat(n)).join('  '), ...rows.map(fmt)];
}

function blockText(b: Block): string[] {
  const title = b.title ? ['', `== ${b.title.toUpperCase()} ==`] : [''];
  switch (b.kind) {
    case 'rows': {
      const w = Math.max(...b.rows.map(([k]) => k.length));
      return [...title, ...b.rows.map(([k, v]) => `${`${k}:`.padEnd(w + 1)} ${v}`)];
    }
    case 'table': return [...title, ...textTable(b.head, b.rows, b.align)];
    case 'log': return [...title, ...b.lines];
    case 'text': return [...title, ...b.paras.flatMap((p, i) => (i ? ['', p] : [p]))];
  }
}

export function adminText(r: AdminReport, links = validLinks(r)): string {
  return [
    `LAGEMELDUNG · ${r.precedence} · DTG ${dtg()}`, `VON: ${r.from}`, 'AN: ADMIN / MODERATION', `BETR: ${r.title}`, '',
    `${TONE[r.tone].mark} ${r.headline}`, ...(r.summary ? [r.summary] : []),
    ...r.blocks.flatMap(blockText),
    ...(links.length ? ['', ...links.map((l) => `${l.label}: ${l.url}`)] : []),
    '', '+++ ENDE DER NACHRICHT +++', ...r.footer, '',
  ].join('\n');
}

function validLinks(r: AdminReport): { label: string; url: string }[] {
  return (r.links ?? []).flatMap((l) => {
    const url = safeUrl(l.url);
    return url ? [{ label: l.label, url }] : [];
  });
}

/** Subject, text and HTML (with the inline header picture) for one operator mail. */
export function adminMail(to: string, r: AdminReport): Mail {
  return withHeader(to, r.subject, adminText(r), adminHtml(r));
}

/** Mail without recipient, for code that adds it later (watchdog). */
export type MailContent = Omit<Mail, 'to'>;
export function adminContent(r: AdminReport): MailContent {
  const { to: _to, ...rest } = adminMail('', r);
  return rest;
}
