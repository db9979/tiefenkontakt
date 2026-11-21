import type { ClientMsg, ServerMsg } from '@tk/shared';

type Handler = (m: ServerMsg) => void;
export type LinkState = 'connecting' | 'online' | 'reconnecting' | 'replaced';

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
    ws.onopen = () => {
      this.retries = 0;
      this.setState('online');
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data as string) as ServerMsg;
      for (const h of this.handlers) h(msg);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      if (e.code === 4000) return this.setState('replaced');
      this.setState('reconnecting');
      const delay = Math.min(10_000, 500 * 2 ** this.retries++);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.open(), delay);
    };
  }

  on(h: Handler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  send(m: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
}

export const net = new Net();
