import { CLASSES } from './classes.js';
import { applyHitDamage } from './damage.js';
import type { Ship } from './entities.js';
import { KN, angleDiff, bearing, distance, headingVec, type Vec2 } from './math.js';
import { iceCover, type FogBank, type MetState, type SquallCell } from './met.js';
import { Rng } from './rng.js';
import type { World } from './world.js';

/**
 * Moving the met cells (1 s steps), keeping them around the ships, and what ice does to
 * ships: floes slow surface ships, icebergs must be steered around (AI ships do it, players
 * have to) and ram damage on contact unless a boat passes below the keel.
 */

export interface MetOptions {
  /** Changeable weather: rain squalls come and go. */
  dynamic: boolean;
  /** Cold water: floe fields and icebergs. */
  ice: boolean;
  fogBanks: number;
}

const SQUALL_SPEED = 1.3; // × wind
const FOG_SPEED = 0.6; // × wind
/** Ships closer than this to a berg's waterline radius touch it (m). */
const HULL_R = 35;

function withRng<T>(m: MetState, f: (r: Rng) => T): T {
  const r = new Rng(0);
  r.state = m.rng;
  const out = f(r);
  m.rng = r.state;
  return out;
}

const unit = (v: Vec2): Vec2 => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};

/** A point well clear (by `gap` m) of every ship, inside the area; best effort after 20 tries. */
function clearSpot(m: MetState, r: Rng, ships: readonly Ship[], gap: number, at?: () => Vec2): Vec2 {
  let p: Vec2 = { x: 0, y: 0 };
  for (let i = 0; i < 20; i++) {
    p = at ? at() : { x: m.area.x + r.range(-1, 1) * m.area.half, y: m.area.y + r.range(-1, 1) * m.area.half };
    if (ships.every((s) => distance(s.pos, p) > gap)) break;
  }
  return p;
}

/** Spawn position on the upwind edge of the area, anywhere across it. */
function upwind(m: MetState, r: Rng, rad: number): Vec2 {
  const w = unit(m.wind);
  const lat = r.range(-1, 1) * m.area.half;
  return { x: m.area.x - w.x * (m.area.half + rad) - w.y * lat, y: m.area.y - w.y * (m.area.half + rad) + w.x * lat };
}

function newSquall(m: MetState, r: Rng, time: number, at: Vec2): SquallCell {
  return { id: m.nextId++, x: at.x, y: at.y, r: r.range(1500, 3500), until: time + r.range(900, 2400) };
}

/** Set up the cells for a match, deterministic from the seed. */
export function initMet(ships: readonly Ship[], seed: number, o: MetOptions): MetState {
  const cx = ships.reduce((a, s) => a + s.pos.x, 0) / Math.max(1, ships.length);
  const cy = ships.reduce((a, s) => a + s.pos.y, 0) / Math.max(1, ships.length);
  const half = Math.max(15_000, ...ships.map((s) => Math.max(Math.abs(s.pos.x - cx), Math.abs(s.pos.y - cy)) + 8000));
  const m: MetState = {
    wind: { x: 0, y: 0 }, drift: { x: 0, y: 0 }, fog: [], squalls: [], floes: [], bergs: [],
    rng: (seed * 2654435761) >>> 0 || 1, nextId: 1, dynamic: o.dynamic, area: { x: cx, y: cy, half }, next: 0, hits: {},
  };
  withRng(m, (r) => {
    const wa = r.range(0, Math.PI * 2), ws = r.range(3, 7);
    m.wind = { x: Math.sin(wa) * ws, y: Math.cos(wa) * ws };
    const da = wa + r.range(-0.6, 0.6), ds = r.range(0.08, 0.2);
    m.drift = { x: Math.sin(da) * ds, y: Math.cos(da) * ds };
    for (let i = 0; i < o.fogBanks; i++) {
      const rad = r.range(1500, 4000);
      const p = clearSpot(m, r, ships, rad + 1500);
      m.fog.push({ id: m.nextId++, x: p.x, y: p.y, r: rad, d: r.range(0.75, 1) });
    }
    if (o.dynamic) for (let i = 0; i < 2; i++) m.squalls.push(newSquall(m, r, 0, clearSpot(m, r, ships, 5000)));
    if (o.ice) {
      for (let i = 0; i < 4; i++) {
        const rad = r.range(2500, 5000);
        const p = clearSpot(m, r, ships, rad + 2000);
        m.floes.push({ id: m.nextId++, x: p.x, y: p.y, r: rad, cover: r.range(0.35, 0.75) });
      }
      for (let i = 0; i < 7; i++) {
        const f = i < 4 ? m.floes[i % m.floes.length] : undefined;
        const p = clearSpot(m, r, ships, 1500, f ? () => ({ x: f.x + r.range(-0.7, 0.7) * f.r, y: f.y + r.range(-0.7, 0.7) * f.r }) : undefined);
        const h = r.range(12, 45);
        m.bergs.push({ id: m.nextId++, x: p.x, y: p.y, r: r.range(30, 110), h, draft: Math.min(220, h * 5) });
      }
    }
  });
  return m;
}

/** One second of drift: fog and squalls move with the wind and are recycled upwind; squalls die and new ones form. */
function drift(m: MetState, w: World): void {
  if (Math.floor(w.time) % 60 === 0) {
    const alive = w.ships.filter((s) => s.alive);
    if (alive.length) {
      m.area.x = alive.reduce((a, s) => a + s.pos.x, 0) / alive.length;
      m.area.y = alive.reduce((a, s) => a + s.pos.y, 0) / alive.length;
    }
  }
  const wd = unit(m.wind);
  const out = (c: FogBank | SquallCell) => (c.x - m.area.x) * wd.x + (c.y - m.area.y) * wd.y > m.area.half + c.r;
  withRng(m, (r) => {
    for (const f of m.fog) {
      f.x += m.wind.x * FOG_SPEED;
      f.y += m.wind.y * FOG_SPEED;
      if (out(f)) Object.assign(f, upwind(m, r, f.r));
    }
    for (const s of m.squalls) {
      s.x += m.wind.x * SQUALL_SPEED;
      s.y += m.wind.y * SQUALL_SPEED;
      if (out(s)) Object.assign(s, upwind(m, r, s.r));
    }
    if (m.dynamic) {
      m.squalls = m.squalls.filter((s) => s.until > w.time);
      // Showers form anywhere upwind of the middle, so they come across the ships
      while (m.squalls.length < 2) {
        const at = { x: m.area.x - wd.x * r.range(0, m.area.half) + wd.y * r.range(-1, 1) * m.area.half, y: m.area.y - wd.y * r.range(0, m.area.half) - wd.x * r.range(-1, 1) * m.area.half };
        m.squalls.push(newSquall(m, r, w.time, at));
      }
    }
  });
  for (const c of [...m.floes, ...m.bergs]) {
    c.x += m.drift.x;
    c.y += m.drift.y;
  }
}

/** AI ships turn away from an iceberg ahead: the tangent heading closest to what they wanted. */
function steerClear(m: MetState, s: Ship): void {
  const hv = headingVec(s.heading);
  const look = 1200 + 90 * s.speed;
  for (const b of m.bergs) {
    if (s.depth >= b.draft) continue;
    const vx = b.x - s.pos.x, vy = b.y - s.pos.y;
    const along = vx * hv.x + vy * hv.y;
    const clear = b.r + 300;
    if (along < -b.r || along > look || Math.abs(hv.x * vy - hv.y * vx) > clear) continue;
    const dist = Math.hypot(vx, vy);
    const brg = bearing(s.pos, b);
    const off = (Math.asin(Math.min(1, clear / Math.max(dist, 1))) * 180) / Math.PI + 8;
    const a = brg + off, c = brg - off;
    s.order.heading = ((Math.abs(angleDiff(s.order.heading, a)) < Math.abs(angleDiff(s.order.heading, c)) ? a : c) + 360) % 360;
    return;
  }
}

function collide(w: World, m: MetState, s: Ship): void {
  for (const b of m.bergs) {
    if (s.depth >= b.draft) continue;
    const dx = s.pos.x - b.x, dy = s.pos.y - b.y;
    const d = Math.hypot(dx, dy);
    if (d >= b.r + HULL_R) continue;
    const kn = s.speed / KN;
    if (w.time - (m.hits[s.id] ?? -1e9) > 60 && kn > 0.5) {
      m.hits[s.id] = w.time;
      s.hp -= Math.min(25, 3 + kn * 1.3);
      applyHitDamage(s, 10 + kn * 3, w.rng);
      w.events.push({ kind: 'boat', time: w.time, shipId: s.id, what: 'iceberg', text: 'KOLLISION MIT EISBERG · SCHÄDEN' });
    }
    // Pushed off the ice, way off the ship
    const k = (b.r + HULL_R + 1) / Math.max(d, 1);
    s.pos.x = b.x + (d > 1 ? dx : 1) * k;
    s.pos.y = b.y + (d > 1 ? dy : 0) * k;
    s.speed = Math.min(s.speed, 0.5 * KN);
  }
}

/** Every tick, before the ships move. */
export function stepMet(w: World, dt: number): void {
  const m = w.env.met;
  if (!m) return;
  if (w.time >= m.next) {
    m.next = Math.floor(w.time) + 1;
    drift(m, w);
  }
  if (!m.bergs.length && !m.floes.length) return;
  for (const s of w.ships) {
    if (!s.alive) continue;
    if (!s.playerId) steerClear(m, s);
    collide(w, m, s);
    // Floes: surface ships (and surfaced boats) push through more slowly
    const sub = CLASSES[s.cls].submarine;
    if (sub && s.depth > 8) continue;
    const cover = iceCover(m, s.pos);
    if (cover < 0.05) continue;
    const cap = CLASSES[s.cls].maxSpeedKn * (1 - 0.4 * cover) * KN;
    if (s.speed > cap) s.speed = Math.max(cap, s.speed - 0.4 * dt);
  }
}
