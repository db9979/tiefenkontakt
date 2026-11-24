import { describe, expect, it } from 'vitest';
import type { ServerMsg } from '@tk/shared';
import { CLASSES, createShip, createWorld, installWeapons, launchAswRocket } from '@tk/shared';
import { Lobby } from '../src/lobby.js';
import type { Conn } from '../src/match.js';
import { computeScore, evaluate } from '../src/rules.js';

function conn(id: string): Conn & { inbox: ServerMsg[] } {
  const inbox: ServerMsg[] = [];
  return { playerId: id, callsign: id, inbox, send: (m) => inbox.push(m) };
}

describe('mixed teams', () => {
  it('one hunter-killer boat for the Westbund, one patrol ship for the Ostpakt', () => {
    const lobby = new Lobby();
    const [a, b, c] = [conn('w1'), conn('w2'), conn('e1')];
    for (const x of [a, b, c]) { lobby.connect(x); lobby.resume(x); }
    lobby.handle(a, { t: 'create_match', name: 'Gemischt' });
    const m = lobby.matchOf('w1')!;
    lobby.handle(b, { t: 'join', matchId: m.id, team: 'west' });
    lobby.handle(c, { t: 'join', matchId: m.id, team: 'east' });
    expect(m.pickClass('w1', 'ssw')).toBeUndefined();
    expect(m.pickClass('w2', 'ssw')).toMatch(/Nur ein gemischter Platz/);
    expect(m.pickClass('e1', 'ffk')).toBeUndefined();
    expect(m.pickClass('e1', 'ffg')).toMatch(/passt nicht/);
    expect(CLASSES.ssw.submarine && !CLASSES.ffk.submarine).toBe(true);
  });

  it('no own rocket goes into the moving haven round an own boat', () => {
    const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0, team: 'west' });
    const ssw = createShip({ id: 'u', cls: 'ssw', name: 'S-14', pos: { x: 0, y: 6000 }, heading: 0, depth: 80, team: 'west' });
    const w = createWorld([ffg, ssw], 1, { layerDepth: 0, layerLoss: 0, seaState: 2 });
    installWeapons(w);
    expect(launchAswRocket(w, ffg, { x: 500, y: 6500 })).toMatch(/Sperrgebiet/);
    expect(launchAswRocket(w, ffg, { x: 0, y: -6000 })).toBe(true);
  });

  it('the Westbund wins when the wolfpack is sunk, even with the patrol ship afloat', () => {
    const ssk = createShip({ id: 'e1', cls: 'ssk', name: 'U', pos: { x: 0, y: 9000 }, heading: 0, depth: 80, team: 'east' });
    const ffk = createShip({ id: 'e2', cls: 'ffk', name: 'P', pos: { x: 0, y: 8000 }, heading: 0, team: 'east' });
    const m1 = createShip({ id: 'm1', cls: 'merchant', name: 'M', pos: { x: 0, y: 0 }, heading: 0, team: 'west' });
    const w = createWorld([ssk, ffk, m1], 1, { layerDepth: 0, layerLoss: 0, seaState: 2 });
    ssk.alive = false;
    expect(evaluate(w, 3600)?.winner).toBe('west');
  });
  it('merchants sunk by the patrol ship count half toward the tonnage goal', () => {
    const ssk = createShip({ id: 'e1', cls: 'ssk', name: 'U', pos: { x: 0, y: 9000 }, heading: 0, depth: 80, team: 'east' });
    const ffk = createShip({ id: 'e2', cls: 'ffk', name: 'P', pos: { x: 0, y: 8000 }, heading: 0, team: 'east' });
    const ms = [1, 2, 3, 4].map((i) => createShip({ id: `m${i}`, cls: 'merchant', name: 'M', pos: { x: i * 500, y: 0 }, heading: 0, team: 'west' }));
    const w = createWorld([ssk, ffk, ...ms], 1, { layerDepth: 0, layerLoss: 0, seaState: 2 });
    const sink = (m: (typeof ms)[number], by: string) => { m.alive = false; w.events.push({ kind: 'sunk', time: w.time, shipId: m.id, byId: by }); };
    sink(ms[0]!, 'e2');
    sink(ms[1]!, 'e2');
    // Half the tonnage is down, but the missiles' share counts half: 25 %
    expect(computeScore(w).countedTons).toBe(computeScore(w).totalTons / 4);
    expect(evaluate(w, 3600)).toBeUndefined();
    sink(ms[2]!, 'e1');
    expect(evaluate(w, 3600)?.winner).toBe('east');
  });
});
