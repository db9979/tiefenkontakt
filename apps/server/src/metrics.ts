import { monitorEventLoopDelay } from 'node:perf_hooks';

/** Server health numbers for /api/metrics: tick cost, event-loop lag, traffic, memory. */
class Metrics {
  readonly started = Date.now();
  private ticks: number[] = [];
  private loop = monitorEventLoopDelay({ resolution: 10 });
  bytesSent = 0;
  msgsSent = 0;
  msgsReceived = 0;
  private window = { at: Date.now(), bytes: 0, msgs: 0 };

  constructor() {
    this.loop.enable();
  }

  /** Run one match tick and record how long it took. */
  timeTick(fn: () => void): void {
    const t0 = performance.now();
    fn();
    this.ticks.push(performance.now() - t0);
    if (this.ticks.length > 3000) this.ticks.splice(0, this.ticks.length - 3000);
  }

  sent(bytes: number): void {
    this.bytesSent += bytes;
    this.msgsSent++;
  }

  snapshot(extra: Record<string, number>) {
    const now = Date.now();
    const dt = Math.max(1, (now - this.window.at) / 1000);
    const rate = { bytesPerS: Math.round((this.bytesSent - this.window.bytes) / dt), msgsPerS: Math.round((this.msgsSent - this.window.msgs) / dt) };
    if (now - this.window.at > 10_000) this.window = { at: now, bytes: this.bytesSent, msgs: this.msgsSent };
    const sorted = [...this.ticks].sort((a, b) => a - b);
    const pct = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]! : 0);
    const mem = process.memoryUsage();
    const out = {
      uptimeS: Math.round((now - this.started) / 1000),
      ...extra,
      tickMsAvg: sorted.length ? +(sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(3) : 0,
      tickMsP95: +pct(0.95).toFixed(3),
      tickMsMax: +pct(1).toFixed(3),
      eventLoopLagMsP99: +(this.loop.percentile(99) / 1e6).toFixed(2),
      bytesSentTotal: this.bytesSent,
      msgsSentTotal: this.msgsSent,
      msgsReceivedTotal: this.msgsReceived,
      bytesSentPerS: rate.bytesPerS,
      msgsSentPerS: rate.msgsPerS,
      rssMb: Math.round(mem.rss / 1e6),
      heapMb: Math.round(mem.heapUsed / 1e6),
    };
    return out;
  }

  /** Prometheus text format of the same numbers. */
  prometheus(extra: Record<string, number>): string {
    return Object.entries(this.snapshot(extra)).map(([k, v]) => `tiefenkontakt_${k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)} ${v}`).join('\n') + '\n';
  }
}

export const metrics = new Metrics();
