import { HEADER_H, HEADER_W, headerPng } from './mail-art.js';
import type { Mail } from './mailer.js';

/**
 * Account mails styled as a naval signal: phosphor-green console look, a sonar
 * header picture (inline, so it shows without loading remote images), German
 * with English below. Plain-text part for clients that don't show HTML.
 * Email HTML: tables and inline styles only, no web fonts, no SVG.
 */

const HEADER_CID = 'sonar-header@tiefenkontakt';
const C = { bg: '#020807', panel: '#06120f', line: '#1d4a3e', g: '#5dcaa5', g2: '#9fe6cc', dim: '#5f7d72', amber: '#e8c37a', text: '#cfe8e0' };
const MONO = "'SF Mono', Menlo, Consolas, 'Courier New', monospace";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** NATO date-time group, e.g. 221430Z NOV 26. */
export function dtg(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getUTCMonth()];
  return `${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}Z ${mon} ${p(d.getUTCFullYear() % 100)}`;
}

interface Signal {
  /** Precedence shown in the header strip, e.g. ROUTINE or DRINGEND. */
  precedence: string;
  to: string;
  subjectLine: string;
  de: string[];
  en: string[];
  button?: { label: string; url: string };
  validity?: string;
  footerDe: string;
  footerEn: string;
}

function html(s: Signal): string {
  const row = (k: string, v: string, color = C.text) =>
    `<tr><td style="padding:2px 0;color:${C.dim};font:12px/1.5 ${MONO};letter-spacing:1px;width:70px">${k}</td><td style="padding:2px 0;color:${color};font:12px/1.5 ${MONO};letter-spacing:1px">${v}</td></tr>`;
  const para = (p: string, color: string, size: number) => `<p style="margin:0 0 12px;color:${color};font:${size}px/1.6 ${MONO}">${p}</p>`;
  const button = s.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 18px"><tr>
        <td bgcolor="#12302a" style="border:1px solid ${C.g};border-radius:3px;box-shadow:0 0 12px rgba(93,202,165,.35)">
          <a href="${esc(s.button.url)}" style="display:inline-block;padding:13px 26px;color:#d8fff0;font:bold 14px ${MONO};letter-spacing:3px;text-decoration:none">${esc(s.button.label)} &#9656;</a>
        </td></tr></table>
       <p style="margin:0 0 4px;color:${C.dim};font:11px/1.5 ${MONO}">Falls der Knopf nicht geht / if the button does not work:</p>
       <p style="margin:0 0 16px;font:11px/1.5 ${MONO};word-break:break-all"><a href="${esc(s.button.url)}" style="color:${C.g}">${esc(s.button.url)}</a></p>`
    : '';
  return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>Tiefenkontakt</title></head>
<body style="margin:0;padding:0;background:${C.bg}" bgcolor="${C.bg}">
<div style="display:none;max-height:0;overflow:hidden">${esc(s.de[0] ?? '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="background:${C.bg}"><tr><td align="center" style="padding:24px 10px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.panel}" style="width:100%;max-width:600px;background:${C.panel};border:1px solid ${C.line};border-radius:4px">
  <tr><td style="padding:10px 18px;border-bottom:1px solid ${C.line}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="color:${C.amber};font:11px ${MONO};letter-spacing:2px">FUNKSPRUCH &middot; ${esc(s.precedence)}</td>
      <td align="right" style="color:${C.dim};font:11px ${MONO};letter-spacing:2px">DTG ${dtg()}</td>
    </tr></table></td></tr>
  <tr><td style="line-height:0;font-size:0"><img src="cid:${HEADER_CID}" width="600" height="${Math.round((600 * HEADER_H) / HEADER_W)}" alt="Sonar" style="display:block;width:100%;max-width:600px;height:auto;border:0"></td></tr>
  <tr><td style="padding:20px 26px 6px">
    <div style="color:${C.g};font:bold 26px ${MONO};letter-spacing:8px;text-shadow:0 0 8px rgba(93,202,165,.5)">TIEFENKONTAKT</div>
    <div style="color:${C.dim};font:11px ${MONO};letter-spacing:3px;margin-top:4px">NORDATLANTIK &middot; KALTER KRIEG</div>
  </td></tr>
  <tr><td style="padding:14px 26px 4px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-top:1px dashed ${C.line};border-bottom:1px dashed ${C.line};width:100%;padding:8px 0">
      ${row('VON', 'FLOTTENKOMMANDO TIEFENKONTAKT')}
      ${row('AN', esc(s.to.toUpperCase()), C.g2)}
      ${row('BETR', esc(s.subjectLine), C.amber)}
    </table></td></tr>
  <tr><td style="padding:16px 26px 4px">
    ${s.de.map((p) => para(p, C.text, 14)).join('')}
    ${button}
    ${s.validity ? `<p style="margin:0 0 18px;color:${C.amber};font:11px ${MONO};letter-spacing:2px">&#9632; ${esc(s.validity)}</p>` : ''}
    <div style="border-top:1px solid ${C.line};padding-top:12px;margin-top:4px">${s.en.map((p) => para(p, C.dim, 12)).join('')}</div>
  </td></tr>
  <tr><td style="padding:10px 26px 18px;border-top:1px solid ${C.line}">
    <p style="margin:0 0 6px;color:${C.g};font:11px ${MONO};letter-spacing:3px">+++ ENDE DER NACHRICHT +++</p>
    <p style="margin:0;color:${C.dim};font:10px/1.6 ${MONO}">${esc(s.footerDe)}<br>${esc(s.footerEn)}</p>
  </td></tr>
</table></td></tr></table></body></html>`;
}

function text(s: Signal): string {
  return [
    `FUNKSPRUCH · ${s.precedence} · DTG ${dtg()}`, `VON: FLOTTENKOMMANDO TIEFENKONTAKT`, `AN: ${s.to.toUpperCase()}`, `BETR: ${s.subjectLine}`, '',
    ...s.de, ...(s.button ? ['', s.button.url] : []), ...(s.validity ? ['', s.validity] : []), '', '---', ...s.en, '',
    '+++ ENDE DER NACHRICHT +++', s.footerDe, s.footerEn, '',
  ].join('\n');
}

function build(to: string, subject: string, s: Signal): Mail {
  return {
    to, subject, text: text(s), html: html(s),
    inline: [{ cid: HEADER_CID, type: 'image/png', filename: 'sonar.png', data: headerPng() }],
  };
}

export function verifyMail(to: string, callsign: string, url: string): Mail {
  return build(to, 'Tiefenkontakt: E-Mail bestätigen / verify your email', {
    precedence: 'ROUTINE', to: `Kapitän ${callsign}`, subjectLine: 'IDENTITÄT BESTÄTIGEN',
    de: [`Willkommen an Bord, Kapitän ${esc(callsign)}.`, 'Dein Boot liegt klar zum Auslaufen. Bestätige deine Adresse, dann erscheinen deine Erfolge in der Rangliste und du kannst dein Passwort zurücksetzen.'],
    en: [`Welcome aboard, Captain ${esc(callsign)}. Your boat is ready to sail. Confirm your address so your record appears on the leaderboard and you can reset your password.`],
    button: { label: 'ADRESSE BESTÄTIGEN', url }, validity: 'GÜLTIG 48 STUNDEN · VALID FOR 48 HOURS',
    footerDe: 'Automatisch gesendet. Wenn du dich nicht angemeldet hast, ignoriere diese Nachricht.',
    footerEn: 'Sent automatically. If you did not sign up, ignore this message.',
  });
}

export function resetMail(to: string, callsign: string, url: string): Mail {
  return build(to, 'Tiefenkontakt: Passwort zurücksetzen / reset your password', {
    precedence: 'DRINGEND', to: `Kapitän ${callsign}`, subjectLine: 'NEUER ZUGANGSCODE ANGEFORDERT',
    de: ['Für dein Konto wurde ein neues Passwort angefordert.', 'Folge dem Link und lege einen neuen Zugangscode fest. Danach werden alle anderen Geräte abgemeldet.'],
    en: ['A new password was requested for your account. Follow the link to set a new one; all other devices will be signed out.'],
    button: { label: 'NEUES PASSWORT', url }, validity: 'GÜLTIG 1 STUNDE · VALID FOR 1 HOUR',
    footerDe: 'Nicht von dir angefordert? Dann ignoriere diese Nachricht, dein Passwort bleibt unverändert.',
    footerEn: 'Did not ask for this? Ignore this message; your password stays unchanged.',
  });
}

export function testMail(to: string, url?: string): Mail {
  return build(to, 'Tiefenkontakt: Testmail', {
    precedence: 'ÜBUNG', to, subjectLine: 'FUNKVERBINDUNG PRÜFEN',
    de: ['Funkprobe: Diese Nachricht beweist, dass der Mailversand des Servers funktioniert.'],
    en: ['Radio check: this message proves the server can send mail.'],
    button: url ? { label: 'ZUM SPIEL', url } : undefined,
    footerDe: 'Übungsnachricht, keine Antwort nötig.', footerEn: 'Exercise message, no reply needed.',
  });
}
