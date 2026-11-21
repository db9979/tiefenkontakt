import { describe, expect, it } from 'vitest';
import {
  ContactBook,
  DEFAULT_ENV,
  Rng,
  angleDiff,
  createShip,
  createWorld,
  runSensors,
  stepWorld,
  transmit,
  type Ship,
} from '../src/index.js';

function ctx(ships: Ship[], time = 1000, seed = 7) {
  return { ships, env: DEFAULT_ENV, time, rng: new Rng(seed) };
}

describe('passive sonar', () => {
  it('reports noisy bearings close to the truth, never positions', () => {
    const sub = createShip({ id: 'u1', cls: 'ssk', name: 'U1', pos: { x: 0, y: 0 }, heading: 0, speedKn: 4, depth: 60 });
    const ship = createShip({ id: 'm1', cls: 'merchant', name: 'M1', pos: { x: 10_000, y: 10_000 }, heading: 270, speedKn: 10 });
    const dets = runSensors(ctx([sub, ship])).filter((d) => d.observerId === 'u1' && d.sensor === 'hull');
    expect(dets).toHaveLength(1);
    expect(Math.abs(angleDiff(dets[0]!.bearing, 45))).toBeLessThan(3);
    expect(dets[0]!.range).toBeUndefined();
  });

  it('is deaf in the baffles astern', () => {
    const sub = createShip({ id: 'u1', cls: 'ssk', name: 'U1', pos: { x: 0, y: 0 }, heading: 0, speedKn: 4, depth: 60 });
    const ship = createShip({ id: 'm1', cls: 'merchant', name: 'M1', pos: { x: 0, y: -10_000 }, heading: 90, speedKn: 10 });
    const dets = runSensors(ctx([sub, ship])).filter((d) => d.observerId === 'u1' && d.sensor === 'hull');
    expect(dets).toHaveLength(0);
  });

  it('towed array gives a mirrored ambiguous bearing and needs a steady course', () => {
    const ffg = createShip({ id: 'f1', cls: 'ffg', name: 'F1', pos: { x: 0, y: 0 }, heading: 0, speedKn: 10 });
    ffg.towedLength = 400;
    const ssn = createShip({ id: 'u2', cls: 'ssn', name: 'U2', pos: { x: 3000, y: 0 }, heading: 0, speedKn: 12, depth: 60 });
    const towed = (s: Ship[]) => runSensors(ctx(s)).filter((d) => d.observerId === 'f1' && d.sensor === 'towed');
    const dets = towed([ffg, ssn]);
    expect(dets).toHaveLength(1);
    const d = dets[0]!;
    const pair = [d.bearing, d.bearingAlt!].sort((a, b) => a - b);
    expect(Math.abs(angleDiff(pair[0]!, 90))).toBeLessThan(3);
    expect(Math.abs(angleDiff(pair[1]!, 270))).toBeLessThan(3);

    ffg.lastTurnAt = 990; // just turned
    expect(towed([ffg, ssn])).toHaveLength(0);
  });
});

describe('active sonar', () => {
  it('gives range and reveals the pinger to the target', () => {
    const ffg = createShip({ id: 'f1', cls: 'ffg', name: 'F1', pos: { x: 0, y: 0 }, heading: 0, speedKn: 12 });
    ffg.activeSonar = true;
    const sub = createShip({ id: 'u1', cls: 'ssk', name: 'U1', pos: { x: 0, y: 4000 }, heading: 90, speedKn: 4, depth: 60 });
    const dets = runSensors(ctx([ffg, sub]));
    const echo = dets.find((d) => d.observerId === 'f1' && d.sensor === 'active');
    const intercept = dets.find((d) => d.observerId === 'u1' && d.sensor === 'intercept');
    expect(echo?.range).toBeGreaterThan(3800);
    expect(echo?.range).toBeLessThan(4200);
    expect(intercept).toBeDefined();
    expect(Math.abs(angleDiff(intercept!.bearing, 180))).toBeLessThan(3);
  });
});

describe('radio transmissions', () => {
  it('give enemy ships an ESM bearing on the sender', () => {
    const sub = createShip({ id: 'u1', cls: 'ssk', name: 'U1', pos: { x: 0, y: 30_000 }, heading: 0, depth: 18 });
    sub.mastUp = true;
    const ffg = createShip({ id: 'f1', cls: 'ffg', name: 'F1', pos: { x: 0, y: 0 }, heading: 0, speedKn: 12 });
    const w = createWorld([sub, ffg], 3);
    transmit(w, sub, 'Konvoi gesichtet');
    const track = w.books.get('f1')?.tracks()[0];
    expect(track?.label).toBe('E1');
    expect(Math.abs(angleDiff(track!.bearing, 0))).toBeLessThan(5);
  });
});

describe('contact book', () => {
  it('labels contacts without exposing target ids', () => {
    const book = new ContactBook();
    const tr = book.ingest({ observerId: 'a', targetId: 'secret', sensor: 'hull', time: 1, bearing: 10, se: 3 });
    expect(tr.label).toBe('S1');
    expect(JSON.stringify(book.tracks())).not.toContain('secret');
    expect(book.targetIdOf('S1')).toBe('secret');
  });

  it('builds tracks in the world over time', () => {
    const sub = createShip({ id: 'u1', cls: 'ssk', name: 'U1', pos: { x: 0, y: 0 }, heading: 0, speedKn: 4, depth: 60 });
    const ship = createShip({ id: 'm1', cls: 'merchant', name: 'M1', pos: { x: 8000, y: 8000 }, heading: 270, speedKn: 10 });
    const w = createWorld([sub, ship], 11);
    for (let i = 0; i < 300; i++) stepWorld(w);
    const tr = w.books.get('u1')?.tracks()[0];
    expect(tr?.history.length).toBeGreaterThan(20);
  });
});
