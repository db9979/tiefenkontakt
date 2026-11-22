/**
 * Nightly balance report: runs the bot arena (scripts/bot-arena.ts) and mails the result
 * through the game server's mail settings (SMTP_* in .env). Recipient: ARENA_REPORT_TO,
 * else MAIL_FROM. Meant for the Pi's crontab (scripts/install-arena-cron.sh), inside the
 * game container: node --import tsx scripts/arena-report.ts [games=90]
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createMailer } from '../apps/server/src/mailer.js';

const games = Math.max(3, Number(process.argv[2]) || 90);
const band = process.env.ARENA_BAND ?? '0.35';
const t0 = Date.now();

const out = await new Promise<{ code: number; text: string }>((ok) => {
  const p = spawn(process.execPath, ['--import', 'tsx', resolve(import.meta.dirname, 'bot-arena.ts'), String(games)], {
    env: { ...process.env, ARENA_BAND: band },
  });
  let text = '';
  p.stdout.on('data', (d: Buffer) => (text += d.toString()));
  p.stderr.on('data', (d: Buffer) => (text += d.toString()));
  p.on('close', (code) => ok({ code: code ?? 1, text }));
});

const lines = out.text.split('\n').filter((l) => l.trim() && !/ExperimentalWarning|trace-warnings/.test(l));
const bilanz = lines.find((l) => l.startsWith('Bilanz')) ?? 'keine Bilanz (Lauf abgebrochen?)';
const m = /Westbund (\d+) · Ostpakt (\d+)/.exec(bilanz);
const ok = out.code === 0;
const subject = `Tiefenkontakt Arena: ${m ? `${m[1]}:${m[2]}` : '?'} ${ok ? '· im Band' : '· AUSSERHALB DES BANDS'}`;
const minutes = Math.round((Date.now() - t0) / 60_000);
const text = [
  `${games} Partien KI gegen KI, Dauer ${minutes} min, erlaubtes Band ${Math.round(Number(band) * 100)}–${Math.round((1 - Number(band)) * 100)} % für den Westbund.`,
  '',
  bilanz,
  ...lines.filter((l) => /^(Mission|Pro Mission|  )/.test(l) || /Balance außerhalb/.test(l)),
  '',
  'Alle Partien:',
  ...lines.filter((l) => /^\w+\s+(west|east)\s/.test(l)),
].join('\n');

const to = process.env.ARENA_REPORT_TO || process.env.MAIL_FROM;
console.log(subject);
console.log(bilanz);
if (!to) {
  console.log('Kein Empfänger (ARENA_REPORT_TO oder MAIL_FROM): nur Log');
} else {
  await createMailer().send({ to, subject, text });
  console.log('Bericht verschickt');
}
process.exit(ok ? 0 : 1);
