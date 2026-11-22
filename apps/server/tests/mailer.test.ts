import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { SmtpMailer, smtpConfigFrom } from '../src/mailer.js';

/** Tiny fake SMTP server (plain, no TLS) that records the session. */
function fakeSmtp(authMechs: string): Promise<{ server: Server; port: number; log: string[] }> {
  const log: string[] = [];
  const server = createServer((s) => {
    let data = false;
    let buf = '';
    let loginStep = 0;
    s.write('220 fake ESMTP\r\n');
    s.on('data', (d) => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        log.push(line);
        if (data) {
          if (line === '.') { data = false; s.write('250 queued\r\n'); }
          continue;
        }
        if (loginStep === 1) { loginStep = 2; s.write('334 UGFzc3dvcmQ6\r\n'); continue; }
        if (loginStep === 2) { loginStep = 0; s.write('235 ok\r\n'); continue; }
        if (line.startsWith('EHLO')) s.write(`250-fake\r\n250-AUTH ${authMechs}\r\n250 8BITMIME\r\n`);
        else if (line.startsWith('AUTH PLAIN')) s.write('235 ok\r\n');
        else if (line === 'AUTH LOGIN') { loginStep = 1; s.write('334 VXNlcm5hbWU6\r\n'); }
        else if (line === 'DATA') { data = true; s.write('354 go\r\n'); }
        else if (line === 'QUIT') { s.write('221 bye\r\n'); s.end(); }
        else s.write('250 ok\r\n');
      }
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, port: (server.address() as { port: number }).port, log })));
}

let open: Server | undefined;
afterEach(() => open?.close());

const cfg = (port: number) => ({
  host: '127.0.0.1', port, security: 'none' as const, user: 'me@icloud.com', pass: 'app-pass',
  from: 'me@icloud.com', fromName: 'Tiefenkontakt', tlsVerify: true, timeoutMs: 3000,
});

describe('SMTP mailer', () => {
  it('logs in with AUTH PLAIN and sends proper headers', async () => {
    const f = await fakeSmtp('PLAIN LOGIN');
    open = f.server;
    await new SmtpMailer(cfg(f.port)).send({ to: 'you@example.com', subject: 'Prüfung', text: 'Hallo\n.Punkt' });
    const plain = f.log.find((l) => l.startsWith('AUTH PLAIN '))!;
    expect(Buffer.from(plain.slice(11), 'base64').toString()).toBe('\0me@icloud.com\0app-pass');
    expect(f.log).toContain('MAIL FROM:<me@icloud.com>');
    expect(f.log).toContain('RCPT TO:<you@example.com>');
    expect(f.log.some((l) => l.startsWith('Message-ID: <') && l.endsWith('@icloud.com>'))).toBe(true);
    expect(f.log.some((l) => l.startsWith('Date: '))).toBe(true);
    expect(f.log).toContain('..Punkt');
  });

  it('falls back to AUTH LOGIN when PLAIN is not offered', async () => {
    const f = await fakeSmtp('LOGIN');
    open = f.server;
    await new SmtpMailer(cfg(f.port)).send({ to: 'you@example.com', subject: 's', text: 't' });
    expect(f.log).toContain('AUTH LOGIN');
    expect(f.log).toContain(Buffer.from('app-pass').toString('base64'));
  });

  it('rejects header injection in addresses', async () => {
    const f = await fakeSmtp('PLAIN');
    open = f.server;
    await expect(new SmtpMailer(cfg(f.port)).send({ to: 'a@b.c>\r\nBcc: x@y.z', subject: 's', text: 't' })).rejects.toThrow();
  });
});

describe('SMTP settings', () => {
  it('derives port and security, sender defaults to the login', () => {
    expect(smtpConfigFrom({ SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'me@gmail.com', SMTP_PASS: 'x' })).toMatchObject({
      host: 'smtp.gmail.com', port: 587, security: 'starttls', from: 'me@gmail.com',
    });
    expect(smtpConfigFrom({ SMTP_HOST: 'h', SMTP_PORT: '465' })).toMatchObject({ port: 465, security: 'ssl' });
    expect(smtpConfigFrom({ SMTP_HOST: 'h', SMTP_SECURITY: 'ssl' })).toMatchObject({ port: 465 });
    expect(smtpConfigFrom({})).toBeUndefined();
    expect(() => smtpConfigFrom({ SMTP_HOST: 'h', SMTP_SECURITY: 'tls' })).toThrow();
  });

  it('still understands the old SMTP_URL, with special characters in the password', () => {
    expect(smtpConfigFrom({ SMTP_URL: 'smtps://u%40x.de:p%2Fw@mail.x.de', MAIL_FROM: 'n@x.de' })).toMatchObject({
      host: 'mail.x.de', port: 465, security: 'ssl', user: 'u@x.de', pass: 'p/w', from: 'n@x.de',
    });
  });
});

describe('graphic account mails', () => {
  it('build text + HTML + inline header picture, with the link in both parts', async () => {
    const { verifyMail } = await import('../src/mail-templates.js');
    const { mimeBody } = await import('../src/mailer.js');
    const m = verifyMail('you@example.com', 'db9', 'https://spiel.example/#verify=abc');
    expect(m.text).toContain('https://spiel.example/#verify=abc');
    expect(m.html).toContain('cid:sonar-header@tiefenkontakt');
    expect(m.inline![0]!.data.subarray(1, 4).toString()).toBe('PNG');
    const body = mimeBody(m).join('\r\n');
    expect(body).toMatch(/multipart\/alternative/);
    expect(body).toMatch(/multipart\/related/);
    expect(body).toContain('Content-ID: <sonar-header@tiefenkontakt>');
    // No line over the SMTP limit of 998 characters
    expect(Math.max(...body.split('\r\n').map((l) => l.length))).toBeLessThan(998);
  });

  it('send through SMTP as one multipart message', async () => {
    const { resetMail } = await import('../src/mail-templates.js');
    const f = await fakeSmtp('PLAIN');
    open = f.server;
    await new SmtpMailer(cfg(f.port)).send(resetMail('you@example.com', 'db9', 'https://x/#reset=1'));
    expect(f.log.some((l) => l.startsWith('Content-Type: multipart/alternative'))).toBe(true);
    expect(f.log.some((l) => l.startsWith('Content-Type: image/png'))).toBe(true);
  });
});
