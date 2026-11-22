import { randomBytes } from 'node:crypto';
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';

/**
 * Minimal SMTP client for account mails (no dependency, no native code).
 * Configured by SMTP_HOST / SMTP_PORT / SMTP_SECURITY / SMTP_USER / SMTP_PASS / MAIL_FROM (see .env.example),
 * or the older single SMTP_URL (smtps://user:pass@host:465, smtp://user:pass@host:587).
 * Without a host, mails are written to the server log so an admin can pass the link on.
 */

export interface Mail {
  to: string;
  subject: string;
  text: string;
  /** Optional HTML version; sent as multipart/alternative with the text. */
  html?: string;
  /** Pictures referenced from the HTML as cid:… */
  inline?: { cid: string; type: string; filename: string; data: Buffer }[];
}

const b64 = (data: Buffer | string) => Buffer.from(data).toString('base64').replace(/.{76}/g, '$&\r\n');

/** MIME body (after the common headers): plain text, or text + HTML with inline pictures. */
export function mimeBody(mail: Mail): string[] {
  const text = mail.text.replace(/\r?\n/g, '\r\n');
  if (!mail.html) return ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', text];
  const id = randomBytes(8).toString('hex');
  const alt = `alt-${id}`;
  const rel = `rel-${id}`;
  const out = [
    `Content-Type: multipart/alternative; boundary="${alt}"`, '', `--${alt}`,
    'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', text, `--${alt}`,
    `Content-Type: multipart/related; boundary="${rel}"`, '', `--${rel}`,
    'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64(mail.html),
  ];
  for (const img of mail.inline ?? []) {
    out.push(`--${rel}`, `Content-Type: ${img.type}; name="${img.filename}"`, 'Content-Transfer-Encoding: base64',
      `Content-ID: <${img.cid}>`, `Content-Disposition: inline; filename="${img.filename}"`, '', b64(img.data));
  }
  out.push(`--${rel}--`, `--${alt}--`);
  return out;
}

export interface Mailer {
  readonly kind: 'smtp' | 'log';
  send(mail: Mail): Promise<void>;
}

/** ssl = TLS from the first byte (port 465), starttls = upgrade after EHLO (587), none = plain (LAN relays only). */
export type SmtpSecurity = 'ssl' | 'starttls' | 'none';

export interface SmtpConfig {
  host: string;
  port: number;
  security: SmtpSecurity;
  user?: string;
  pass?: string;
  from: string;
  fromName: string;
  replyTo?: string;
  /** Verify the server certificate (turn off only for self-signed LAN servers). */
  tlsVerify: boolean;
  timeoutMs: number;
}

class LogMailer implements Mailer {
  readonly kind = 'log' as const;
  async send(mail: Mail): Promise<void> {
    console.log(`[Mail an ${mail.to}] ${mail.subject}\n${mail.text}`);
  }
}

/** Full SMTP replies (multi-line "250-..." joined), one per call. */
function replies(sock: Socket | TLSSocket) {
  let buf = '';
  let acc: string[] = [];
  const done: string[] = [];
  const waiting: ((r: string) => void)[] = [];
  const onData = (d: Buffer) => {
    buf += d.toString();
    let i: number;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      acc.push(line);
      if (/^\d{3}(?: |$)/.test(line)) {
        const reply = acc.join('\n');
        acc = [];
        const w = waiting.shift();
        if (w) w(reply);
        else done.push(reply);
      }
    }
  };
  sock.on('data', onData);
  return {
    next: () => new Promise<string>((ok) => (done.length ? ok(done.shift()!) : waiting.push(ok))),
    detach: () => sock.off('data', onData),
  };
}

/** Header-safe address: no line breaks or angle brackets can be smuggled in. */
function addr(a: string): string {
  if (!/^[^\s<>"]+@[^\s<>"]+$/.test(a)) throw new Error(`Ungültige Adresse: ${a}`);
  return a;
}
const encWord = (s: string) => `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`;

export class SmtpMailer implements Mailer {
  readonly kind = 'smtp' as const;
  constructor(readonly cfg: SmtpConfig) {}

  async send(mail: Mail): Promise<void> {
    const { host, port, security, user, pass, timeoutMs } = this.cfg;
    const tlsOpts = { servername: host, rejectUnauthorized: this.cfg.tlsVerify };
    let sock: Socket | TLSSocket = security === 'ssl' ? tlsConnect({ host, port, ...tlsOpts }) : netConnect({ host, port });
    const failed = new Promise<never>((_, fail) => {
      sock.setTimeout(timeoutMs, () => fail(new Error(`SMTP: keine Antwort von ${host}:${port} (Zeitüberschreitung)`)));
      sock.on('error', (e) => fail(new Error(`SMTP ${host}:${port}: ${e.message}`)));
    });
    failed.catch(() => undefined);
    let r = replies(sock);
    const cmd = async (c: string | undefined, expect: string, shown = c): Promise<string> => {
      if (c !== undefined) sock.write(`${c}\r\n`);
      const reply = await Promise.race([r.next(), failed]);
      if (!reply.startsWith(expect)) throw new Error(`SMTP ${shown?.split(' ')[0] ?? 'Begrüßung'}: ${reply.replace(/\n/g, ' ')}`);
      return reply;
    };
    try {
      await cmd(undefined, '220');
      let caps = await cmd('EHLO tiefenkontakt', '250');
      if (security === 'starttls') {
        if (!/STARTTLS/i.test(caps)) throw new Error('SMTP: Server bietet kein STARTTLS an (SMTP_SECURITY=ssl oder Port 465 versuchen)');
        await cmd('STARTTLS', '220');
        r.detach();
        sock = tlsConnect({ socket: sock, ...tlsOpts });
        sock.on('error', () => undefined);
        r = replies(sock);
        caps = await cmd('EHLO tiefenkontakt', '250');
      }
      if (user) {
        const authLine = /^250[ -]AUTH[ =](.*)$/im.exec(caps)?.[1]?.toUpperCase() ?? 'PLAIN LOGIN';
        if (/\bPLAIN\b/.test(authLine) || !/\bLOGIN\b/.test(authLine)) {
          await cmd(`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass ?? ''}`).toString('base64')}`, '235', 'AUTH PLAIN');
        } else {
          await cmd('AUTH LOGIN', '334');
          await cmd(Buffer.from(user).toString('base64'), '334', 'AUTH LOGIN');
          await cmd(Buffer.from(pass ?? '').toString('base64'), '235', 'AUTH LOGIN');
        }
      }
      const from = addr(this.cfg.from);
      await cmd(`MAIL FROM:<${from}>`, '250');
      await cmd(`RCPT TO:<${addr(mail.to)}>`, '25');
      await cmd('DATA', '354');
      const domain = from.split('@')[1];
      const body = [
        `From: ${encWord(this.cfg.fromName)} <${from}>`, `To: <${mail.to}>`,
        ...(this.cfg.replyTo ? [`Reply-To: <${addr(this.cfg.replyTo)}>`] : []),
        `Subject: ${encWord(mail.subject)}`, `Date: ${new Date().toUTCString()}`,
        `Message-ID: <${randomBytes(12).toString('hex')}@${domain}>`,
        'MIME-Version: 1.0', ...mimeBody(mail),
      ].join('\r\n').replace(/^\./gm, '..') + '\r\n.';
      await cmd(body, '250', 'DATA');
      await cmd('QUIT', '221').catch(() => undefined);
    } finally {
      sock.end();
    }
  }
}

/** Reads the SMTP settings from the environment; undefined = no mail server configured. */
export function smtpConfigFrom(env: NodeJS.ProcessEnv = process.env): SmtpConfig | undefined {
  let host = env.SMTP_HOST?.trim();
  let port = Number(env.SMTP_PORT) || 0;
  let security = env.SMTP_SECURITY?.trim().toLowerCase() as SmtpSecurity | undefined;
  let user = env.SMTP_USER;
  let pass = env.SMTP_PASS;
  if (!host && env.SMTP_URL) {
    const u = new URL(env.SMTP_URL);
    host = u.hostname;
    port ||= Number(u.port) || 0;
    security ??= u.protocol === 'smtps:' ? 'ssl' : 'starttls';
    user ||= decodeURIComponent(u.username) || undefined;
    pass ||= decodeURIComponent(u.password) || undefined;
  }
  if (!host) return undefined;
  if (security && !['ssl', 'starttls', 'none'].includes(security)) throw new Error(`SMTP_SECURITY muss ssl, starttls oder none sein, nicht „${security}“`);
  security ??= port === 465 ? 'ssl' : port === 25 ? 'none' : 'starttls';
  port ||= security === 'ssl' ? 465 : security === 'none' ? 25 : 587;
  return {
    host, port, security, user: user || undefined, pass: pass || undefined,
    // Gmail and iCloud only accept the account's own address (or a verified alias) as sender
    from: env.MAIL_FROM?.trim() || user || 'noreply@localhost',
    fromName: env.MAIL_FROM_NAME?.trim() || 'Tiefenkontakt',
    replyTo: env.MAIL_REPLY_TO?.trim() || undefined,
    tlsVerify: env.SMTP_TLS_VERIFY !== '0',
    timeoutMs: (Number(env.SMTP_TIMEOUT_S) || 20) * 1000,
  };
}

export function createMailer(env: NodeJS.ProcessEnv = process.env): Mailer {
  const cfg = smtpConfigFrom(env);
  return cfg ? new SmtpMailer(cfg) : new LogMailer();
}
