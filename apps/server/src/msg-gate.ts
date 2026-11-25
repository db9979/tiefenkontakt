import type { ClientMsg } from '@tk/shared';

type OrderMsg = Extract<ClientMsg, { t: 'order' }>;

/**
 * Per-connection flood limit for game messages. Above `max` per second, messages are not
 * applied — except helm orders: a compass drag sends many, and only its last one matters, so
 * the latest order is kept and applied when the window reopens. The final course is never lost.
 */
export class MsgGate {
  private windowStart = -Infinity;
  private count = 0;
  private pending?: OrderMsg;
  private timer?: ReturnType<typeof setTimeout>;
  private warned = false;

  constructor(
    private readonly max: number,
    private readonly apply: (m: ClientMsg) => void,
    /** Told once per window that something other than an order was refused. */
    private readonly refused: () => void,
  ) {}

  /** Cheap pre-check before parsing: a gross flood is dropped without any work. */
  flooding(): boolean {
    return Date.now() - this.windowStart < 1000 && this.count >= this.max * 4;
  }

  /** An unreadable message counts toward the limit too; true while it may still be answered. */
  invalid(): boolean {
    this.roll(Date.now());
    return ++this.count <= this.max;
  }

  offer(msg: ClientMsg): void {
    const now = Date.now();
    this.roll(now);
    this.count++;
    if (this.count <= this.max) {
      if (msg.t === 'order' && this.pending) msg = this.takePending(msg);
      this.apply(msg);
      return;
    }
    if (msg.t === 'order') {
      this.pending = this.pending ? merge(this.pending, msg) : msg;
      this.timer ??= setTimeout(() => this.flush(), Math.max(0, this.windowStart + 1000 - now));
    } else if (!this.warned) {
      this.warned = true;
      this.refused();
    }
  }

  private roll(now: number): void {
    if (now - this.windowStart < 1000) return;
    this.windowStart = now;
    this.count = 0;
    this.warned = false;
  }

  /** The connection closed: nothing more to apply. */
  close(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
  }

  private takePending(newer: OrderMsg): OrderMsg {
    const m = merge(this.pending!, newer);
    this.close();
    return m;
  }

  private flush(): void {
    this.timer = undefined;
    const p = this.pending;
    this.pending = undefined;
    if (p) this.offer(p);
  }
}

/** A later order overrides only the fields it sets (heading, speed, depth are independent). */
function merge(older: OrderMsg, newer: OrderMsg): OrderMsg {
  const m: OrderMsg = { ...older };
  if (newer.heading !== undefined) m.heading = newer.heading;
  if (newer.speedKn !== undefined) m.speedKn = newer.speedKn;
  if (newer.depth !== undefined) m.depth = newer.depth;
  return m;
}
