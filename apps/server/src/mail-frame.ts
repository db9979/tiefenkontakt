import { HEADER_H, HEADER_W, headerPng } from './mail-art.js';
import type { Mail } from './mailer.js';

/**
 * Shared frame of all styled mails (player and operator): phosphor-green console look,
 * precedence strip with date-time group, sonar header picture (inline), title, the
 * VON / AN / BETR block and the closing line. Email HTML: tables and inline styles only,
 * no web fonts, no SVG. Every string handed in as plain text is escaped here; `body`
 * and `footer` are HTML the caller built from escaped parts.
 */

export const HEADER_CID = 'sonar-header@tiefenkontakt';
export const C = {
  bg: '#020807', panel: '#06120f', line: '#1d4a3e', g: '#5dcaa5', g2: '#9fe6cc', dim: '#5f7d72',
  amber: '#e8c37a', red: '#ff7a66', text: '#cfe8e0', row: '#0a1a16',
};
export const MONO = "'SF Mono', Menlo, Consolas, 'Courier New', monospace";

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** NATO date-time group, e.g. 221430Z NOV 26. */
export function dtg(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getUTCMonth()];
  return `${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}Z ${mon} ${p(d.getUTCFullYear() % 100)}`;
}

export interface Frame {
  /** Left part of the strip, e.g. FUNKSPRUCH or LAGEMELDUNG (plain text). */
  kind: string;
  /** Precedence after the kind, e.g. ROUTINE, DRINGEND, ALARM (plain text). */
  precedence: string;
  precedenceColor?: string;
  /** Hidden preview line for the inbox list (plain text). */
  preheader: string;
  /** Line under the title (plain text). */
  tagline: string;
  from: string;
  to: string;
  subjectLine: string;
  subjectColor?: string;
  /** Main part (HTML). */
  body: string;
  /** Small print under +++ ENDE DER NACHRICHT +++ (HTML). */
  footer: string;
}

const row = (k: string, v: string, color = C.text) =>
  `<tr><td style="padding:2px 0;color:${C.dim};font:12px/1.5 ${MONO};letter-spacing:1px;width:70px">${k}</td><td style="padding:2px 0;color:${color};font:12px/1.5 ${MONO};letter-spacing:1px">${v}</td></tr>`;

export function frameHtml(f: Frame): string {
  return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>Tiefenkontakt</title></head>
<body style="margin:0;padding:0;background:${C.bg}" bgcolor="${C.bg}">
<div style="display:none;max-height:0;overflow:hidden">${esc(f.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="background:${C.bg}"><tr><td align="center" style="padding:24px 10px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.panel}" style="width:100%;max-width:600px;background:${C.panel};border:1px solid ${C.line};border-radius:4px">
  <tr><td style="padding:10px 18px;border-bottom:1px solid ${C.line}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="color:${C.amber};font:11px ${MONO};letter-spacing:2px">${esc(f.kind)} &middot; <span style="color:${f.precedenceColor ?? C.amber}">${esc(f.precedence)}</span></td>
      <td align="right" style="color:${C.dim};font:11px ${MONO};letter-spacing:2px">DTG ${dtg()}</td>
    </tr></table></td></tr>
  <tr><td style="line-height:0;font-size:0"><img src="cid:${HEADER_CID}" width="600" height="${Math.round((600 * HEADER_H) / HEADER_W)}" alt="Sonar" style="display:block;width:100%;max-width:600px;height:auto;border:0"></td></tr>
  <tr><td style="padding:20px 26px 6px">
    <div style="color:${C.g};font:bold 26px ${MONO};letter-spacing:8px;text-shadow:0 0 8px rgba(93,202,165,.5)">TIEFENKONTAKT</div>
    <div style="color:${C.dim};font:11px ${MONO};letter-spacing:3px;margin-top:4px">${esc(f.tagline)}</div>
  </td></tr>
  <tr><td style="padding:14px 26px 4px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-top:1px dashed ${C.line};border-bottom:1px dashed ${C.line};width:100%;padding:8px 0">
      ${row('VON', esc(f.from))}
      ${row('AN', esc(f.to.toUpperCase()), C.g2)}
      ${row('BETR', esc(f.subjectLine), f.subjectColor ?? C.amber)}
    </table></td></tr>
  <tr><td style="padding:16px 26px 4px">
    ${f.body}
  </td></tr>
  <tr><td style="padding:10px 26px 18px;border-top:1px solid ${C.line}">
    <p style="margin:0 0 6px;color:${C.g};font:11px ${MONO};letter-spacing:3px">+++ ENDE DER NACHRICHT +++</p>
    <p style="margin:0;color:${C.dim};font:10px/1.6 ${MONO}">${f.footer}</p>
  </td></tr>
</table></td></tr></table></body></html>`;
}

/** Big framed button with the bare URL below for clients that hide it. */
export function buttonHtml(label: string, url: string, fallbackNote = 'Falls der Knopf nicht geht / if the button does not work:'): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 18px"><tr>
        <td bgcolor="#12302a" style="border:1px solid ${C.g};border-radius:3px;box-shadow:0 0 12px rgba(93,202,165,.35)">
          <a href="${esc(url)}" style="display:inline-block;padding:13px 26px;color:#d8fff0;font:bold 14px ${MONO};letter-spacing:3px;text-decoration:none">${esc(label)} &#9656;</a>
        </td></tr></table>
       <p style="margin:0 0 4px;color:${C.dim};font:11px/1.5 ${MONO}">${esc(fallbackNote)}</p>
       <p style="margin:0 0 16px;font:11px/1.5 ${MONO};word-break:break-all"><a href="${esc(url)}" style="color:${C.g}">${esc(url)}</a></p>`;
}

/** Mail with the header picture attached inline. */
export function withHeader(to: string, subject: string, text: string, html: string): Mail {
  return { to, subject, text, html, inline: [{ cid: HEADER_CID, type: 'image/png', filename: 'sonar.png', data: headerPng() }] };
}
