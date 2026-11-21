/**
 * Balance report: runs headless engagements with the real sim and prints key numbers.
 * Usage: npx tsx scripts/balance.ts
 */
import {
  DEFAULT_ENV, KN, activeSignalExcess, bearing, createShip, createWorld, distance, fireTorpedo,
  installWeapons, launchAswRocket, launchNoisemaker, passiveSignalExcess, stepWorld, towedArrayDepth,
  type ClassId, type Ship,
} from '../packages/shared/src/index.js';
import { routeLength, DEFAULT_SETTINGS } from '../apps/server/src/scenario.js';

const env = DEFAULT_ENV;
const mk = (cls: ClassId, kn: number, depth?: number, extra: Partial<Ship> = {}) =>
  Object.assign(createShip({ id: cls, cls, name: cls, pos: { x: 0, y: 0 }, heading: 0, speedKn: kn, depth }), extra);

function maxRange(f: (r: number) => number): number {
  let lo = 10, hi = 400_000;
  if (f(lo) < 0) return 0;
  if (f(hi) > 0) return hi;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (f(m) > 0) lo = m; else hi = m; }
  return lo;
}
const km = (m: number) => (m / 1000).toFixed(1).padStart(6) + ' km';

console.log(`\n== Karte ==\nKonvoiroute ${km(routeLength(DEFAULT_SETTINGS))} in ${DEFAULT_SETTINGS.timeLimitMin} min`);

console.log('\n== Passive Erfassung (Signalüberschuss > 0) ==');
const ffgTow = (len: number) => mk('ffg', 10, undefined, { towedLength: len });
const rows: [string, () => number][] = [
  ['SSK 4kn  60m  <- FFG 15kn Rumpf', () => maxRange((r) => passiveSignalExcess(mk('ssk', 4, 60), mk('ffg', 15), r, 'hull', env))],
  ['SSK 4kn  60m  <- FFG Schlepp 400m', () => { const f = ffgTow(400); return maxRange((r) => passiveSignalExcess(mk('ssk', 4, 60), f, r, 'towed', env, towedArrayDepth(f))); }],
  ['SSK 4kn 150m  <- FFG Schlepp 1200m', () => { const f = ffgTow(1200); return maxRange((r) => passiveSignalExcess(mk('ssk', 4, 150), f, r, 'towed', env, towedArrayDepth(f))); }],
  ['SSN 5kn  60m  <- FFG Schlepp 400m', () => { const f = ffgTow(400); return maxRange((r) => passiveSignalExcess(mk('ssn', 5, 60), f, r, 'towed', env, towedArrayDepth(f))); }],
  ['SSN 15kn 60m  <- FFG Schlepp 400m', () => { const f = ffgTow(400); return maxRange((r) => passiveSignalExcess(mk('ssn', 15, 60), f, r, 'towed', env, towedArrayDepth(f))); }],
  ['SSK schnorchelt <- FFG 15kn Rumpf', () => maxRange((r) => passiveSignalExcess(mk('ssk', 6, 18, { snorkel: true }), mk('ffg', 15), r, 'hull', env))],
  ['Frachter 9kn  -> SSK 4kn 60m', () => maxRange((r) => passiveSignalExcess(mk('merchant', 9), mk('ssk', 4, 60), r, 'hull', env))],
  ['FFG 15kn      -> SSK 4kn 60m', () => maxRange((r) => passiveSignalExcess(mk('ffg', 15), mk('ssk', 4, 60), r, 'hull', env))],
  ['FFG 15kn      -> SSK 4kn 150m', () => maxRange((r) => passiveSignalExcess(mk('ffg', 15), mk('ssk', 4, 150), r, 'hull', env))],
];
for (const [n, f] of rows) console.log(n.padEnd(36), km(f()));

console.log('\n== Aktivsonar FFG 15 kn ==');
console.log('gegen SSK 60m'.padEnd(36), km(maxRange((r) => activeSignalExcess(mk('ssk', 4, 60), mk('ffg', 15), r, env))));
console.log('gegen SSK 150m (unter Schicht)'.padEnd(36), km(maxRange((r) => activeSignalExcess(mk('ssk', 4, 150), mk('ffg', 15), r, env))));

/** Monte Carlo: heavyweight shot at a merchant from a given range, perfect aim. */
function torpedoShot(range: number, seed: number, mode: 'passive' | 'active'): boolean {
  const sub = mk('ssk', 3, 60);
  const m = createShip({ id: 'm', cls: 'merchant', name: 'm', pos: { x: 0, y: range }, heading: 90, speedKn: 9 });
  const w = createWorld([sub, m], seed);
  installWeapons(w);
  const tKn = 40;
  const tti = range / (tKn * KN);
  const lead = { x: 9 * KN * tti, y: range };
  fireTorpedo(w, sub, { heading: bearing(sub.pos, lead) + (w.rng.next() - 0.5) * 8, enableAfter: range * 0.6, mode, searchDepth: 10, speedKn: tKn });
  for (let i = 0; i < 9000 && m.alive; i++) { m.order.speedKn = 9; stepWorld(w); }
  return !m.alive;
}
console.log('\n== Schwergewichtstorpedo gegen Frachter (±4° Zielfehler) ==');
for (const r of [2000, 5000, 9000, 14000]) {
  let p = 0, a = 0;
  for (let s = 1; s <= 20; s++) { if (torpedoShot(r, s, 'passive')) p++; if (torpedoShot(r, s + 100, 'active')) a++; }
  console.log(`Schuss auf ${km(r)}`.padEnd(36), `passiv ${p * 5}%  aktiv ${a * 5}%`);
}

/** Monte Carlo: ASW rocket on an active fix against an SSK, with/without evasion. */
function rocketAttack(seed: number, evade: boolean, depth: number): boolean {
  const ffg = mk('ffg', 12);
  const sub = createShip({ id: 'u', cls: 'ssk', name: 'u', pos: { x: 0, y: 6000 }, heading: 90, speedKn: 4, depth });
  const w = createWorld([ffg, sub], seed);
  installWeapons(w);
  const err = 1 + w.rng.gauss(0, 0.02);
  launchAswRocket(w, ffg, { x: sub.pos.x + w.rng.gauss(0, 100), y: sub.pos.y * err });
  let evaded = false;
  for (let i = 0; i < 4000 && sub.alive; i++) {
    stepWorld(w);
    if (evade && !evaded && w.events.some((e) => e.kind === 'torpedo_alert' && e.shipId === 'u')) {
      evaded = true;
      launchNoisemaker(w, sub);
      sub.order = { heading: 0, speedKn: 16, depth: depth > 120 ? 60 : 200 };
    }
  }
  return sub.hp < 80;
}
console.log('\n== U-Jagd-Rakete gegen SSK (Treffer = Schaden) ==');
for (const depth of [60, 200]) {
  let plain = 0, ev = 0;
  for (let s = 1; s <= 20; s++) { if (rocketAttack(s, false, depth)) plain++; if (rocketAttack(s, true, depth)) ev++; }
  console.log(`SSK auf ${depth} m`.padEnd(36), `ohne Ausweichen ${plain * 5}%  mit Täuschkörper+Ausweichen ${ev * 5}%`);
}

console.log('\n== Anlaufgeometrie ==');
const route = routeLength(DEFAULT_SETTINGS);
const subY = route * 0.4;
console.log(`U-Boote starten bei y≈${km(subY)}, Konvoi erreicht sie nach ${(subY / (9 * KN) / 60).toFixed(1)} min`);
console.log(`Konvoi Distanz bei Start zu U-Boot: ${km(distance({ x: 0, y: 0 }, { x: 3000, y: subY }))}`);
