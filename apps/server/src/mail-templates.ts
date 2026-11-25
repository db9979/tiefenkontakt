import type { Mail } from './mailer.js';
import { C, MONO, buttonHtml, dtg, esc, frameHtml, withHeader } from './mail-frame.js';

export { dtg } from './mail-frame.js';

/**
 * Account mails styled as a naval signal (frame in mail-frame.ts), German with English
 * below. Plain-text part for clients that don't show HTML.
 */

interface Signal {
  /** Precedence shown in the header strip, e.g. ROUTINE or DRINGEND. */
  precedence: string;
  to: string;
  subjectLine: string;
  /** Paragraphs as HTML (escape inserted values). */
  de: string[];
  en: string[];
  button?: { label: string; url: string };
  validity?: string;
  footerDe: string;
  footerEn: string;
}

/** HTML paragraph back to plain text for the text part. */
const plain = (p: string) => p.replace(/<[^>]*>/g, '').replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));

function html(s: Signal): string {
  const para = (p: string, color: string, size: number) => `<p style="margin:0 0 12px;color:${color};font:${size}px/1.6 ${MONO}">${p}</p>`;
  const body = `${s.de.map((p) => para(p, C.text, 14)).join('')}
    ${s.button ? buttonHtml(s.button.label, s.button.url) : ''}
    ${s.validity ? `<p style="margin:0 0 18px;color:${C.amber};font:11px ${MONO};letter-spacing:2px">&#9632; ${esc(s.validity)}</p>` : ''}
    <div style="border-top:1px solid ${C.line};padding-top:12px;margin-top:4px">${s.en.map((p) => para(p, C.dim, 12)).join('')}</div>`;
  return frameHtml({
    kind: 'FUNKSPRUCH', precedence: s.precedence, preheader: plain(s.de[0] ?? ''),
    tagline: 'NORDATLANTIK · KALTER KRIEG', from: 'FLOTTENKOMMANDO TIEFENKONTAKT', to: s.to, subjectLine: s.subjectLine,
    body, footer: `${esc(s.footerDe)}<br>${esc(s.footerEn)}`,
  });
}

function text(s: Signal): string {
  return [
    `FUNKSPRUCH · ${s.precedence} · DTG ${dtg()}`, `VON: FLOTTENKOMMANDO TIEFENKONTAKT`, `AN: ${s.to.toUpperCase()}`, `BETR: ${s.subjectLine}`, '',
    ...s.de.map(plain), ...(s.button ? ['', s.button.url] : []), ...(s.validity ? ['', s.validity] : []), '', '---', ...s.en.map(plain), '',
    '+++ ENDE DER NACHRICHT +++', s.footerDe, s.footerEn, '',
  ].join('\n');
}

function build(to: string, subject: string, s: Signal): Mail {
  return withHeader(to, subject, text(s), html(s));
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
