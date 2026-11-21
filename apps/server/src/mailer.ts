import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';

/**
 * Minimal SMTP client for account mails (no dependency, no native code).
 * SMTP_URL: smtps://user:pass@host:465 (implicit TLS) or smtp://user:pass@host:587 (STARTTLS).
 * Without SMTP_URL, mails are written to the server log so an admin can pass the link on.
 */

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

class LogMailer implements Mailer {
  async send(mail: Mail): Promise<void> {
    console.log(`[Mail an ${mail.to}] ${mail.subject}\n${mail.text}`);
  }
}

function lines(sock: Socket | TLSSocket) {
  let buf = '';
  const waiting: ((l: string) => void)[] = [];
  sock.on('data', (d: Buffer) => {
    buf += d.toString();
    let i: number;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      // Multi-line replies ("250-...") end with "250 ..."
      if (/^\d{3} /.test(line)) waiting.shift()?.(line);
    }
  });
  return () => new Promise<string>((ok) => waiting.push(ok));
}

class SmtpMailer implements Mailer {
  constructor(private url: URL, private from: string) {}

  async send(mail: Mail): Promise<void> {
    const host = this.url.hostname;
    const implicit = this.url.protocol === 'smtps:';
    const port = Number(this.url.port || (implicit ? 465 : 587));
    let sock: Socket | TLSSocket = implicit ? tlsConnect({ host, port, servername: host }) : netConnect({ host, port });
    let next = lines(sock);
    const cmd = async (c: string | undefined, expect: string) => {
      if (c !== undefined) sock.write(`${c}\r\n`);
      const reply = await next();
      if (!reply.startsWith(expect)) throw new Error(`SMTP: ${reply}`);
    };
    try {
      await cmd(undefined, '220');
      await cmd(`EHLO tiefenkontakt`, '250');
      if (!implicit) {
        await cmd('STARTTLS', '220');
        sock = tlsConnect({ socket: sock, servername: host });
        next = lines(sock);
        await cmd(`EHLO tiefenkontakt`, '250');
      }
      if (this.url.username) {
        const auth = Buffer.from(`\0${decodeURIComponent(this.url.username)}\0${decodeURIComponent(this.url.password)}`).toString('base64');
        await cmd(`AUTH PLAIN ${auth}`, '235');
      }
      await cmd(`MAIL FROM:<${this.from}>`, '250');
      await cmd(`RCPT TO:<${mail.to}>`, '25');
      await cmd('DATA', '354');
      const body = [
        `From: Tiefenkontakt <${this.from}>`, `To: <${mail.to}>`, `Subject: =?UTF-8?B?${Buffer.from(mail.subject).toString('base64')}?=`,
        'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '',
        mail.text.replace(/^\./gm, '..'), '.',
      ].join('\r\n');
      await cmd(body, '250');
      await cmd('QUIT', '221');
    } finally {
      sock.end();
    }
  }
}

export function createMailer(): Mailer {
  const url = process.env.SMTP_URL;
  if (!url) return new LogMailer();
  return new SmtpMailer(new URL(url), process.env.MAIL_FROM ?? 'noreply@localhost');
}
