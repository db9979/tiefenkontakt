import type { ClientMsg, ServerMsg } from '@tk/shared';

type Handler = (m: ServerMsg) => void;

/** Thin WebSocket wrapper with auto-reconnect disabled (a lost link ends the session). */
export class Net {
  private ws?: WebSocket;
  private handlers = new Set<Handler>();
  onClose?: () => void;

  /** Connect with the session cookie; a non-empty guest callsign plays without account. */
  connect(guest: string): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const q = guest ? `?guest=${encodeURIComponent(guest)}` : '';
    this.ws = new WebSocket(`${proto}://${location.host}/ws${q}`);
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data as string) as ServerMsg;
      for (const h of this.handlers) h(msg);
    };
    this.ws.onclose = () => this.onClose?.();
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
