import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { ClientMsg, ServerMsg, Snapshot } from '@tk/shared';

/**
 * End-to-end over real WebSockets against a separately started server process:
 * lobby, match start, fog of war on the wire, reconnect, and a server restart.
 */

const PORT = 18_000 + Math.floor(Math.random() * 1000);
const DATA = mkdtempSync(join(tmpdir(), 'tk-e2e-'));
const SERVER_DIR = resolve(__dirname, '..');
let server: ChildProcess | undefined;

function startServer(): Promise<void> {
  return new Promise((ok, fail) => {
    server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: SERVER_DIR,
      env: { ...process.env, PORT: String(PORT), DB_PATH: join(DATA, 'db.sqlite'), MATCH_DIR: join(DATA, 'matches'), NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => fail(new Error('server did not start')), 15_000);
    server.stdout!.on('data', (d: Buffer) => {
      if (d.toString().includes('Tiefenkontakt-Server')) {
        clearTimeout(timer);
        ok();
      }
    });
  });
}

function stopServer(): Promise<void> {
  return new Promise((ok) => {
    if (!server || server.exitCode !== null) return ok();
    server.once('exit', () => ok());
    server.kill('SIGTERM');
  });
}

class Client {
  ws!: WebSocket;
  inbox: ServerMsg[] = [];
  constructor(private name: string, private gid: string) {}

  open(): Promise<void> {
    return new Promise((ok, fail) => {
      this.ws = new WebSocket(`ws://localhost:${PORT}/ws?guest=${this.name}&gid=${this.gid}`);
      this.ws.on('message', (d) => this.inbox.push(JSON.parse(d.toString()) as ServerMsg));
      this.ws.on('open', () => ok());
      this.ws.on('error', fail);
    });
  }

  send(m: ClientMsg): void {
    this.ws.send(JSON.stringify(m));
  }

  async waitFor<T extends ServerMsg['t']>(t: T, pred: (m: Extract<ServerMsg, { t: T }>) => boolean = () => true, ms = 8000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const hit = [...this.inbox].reverse().find((m) => m.t === t && pred(m as Extract<ServerMsg, { t: T }>));
      if (hit) return hit as Extract<ServerMsg, { t: T }>;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`timeout waiting for ${t}`);
  }

  close(): Promise<void> {
    return new Promise((ok) => {
      if (this.ws.readyState === WebSocket.CLOSED) return ok();
      this.ws.once('close', () => ok());
      this.ws.close();
    });
  }
}

const tokenA = 'a'.repeat(32);
const tokenB = 'b'.repeat(32);

afterAll(async () => {
  await stopServer();
});

describe('end to end over WebSocket', () => {
  it('plays, hides the enemy, reconnects and survives a restart', async () => {
    await startServer();
    const west = new Client('Fregatte', tokenA);
    const east = new Client('Uboot', tokenB);
    await west.open();
    await east.open();
    await west.waitFor('welcome');
    west.send({ t: 'create_match', name: 'E2E' });
    const lobby = await west.waitFor('match');
    east.send({ t: 'join', matchId: lobby.match.id, team: 'east' });
    await east.waitFor('match', (m) => m.match.slots.length === 2);
    west.send({ t: 'ready', ready: true });
    east.send({ t: 'ready', ready: true });
    const first = await west.waitFor('snap');
    const eastSnap = (await east.waitFor('snap')).s;
    west.send({ t: 'order', heading: 45, speedKn: 10 });
    await west.waitFor('snap', (m) => m.s.own.order.heading === 45);

    // Fog of war on the wire: the frigate's stream never carries the submarine's id or position
    await new Promise((r) => setTimeout(r, 1500));
    const westWire = west.inbox.filter((m) => m.t === 'snap').map((m) => JSON.stringify(m)).join('');
    expect(westWire).not.toContain(eastSnap.own.id);
    expect(westWire).not.toContain(`"x":${eastSnap.own.x}`);

    // Reconnect with the same guest token: same ship, match continues
    const shipId = first.s.own.id;
    await west.close();
    const back = new Client('Fregatte', tokenA);
    await back.open();
    const welcome = await back.waitFor('welcome');
    expect(welcome.resume).toBe(true);
    expect((await back.waitFor('snap')).s.own.id).toBe(shipId);

    // Server restart: the match is saved on SIGTERM and restored
    const before: Snapshot = (await back.waitFor('snap')).s;
    await stopServer();
    await startServer();
    const again = new Client('Fregatte', tokenA);
    const eastAgain = new Client('Uboot', tokenB);
    await again.open();
    await eastAgain.open();
    const after = (await again.waitFor('snap', () => true, 10_000)).s;
    expect(after.own.id).toBe(shipId);
    expect(after.time).toBeGreaterThanOrEqual(before.time);
    await again.close();
    await eastAgain.close();
    await east.close();
  }, 60_000);
});
