/**
 * Send one operator mail with the game server's mail settings (SMTP_* in .env).
 * Recipient: ALERT_TO, else MAIL_FROM, else SMTP_USER. Used by scripts/healthcheck.sh on the
 * host, in a fresh container, so it works even when the game container is down:
 *   docker compose run --rm --no-deps -T -w /app tiefenkontakt node --import tsx scripts/alert.ts "Betreff" "Text"
 * Without a text argument the body is read from stdin. Exit code 1 if the mail could not be sent.
 */
import { alertRecipient } from '../apps/server/src/alerts.js';
import { createMailer } from '../apps/server/src/mailer.js';

const [subject, bodyArg] = process.argv.slice(2);
if (!subject) {
  console.error('Aufruf: alert.ts "Betreff" ["Text"]  (ohne Text: von stdin)');
  process.exit(2);
}
let text = bodyArg ?? '';
if (bodyArg === undefined && !process.stdin.isTTY) {
  for await (const c of process.stdin) text += String(c);
}
const to = alertRecipient();
if (!to) {
  console.log(`Kein Empfänger (ALERT_TO / MAIL_FROM): ${subject}\n${text}`);
  process.exit(0);
}
try {
  await createMailer().send({ to, subject, text: text || subject });
  console.log(`Alarm-Mail an ${to}: ${subject}`);
} catch (e) {
  console.error(`Alarm-Mail fehlgeschlagen: ${(e as Error).message}`);
  process.exit(1);
}
