import type { ClientMsg, ServerMsg } from '@tk/shared';

type Handler = (m: ServerMsg) => void;

/** In a match the server sends 10 snapshots a second: this long without anything means a dead link. */
export const SILENCE_MS = 5000;
export type LinkState = 'connecting' | 'online' | 'reconnecting' | 'replaced' | 'banned';

/** Per-tab guest identity: survives reloads, differs between tabs (so two tabs are two players). */
function guestToken(): string {
  let t = sessionStorage.getItem('tk_gid');
  if (!t || !/^[a-f0-9]{32}$/.test(t)) {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    t = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    sessionStorage.setItem('tk_gid', t);
  }
  return t;
}

/** WebSocket with automatic reconnect; the server puts a returning player back on their ship. */
export class Net {
  private ws?: WebSocket;
  private handlers = new Set<Handler>();
  private guest = '';
  private retries = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private watchdog?: ReturnType<typeof setInterval>;
  /** When the last message arrived, and whether snapshots are flowing (a match is running). */
  private lastMsgAt = 0;
  private inMatch = false;
  state: LinkState = 'connecting';
  onState?: (s: LinkState) => void;

  private setState(s: LinkState): void {
    this.state = s;
    this.onState?.(s);
  }

  /** Connect with the session cookie; a non-empty guest callsign plays without account. */
  connect(guest: string): void {
    this.guest = guest;
    if (guest) sessionStorage.setItem('tk_guest', guest);
    this.open();
  }

  private open(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const q = this.guest ? `?guest=${encodeURIComponent(this.guest)}&gid=${guestToken()}` : '';
    const ws = new WebSocket(`${proto}://${location.host}/ws${q}`);
    this.ws = ws;
    this.inMatch = false;
    this.watchdog ??= setInterval(() => this.checkSilence(), 1000);
    ws.onopen = () => {
      this.retries = 0;
      this.lastMsgAt = Date.now();
      this.setState('online');
    };
    ws.onmessage = (e) => {
      this.lastMsgAt = Date.now();
      let msg: ServerMsg;
      try {
        msg = JSON.parse(e.data as string) as ServerMsg;
      } catch (err) {
        return rethrow(err);
      }
      if (msg.t === 'snap') this.inMatch = true;
      else if (msg.t === 'end' || msg.t === 'removed' || msg.t === 'welcome') this.inMatch = false;
      // One throwing screen must not stop the others from getting the message
      for (const h of this.handlers) {
        try {
          h(msg);
        } catch (err) {
          rethrow(err);
        }
      }
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      if (e.code === 4000) return this.setState('replaced');
      if (e.code === 4001) return this.setState('banned');
      this.reconnect();
    };
  }

  private reconnect(): void {
    this.setState('reconnecting');
    const delay = Math.min(10_000, 500 * 2 ** this.retries++);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.open(), delay);
  }

  /**
   * A link can die without a close event (Wi-Fi handover, a phone leaving coverage): the socket
   * then looks open for minutes. In a match nothing arriving for SILENCE_MS means it is gone.
   */
  private checkSilence(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || !this.inMatch || Date.now() - this.lastMsgAt < SILENCE_MS) return;
    this.ws = undefined; // its late close event is ignored
    try {
      ws.close();
    } catch {
      // already gone
    }
    this.reconnect();
  }

  on(h: Handler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  send(m: ClientMsg): void {
    // Leaving the match or switching to watching: snapshots stop on purpose
    if (m.t === 'leave' || m.t === 'spectate') this.inMatch = false;
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
}

/** Report a handler's error (error-report.ts catches it as uncaught) without stopping the caller. */
function rethrow(err: unknown): void {
  setTimeout(() => {
    throw err;
  }, 0);
}

export const net = new Net();
