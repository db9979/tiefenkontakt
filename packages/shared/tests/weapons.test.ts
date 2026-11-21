import { describe, expect, it } from 'vitest';
import {
  bearing,
  createShip,
  createWorld,
  dropDepthCharge,
  fireTorpedo,
  installWeapons,
  launchAswRocket,
  launchNoisemaker,
  stepWorld,
  type Torpedo,
} from '../src/index.js';

function duel(merchantAt = { x: 0, y: 5000 }) {
  const sub = createShip({ id: 'u1', cls: 'ssk', name: 'U1', pos: { x: 0, y: 0 }, heading: 0, speedKn: 3, depth: 60 });
  const m = createShip({ id: 'm1', cls: 'merchant', name: 'M1', pos: merchantAt, heading: 90, speedKn: 10 });
  const w = createWorld([sub, m], 2);
  installWeapons(w);
  return { w, sub, m };
}

describe('torpedoes', () => {
  it('a heavyweight fired at a merchant homes in and sinks it', () => {
    const { w, sub, m } = duel();
    const t = fireTorpedo(w, sub, { heading: bearing(sub.pos, m.pos) + 5, enableAfter: 2500, searchDepth: 10 });
    expect(typeof t).not.toBe('string');
    for (let i = 0; i < 6000 && m.alive; i++) stepWorld(w);
    expect(m.alive).toBe(false);
    expect(w.events.some((e) => e.kind === 'sunk' && e.shipId === 'm1' && e.byId === 'u1')).toBe(true);
  });

  it('empties tubes and reloads from storage', () => {
    const { w, sub } = duel();
    const l = w.weapons!.loadouts.get('u1')!;
    for (let i = 0; i < 6; i++) fireTorpedo(w, sub, { heading: 270 });
    expect(fireTorpedo(w, sub, { heading: 270 })).toBe('Kein Rohr geladen');
    for (let i = 0; i < 1300; i++) stepWorld(w);
    expect(l.tubes.some((t) => t.loaded)).toBe(true);
  });

  it('warns the target ship of an incoming torpedo', () => {
    const ffg = createShip({ id: 'f1', cls: 'ffg', name: 'F1', pos: { x: 0, y: 6000 }, heading: 90, speedKn: 12 });
    const sub = createShip({ id: 'u1', cls: 'ssn', name: 'U1', pos: { x: 0, y: 0 }, heading: 0, speedKn: 3, depth: 60 });
    const w = createWorld([sub, ffg], 4);
    installWeapons(w);
    fireTorpedo(w, sub, { heading: 0 });
    for (let i = 0; i < 100; i++) stepWorld(w);
    expect(w.events.some((e) => e.kind === 'torpedo_alert' && e.shipId === 'f1')).toBe(true);
  });

  it('a noisemaker can seduce a torpedo', () => {
    const { w, sub, m } = duel({ x: 0, y: 4000 });
    m.order.speedKn = 0;
    m.speed = 0;
    fireTorpedo(w, sub, { heading: 0, enableAfter: 600, searchDepth: 10 });
    const decoyHost = createShip({ id: 'x', cls: 'ssk', name: 'X', pos: { x: 0, y: 2000 }, heading: 0, depth: 10 });
    w.ships.push(decoyHost);
    w.weapons!.loadouts.set('x', { ...w.weapons!.loadouts.get('u1')!, noisemakers: 1 });
    launchNoisemaker(w, decoyHost);
    decoyHost.pos = { x: 5000, y: -5000 };
    for (let i = 0; i < 300; i++) stepWorld(w);
    const t = w.weapons!.torpedoes[0] as Torpedo | undefined;
    expect(t?.homingOn ?? 'gone').not.toBe('m1');
  });
});

describe('frigate ASW weapons', () => {
  it('an ASW rocket drops a searching torpedo near a submarine', () => {
    const ffg = createShip({ id: 'f1', cls: 'ffg', name: 'F1', pos: { x: 0, y: 0 }, heading: 0, speedKn: 10 });
    const sub = createShip({ id: 'u1', cls: 'ssk', name: 'U1', pos: { x: 0, y: 8000 }, heading: 90, speedKn: 3, depth: 100 });
    const w = createWorld([ffg, sub], 9);
    installWeapons(w);
    expect(launchAswRocket(w, ffg, { x: 200, y: 8000 })).toBe(true);
    for (let i = 0; i < 3000 && sub.alive; i++) stepWorld(w);
    expect(sub.hp).toBeLessThan(80);
  });

  it('depth charges hurt only nearby submarines', () => {
    const ffg = createShip({ id: 'f1', cls: 'ffg', name: 'F1', pos: { x: 0, y: 0 }, heading: 0 });
    const near = createShip({ id: 'u1', cls: 'ssk', name: 'U1', pos: { x: 20, y: 0 }, heading: 0, depth: 100 });
    const far = createShip({ id: 'u2', cls: 'ssk', name: 'U2', pos: { x: 3000, y: 0 }, heading: 0, depth: 100 });
    const w = createWorld([ffg, near, far], 9);
    installWeapons(w);
    dropDepthCharge(w, ffg, 100);
    for (let i = 0; i < 300; i++) stepWorld(w);
    expect(near.hp).toBeLessThan(80);
    expect(far.hp).toBe(80);
  });
});
