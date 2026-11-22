/**
 * Load test over real WebSockets: starts a server process, opens N matches with two
 * human clients each (AI fills the rest), plays for S seconds and reports wire traffic,
 * snapshot rate and the server's own metrics.
 * Usage: npx tsx scripts/net-load-test.ts [matches=10] [seconds=60]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { WebSocket } from 'ws';

const MATCHES = Number(process.argv[2] ?? 10);
const SECONDS = Number(process.argv[3] ?? 60);
const PORT = 19_000 + Math.floor(Math.random() * 500);
const TOKEN = 'loadtest-' + Math.random().toString(36).slice(2);
const data = mkdtempSync(join(tmpdir(), 'tk-load-'));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  cwd: resolve(import.meta.dirname, '../apps/server'),
  env: { ...process.env, PORT: String(PORT), DB_PATH: join(data, 'db.sqlite'), MATCH_DIR: join(data, 'm'), METRICS_TOKEN: TOKEN, NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise<void>((ok) => server.stdout!.on('data', (d: Buffer) => d.toString().includes('Tiefenkontakt-Server') && ok()));

interface Client { ws: WebSocket; snaps: number; inbox: { t: string; match?: { id: string } }[] }
const open = (name: string, i: number) => new Promise<Client>((ok) => {
  const gid = i.toString(16).padStart(32, 'a');
  const ws = new WebSocket(`ws://localhost:${PORT}/ws?guest=${name}&gid=${gid}`);
  const c: Client = { ws, snaps: 0, inbox: [] };
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.t === 'snap') c.snaps++;
    else c.inbox.push(m);
  });
  ws.on('open', () => ok(c));
});

const clients: Client[] = [];
for (let i = 0; i < MATCHES; i++) {
  const a = await open(`W${i}`, i * 2);
  const b = await open(`O${i}`, i * 2 + 1);
  a.ws.send(JSON.stringify({ t: 'create_match', name: `Last ${i}` }));
  await wait(150);
  const id = a.inbox.find((m) => m.t === 'match')!.match!.id;
  b.ws.send(JSON.stringify({ t: 'join', matchId: id, team: 'east' }));
  await wait(100);
  a.ws.send(JSON.stringify({ t: 'ready', ready: true }));
  b.ws.send(JSON.stringify({ t: 'ready', ready: true }));
  clients.push(a, b);
}
const t0 = Date.now();
const read0 = clients.map((c) => (c.ws as unknown as { _socket: { bytesRead: number } })._socket.bytesRead);
// Players do something: every few seconds a course change
const busy = setInterval(() => {
  for (const c of clients) c.ws.send(JSON.stringify({ t: 'order', heading: Math.floor(Math.random() * 360), speedKn: 5 }));
}, 4000);
await wait(SECONDS * 1000);
clearInterval(busy);
const dt = (Date.now() - t0) / 1000;
const wire = clients.map((c, i) => ((c.ws as unknown as { _socket: { bytesRead: number } })._socket.bytesRead - read0[i]!) / dt);
const snapsPerS = clients.map((c) => c.snaps / dt);
const m = await (await fetch(`http://localhost:${PORT}/api/metrics`, { headers: { authorization: `Bearer ${TOKEN}` } })).json();
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
console.log(`${MATCHES} Partien, ${clients.length} Spieler (+ KI), ${dt.toFixed(0)} s`);
console.log(`Leitung pro Spieler (komprimiert): Ø ${(avg(wire) / 1024).toFixed(1)} KB/s, max ${(Math.max(...wire) / 1024).toFixed(1)} KB/s`);
console.log(`Snapshots pro Spieler: Ø ${avg(snapsPerS).toFixed(2)}/s (min ${Math.min(...snapsPerS).toFixed(2)})`);
console.log(`Server: Tick Ø ${m.tickMsAvg} ms, p95 ${m.tickMsP95} ms, max ${m.tickMsMax} ms · Event-Loop p99 ${m.eventLoopLagMsP99} ms · RSS ${m.rssMb} MB · ${m.matchesRunning} Partien laufen`);
const slow = clients.map((c, i) => ({ i, s: snapsPerS[i]!, msgs: c.inbox.map((x) => x.t + ((x as { msg?: string }).msg ? ':' + (x as { msg?: string }).msg : '')).slice(0, 8) })).filter((x) => x.s < 5);
if (slow.length) console.log('Langsame Clients:', JSON.stringify(slow));
for (const c of clients) c.ws.close();
server.kill('SIGTERM');
process.exit(0);
