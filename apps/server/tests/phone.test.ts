import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { ServerMsg } from '@tk/shared';
import { PhoneHub } from '../src/phone.js';
import type { Conn } from '../src/match.js';

class FakeWs extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  closed?: number;
  send(t: string) { this.sent.push(t); }
  close(code: number) { this.closed = code; this.readyState = 3; this.emit('close'); }
}

const main = (): Conn & { inbox: ServerMsg[] } => {
  const inbox: ServerMsg[] = [];
  return { playerId: 'u-1', callsign: 'K', inbox, send: (m) => inbox.push(m) };
};

describe('phone view', () => {
  it('pairs once with a fresh code, mirrors snapshots and forwards only looking', () => {
    const hub = new PhoneHub();
    const pc = main();
    const code = hub.link(pc, 1000);
    const ws = new FakeWs();
    expect(hub.attach(ws as never, code, 2000)).toBe(true);
    expect(pc.inbox.at(-1)).toEqual({ t: 'phone', ev: 'on' });
    // The code works once
    const again = new FakeWs();
    expect(hub.attach(again as never, code, 2000)).toBe(false);
    expect(again.closed).toBe(4003);
    // Snapshots are mirrored, lobby chatter is not
    hub.mirror('u-1', { t: 'snap', s: {} as never }, '{"t":"snap"}');
    hub.mirror('u-1', { t: 'lobby', matches: [] }, '{"t":"lobby"}');
    expect(ws.sent).toEqual(['{"t":"snap"}']);
    // Looking goes to the PC; anything else (orders, firing) is dropped
    ws.emit('message', JSON.stringify({ t: 'look', bearing: 123, elev: 4, mag: 8, glass: true }));
    ws.emit('message', JSON.stringify({ t: 'fire', heading: 10 }));
    ws.emit('message', JSON.stringify({ t: 'select', label: 'S3' }));
    expect(pc.inbox.filter((m) => m.t.startsWith('phone_'))).toEqual([
      { t: 'phone_look', bearing: 123, elev: 4, mag: 8, glass: true },
      { t: 'phone_select', label: 'S3' },
    ]);
    ws.close(1000);
    expect(pc.inbox.at(-1)).toEqual({ t: 'phone', ev: 'off' });
  });

  it('refuses expired codes', () => {
    const hub = new PhoneHub();
    const code = hub.link(main(), 0);
    const ws = new FakeWs();
    expect(hub.attach(ws as never, code, 11 * 60_000)).toBe(false);
  });
});
