import { createMailer, smtpConfigFrom } from './mailer.js';
import { testMail } from './mail-templates.js';

/** Sends one test mail with the current settings: node --import tsx src/mail-test.ts you@example.com */
const to = process.argv[2];
if (!to) {
  console.error('Aufruf: mail-test <empfänger@adresse>');
  process.exit(2);
}
const cfg = smtpConfigFrom();
if (!cfg) {
  console.error('Kein Mailserver eingestellt (SMTP_HOST ist leer).');
  process.exit(1);
}
console.log(`Sende über ${cfg.host}:${cfg.port} (${cfg.security}) als ${cfg.from}${cfg.user ? `, Login ${cfg.user}` : ', ohne Login'} …`);
createMailer()
  .send(testMail(to, process.env.PUBLIC_URL))
  .then(() => console.log('✓ Gesendet. Auch im Spam-Ordner nachsehen.'))
  .catch((e: Error) => {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  });
