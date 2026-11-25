import { alertRecipient } from './alerts.js';
import { adminMail, type AdminReport } from './admin-mail.js';
import { clientErrorReport, feedbackReport, playerReport, type ClientErrorItem, type FeedbackItem, type ReportItem } from './admin-live-mails.js';
import { log } from './log.js';
import type { Mailer } from './mailer.js';

/**
 * Mails the admin about feedback, player reports and browser errors. Items of one kind are
 * collected: the first goes out at once, later ones wait until the kind's gap has passed and
 * then go out together, so a test evening or a crash loop sends a few mails, not hundreds.
 * Settings (see .env.example): ADMIN_MAIL=0 off, ADMIN_MAIL_TO recipient (else ALERT_TO /
 * MAIL_FROM), ADMIN_MAIL_SKIP=feedback,meldung,fehler to leave out kinds,
 * ADMIN_MAIL_FEEDBACK_MIN / ADMIN_MAIL_MELDUNG_MIN / ADMIN_MAIL_FEHLER_MIN gaps in minutes.
 */

/** Collects items and hands them on at most once per gap. */
export class MailBatch<T> {
  private queue: T[] = [];
  private dropped = 0;
  private lastAt = -Infinity;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private gapMs: number, private flushTo: (items: T[], dropped: number) => void, private maxItems = 30, private now = () => Date.now()) {}

  push(item: T): void {
    if (this.queue.length < this.maxItems) this.queue.push(item);
    else this.dropped++;
    const wait = this.lastAt + this.gapMs - this.now();
    if (wait <= 0) this.flush();
    else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), wait);
      this.timer.unref?.();
    }
  }

  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.queue.length) return;
    const items = this.queue;
    const dropped = this.dropped;
    this.queue = [];
    this.dropped = 0;
    this.lastAt = this.now();
    this.flushTo(items, dropped);
  }

  get pending(): number {
    return this.queue.length + this.dropped;
  }
}

/** A browser error report (POST /api/client-error) cut to size; also what the server log shows. */
export function clientError(body: Record<string, unknown>, ua: string | undefined, user: string | undefined, at = Date.now()): ClientErrorItem {
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : undefined);
  return { at, msg: str(body.msg, 300) ?? '', stack: str(body.stack, 1200), where: str(body.where, 120), ua: str(ua, 160), user };
}

export type Kind ='feedback' | 'meldung' | 'fehler';
const DEFAULT_GAP_MIN: Record<Kind, number> = { feedback: 15, meldung: 5, fehler: 60 };

export interface NotifyConfig {
  to?: string;
  kinds: Set<Kind>;
  gapMs: Record<Kind, number>;
  url?: string;
}

export function notifyConfig(env: NodeJS.ProcessEnv = process.env): NotifyConfig {
  const skip = new Set((env.ADMIN_MAIL_SKIP ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  const kinds = new Set<Kind>(env.ADMIN_MAIL === '0' ? [] : (['feedback', 'meldung', 'fehler'] as Kind[]).filter((k) => !skip.has(k)));
  const gap = (k: Kind) => {
    const v = Number(env[`ADMIN_MAIL_${k.toUpperCase()}_MIN`]);
    return (Number.isFinite(v) && v >= 0 && env[`ADMIN_MAIL_${k.toUpperCase()}_MIN`]?.trim() ? v : DEFAULT_GAP_MIN[k]) * 60_000;
  };
  return {
    to: env.ADMIN_MAIL_TO?.trim() || alertRecipient(env), kinds,
    gapMs: { feedback: gap('feedback'), meldung: gap('meldung'), fehler: gap('fehler') }, url: env.PUBLIC_URL,
  };
}

export class AdminNotifier {
  readonly feedbackBatch: MailBatch<FeedbackItem>;
  readonly reportBatch: MailBatch<ReportItem>;
  readonly errorBatch: MailBatch<ClientErrorItem>;
  /** Mails in flight (tests await them). */
  pending: Promise<void>[] = [];

  constructor(private mailer: Pick<Mailer, 'send'>, readonly cfg: NotifyConfig, now = () => Date.now()) {
    const mk = <T>(k: Kind, build: (items: T[], dropped: number, url?: string) => AdminReport, max = 30) =>
      new MailBatch<T>(cfg.gapMs[k], (items, dropped) => this.send(build(items, dropped, cfg.url)), max, now);
    this.feedbackBatch = mk('feedback', feedbackReport);
    this.reportBatch = mk('meldung', playerReport);
    this.errorBatch = mk('fehler', clientErrorReport, 100);
  }

  private on(k: Kind): boolean {
    return !!this.cfg.to && this.cfg.kinds.has(k);
  }

  feedback(f: Omit<FeedbackItem, 'at' | 'callsign'>, callsign?: string): void {
    if (this.on('feedback')) this.feedbackBatch.push({ ...f, callsign, at: Date.now() });
  }

  report(r: ReportItem): void {
    if (this.on('meldung')) this.reportBatch.push(r);
  }

  clientError(e: ClientErrorItem): void {
    if (e.msg && this.on('fehler')) this.errorBatch.push(e);
  }

  private send(r: AdminReport): void {
    const p = this.mailer.send(adminMail(this.cfg.to!, r))
      .catch((e) => log('warn', 'Admin-Mail fehlgeschlagen', { subject: r.subject, error: (e as Error).message }));
    this.pending.push(p);
    if (this.pending.length > 20) this.pending.splice(0, this.pending.length - 20);
  }
}
