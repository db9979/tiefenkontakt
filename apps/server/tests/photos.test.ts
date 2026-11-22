import { describe, expect, it } from 'vitest';
import { PERISCOPE_DEPTH, createShip, createWorld, type ServerMsg, type Ship } from '@tk/shared';
import { gradePhoto, type PhotoMsg } from '../src/photos.js';
import { Lobby } from '../src/lobby.js';
import type { Conn } from '../src/match.js';

function scene(opts: { heading?: number; range?: number; light?: number; rain?: boolean } = {}) {
  const sub = createShip({ id: 'p_e1', cls: 'ssk', name: 'U', pos: { x: 0, y: 0 }, heading: 0, depth: PERISCOPE_DEPTH });
  sub.mastUp = true;
  sub.mastExt = 1;
  // Frigate due east, steaming north: seen broadside (querab)
  const ffg = createShip({ id: 'w-ffg', cls: 'ffg', name: 'F', pos: { x: opts.range ?? 3200, y: 0 }, heading: opts.heading ?? 0 });
  const w = createWorld([sub, ffg]);
  w.env = { ...w.env, seaState: 1, light: opts.light ?? 1, rain: opts.rain ?? false };
  w.time = 1000;
  return { w, sub, ffg };
}

const shot = (bearing: number, fov = 8, extra: Partial<PhotoMsg> = {}): PhotoMsg => ({ t: 'photo', id: 'ph-0001', bearing, fov, vfov: fov * 0.6, pitch: 0, ...extra });

describe('photo grading', () => {
  it('rates a centred broadside frigate at 3.2 km as a good photo', () => {
    const { w, sub } = scene();
    const p = gradePhoto(w, sub, shot(90), { playerId: 'e1', mastSince: 995 });
    expect(p.cls).toBe('ffg');
    expect(p.aspect).toBe('querab');
    expect(p.quality).toBe('gut');
    expect(p.score).toBeGreaterThanOrEqual(70);
    expect(p.comment).toBe('Gute Aufnahme: Fregatte F-12 querab, 3,2 km');
    expect(p.mastS).toBe(5);
  });

  it('finds nothing when the camera looks the other way', () => {
    const { w, sub } = scene();
    const p = gradePhoto(w, sub, shot(270), { playerId: 'e1' });
    expect(p.score).toBe(0);
    expect(p.quality).toBe('unbrauchbar');
    expect(p.comment).toContain('kein Ziel');
  });

  it('scores bow-on, wide-angle, off-centre and dark photos lower', () => {
    const good = gradePhoto(scene().w, scene().sub, shot(90), { playerId: 'e1' }).score;
    const s1 = scene({ heading: 270 });
    const bow = gradePhoto(s1.w, s1.sub, shot(90), { playerId: 'e1' });
    expect(bow.aspect).toBe('bug');
    expect(bow.score).toBeLessThan(good);
    const s2 = scene();
    expect(gradePhoto(s2.w, s2.sub, shot(90, 32), { playerId: 'e1' }).score).toBeLessThan(good);
    const edge = gradePhoto(s2.w, s2.sub, shot(87), { playerId: 'e1' });
    expect(edge.flaws).toContain('rand');
    expect(edge.score).toBeLessThan(good);
    const s3 = scene({ light: 0.2, rain: true, range: 1500 });
    const dark = gradePhoto(s3.w, s3.sub, shot(90), { playerId: 'e1' });
    expect(dark.flaws).toContain('sicht');
    expect(dark.score).toBeLessThan(good);
  });

  it('marks a target too small at long range', () => {
    const s = scene({ range: 14_000 });
    const p = gradePhoto(s.w, s.sub, shot(90, 32), { playerId: 'e1' });
    expect(p.cls).toBe('ffg');
    expect(p.flaws).toContain('klein');
    expect(p.quality === 'schwach' || p.quality === 'unbrauchbar').toBe(true);
  });

  it('costs points when the mast has been up too long', () => {
    const { w, sub } = scene();
    const quick = gradePhoto(w, sub, shot(90), { playerId: 'e1', mastSince: 990 });
    const slow = gradePhoto(w, sub, shot(90), { playerId: 'e1', mastSince: 900 });
    expect(slow.flaws).toContain('mast');
    expect(slow.mastS).toBe(100);
    expect(slow.score).toBeLessThan(quick.score);
    expect(slow.comment).toContain('Mast 100 s oben');
  });

  it('ignores submerged boats and prefers the selected target', () => {
    const { w, sub } = scene();
    const ssn: Ship = createShip({ id: 'x-ssn', cls: 'ssn', name: 'S', pos: { x: 2000, y: 0 }, heading: 0, depth: 60 });
    const kor = createShip({ id: 'w-kor', cls: 'kor', name: 'K', pos: { x: 2500, y: 100 }, heading: 0 });
    w.ships.push(ssn, kor);
    const p = gradePhoto(w, sub, shot(90), { playerId: 'e1' });
    expect(p.targetId).not.toBe('x-ssn');
    const q = gradePhoto(w, sub, shot(90), { playerId: 'e1', prefer: 'w-kor' });
    expect(q.targetId).toBe('w-kor');
    expect(q.comment).toContain('Korvette K-7');
  });
});

describe('photo messages in a match', () => {
  function conn(id: string): Conn & { inbox: ServerMsg[] } {
    const inbox: ServerMsg[] = [];
    return { playerId: id, callsign: id, inbox, send: (m) => inbox.push(m) };
  }

  it('needs the mast up on a boat, files photos for the debrief and keeps exact class assignments', () => {
    const lobby = new Lobby();
    const west = conn('w1');
    const east = conn('e1');
    for (const c of [west, east]) (lobby.connect(c), lobby.resume(c));
    lobby.handle(west, { t: 'create_match', name: 'Foto' });
    const m = lobby.matchOf('w1')!;
    lobby.handle(east, { t: 'join', matchId: m.id, team: 'east' });
    lobby.handle(east, { t: 'pick_class', cls: 'ssk' });
    lobby.handle(west, { t: 'ready', ready: true });
    lobby.handle(east, { t: 'ready', ready: true });
    m.stop();
    for (let i = 0; i < 5; i++) m.tick();
    lobby.handle(east, shot(0));
    expect(east.inbox.some((x) => x.t === 'error' && x.msg.includes('Sehrohr'))).toBe(true);
    // The frigate's bridge may always take pictures
    lobby.handle(west, { ...shot(45), id: 'ph-west-1' });
    lobby.handle(west, { ...shot(45), id: 'ph-west-1' });
    expect(m.recorder.s.photos?.filter((p) => p.playerId === 'w1')).toHaveLength(1);
    const d = m.recorder.debrief(m.world!, m.slots, { winner: 'west', reason: 'TEST' });
    expect(d.photos?.[0]?.id).toBe('ph-west-1');
    m.recorder.ident('ship:p_e1', 'tgt-1', 'tanker');
    expect(m.recorder.s.ident?.['ship:p_e1']?.['tgt-1']).toBe('tanker');
    m.recorder.ident('ship:p_e1', 'tgt-1');
    expect(m.recorder.s.ident?.['ship:p_e1']?.['tgt-1']).toBeUndefined();
  });
});
