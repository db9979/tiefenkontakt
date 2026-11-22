import type { IncomingMessage, ServerResponse } from 'node:http';
import { request } from 'node:http';
import { connect } from 'node:net';
import type { Duplex } from 'node:stream';
import { sfuConfig } from './voice-config.js';

/**
 * Pass-through for the LiveKit signalling under /lk/ (HTTP and WebSocket), so browsers reach
 * the voice server through the game's own HTTPS address and no extra reverse-proxy rule is
 * needed. The media itself (UDP) goes to the LiveKit ports directly.
 */

function target(): URL | undefined {
  const cfg = sfuConfig();
  return cfg ? new URL(cfg.apiUrl) : undefined;
}

const strip = (url: string) => url.replace(/^\/lk/, '') || '/';

export function lkHttp(req: IncomingMessage, res: ServerResponse): void {
  const t = target();
  if (!t) return void res.writeHead(404).end();
  const p = request({ host: t.hostname, port: Number(t.port || 80), path: strip(req.url ?? '/'), method: req.method, headers: { ...req.headers, host: t.host } }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  p.on('error', () => res.headersSent ? res.destroy() : res.writeHead(502).end());
  req.pipe(p);
}

export function lkUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
  const t = target();
  if (!t) return void socket.destroy();
  const up = connect(Number(t.port || 80), t.hostname, () => {
    let h = `${req.method} ${strip(req.url ?? '/')} HTTP/1.1\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const k = req.rawHeaders[i]!;
      h += k.toLowerCase() === 'host' ? `Host: ${t.host}\r\n` : `${k}: ${req.rawHeaders[i + 1]}\r\n`;
    }
    up.write(`${h}\r\n`);
    if (head.length) up.write(head);
    socket.pipe(up).pipe(socket);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
}
