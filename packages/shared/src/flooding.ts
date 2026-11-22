import { CLASSES } from './classes.js';
import {
  compartmentLayout,
  compsOf,
  floodMoment,
  floodWeight,
  igniteCompartment,
  report,
  reserveBuoyancy,
  type CompState,
} from './compartments.js';
import { crewWorkRate } from './crew.js';
import { emergencyBlow } from './boat.js';
import type { Ship } from './entities.js';
import type { World } from './world.js';

/**
 * Water, fire and the damage-control parties, per tick: holes let water in (faster the
 * deeper a boat is), water runs on through open bulkheads, pumps and patches fight it,
 * fires grow and creep into the next compartment unless fought or starved behind a closed
 * bulkhead. The water aboard trims and lists the ship, drags a boat down, and when the
 * reserve buoyancy is gone she sinks.
 */

/** Fill rate (share/s) of a fully holed compartment at the surface, for a 4000 t hull. */
const INFLOW = 1 / 40;
const SPREAD = 0.015;
const PUMP_PRIO = 0.004;
const PUMP_BG = 0.0025;
const PATCH_PRIO = 1 / 120;
const PATCH_BG = 1 / 400;
const FIX_PRIO = 1 / 240;
const FIX_BG = 1 / 1500;
const FIGHT_PRIO = 1 / 60;
const FIGHT_BG = 1 / 600;
const FIRE_GROW = 0.004;
const FIRE_SPREAD = 0.004;
const FIRE_HP = 0.025;
/** Crews give a compartment up and close its bulkheads at this much water (or sooner when the hole is too big to shore up). */
const AUTO_SEAL = 0.9;

/** Where the damage-control party works: the ordered compartment, else the worst one. */
export function dcTarget(s: Ship): number | undefined {
  const comps = compsOf(s);
  const ordered = s.dcComp;
  if (ordered !== undefined && comps[ordered] && !comps[ordered]!.sealed) return ordered;
  const layout = compartmentLayout(s.cls);
  if (s.repair) {
    // Old system priority: the compartment that hurts that system most
    let best: number | undefined;
    let score = 0;
    comps.forEach((x, i) => {
      if (x.sealed) return;
      const v = s.repair === 'leck' ? x.leak + x.flood * 0.5 : (layout[i]!.sys[s.repair as 'antrieb'] ?? 0) * (x.dmg + x.fire);
      if (v > score) {
        score = v;
        best = i;
      }
    });
    if (best !== undefined) return best;
  }
  let best: number | undefined;
  let score = 0.001;
  comps.forEach((x, i) => {
    if (x.sealed) return;
    const v = x.fire * 2 + x.leak * 1.5 + x.dmg * 0.5 + x.flood * 0.3;
    if (v > score) {
      score = v;
      best = i;
    }
  });
  return best;
}

/** Size factor: a big hull's compartments fill more slowly through the same hole. */
function sizeFactor(s: Ship): number {
  return Math.max(0.6, Math.min(2.5, Math.cbrt(CLASSES[s.cls].tonnage / 4000)));
}

function stepWater(s: Ship, comps: CompState[], prio: number | undefined, rate: number, dt: number): void {
  const layout = compartmentLayout(s.cls);
  const sub = CLASSES[s.cls].submarine;
  // Sea pressure: a hole at 200 m lets in almost three times as much as at the surface
  const pressure = sub ? Math.sqrt(1 + Math.max(0, s.depth) / 30) : 1;
  const k = (INFLOW * pressure) / sizeFactor(s);
  const engine = comps.findIndex((_, i) => layout[i]!.tag === 'engine');
  // Electric pumps need the engine room; hand and emergency pumps do half
  const power = engine >= 0 && comps[engine]!.flood > 0.6 ? 0.5 : 1;
  comps.forEach((x, i) => {
    const here = i === prio;
    if (x.leak > 0) x.flood = Math.min(1, x.flood + x.leak * k * (1 - x.flood * 0.5) * dt);
    // Patching: only while the compartment can still be worked in; a torpedo hole takes long to shore up
    if (x.leak > 0 && !x.sealed && x.flood < 0.8) x.leak = Math.max(0, x.leak - ((here ? PATCH_PRIO : PATCH_BG) * rate * dt) / (1 + 3 * x.leak * x.leak));
    if (x.flood > 0) x.flood = Math.max(0, x.flood - (here ? PUMP_PRIO : PUMP_BG) * power * (x.sealed ? 0.5 : 1) * dt);
  });
  // Water runs on through open doors
  for (let i = 0; i + 1 < comps.length; i++) {
    const a = comps[i]!;
    const b = comps[i + 1]!;
    if (a.sealed || b.sealed) continue;
    const [from, to, vf, vt] = a.flood > b.flood ? [a, b, layout[i]!.vol, layout[i + 1]!.vol] : [b, a, layout[i + 1]!.vol, layout[i]!.vol];
    if (from.flood < 0.6) continue;
    const q = SPREAD * (from.flood - to.flood) * Math.min(vf, vt) * dt;
    from.flood -= q / vf;
    to.flood = Math.min(1, to.flood + q / vt);
  }
}

function stepFire(s: Ship, comps: CompState[], prio: number | undefined, rate: number, dt: number, w?: World): void {
  const layout = compartmentLayout(s.cls);
  comps.forEach((x, i) => {
    if (x.fire <= 0) return;
    const here = i === prio;
    // Behind closed bulkheads a fire uses up its air; water drowns it; otherwise it grows
    if (x.sealed) x.fire -= dt / 150;
    else x.fire += FIRE_GROW * (1 - x.flood) * dt - (here ? FIGHT_PRIO : FIGHT_BG) * rate * dt;
    x.fire -= x.flood * 0.05 * dt;
    x.fire = Math.max(0, Math.min(1, x.fire));
    if (x.fire <= 0) {
      report(w, s, 'fire_out', `FEUER GELÖSCHT ${layout[i]!.dat}`);
      return;
    }
    x.dmg = Math.min(1, x.dmg + 0.002 * x.fire * dt);
    s.hp -= FIRE_HP * x.fire * dt;
    // Smoke in a closed boat
    if (s.air) s.air.co2 += 0.0006 * x.fire * dt;
    if (x.fire > 0.5 && !x.sealed) {
      for (const j of [i - 1, i + 1]) {
        const n = comps[j];
        if (!n || n.sealed || n.fire > 0 || n.flood > 0.5) continue;
        if ((w?.rng.next() ?? 0.5) < FIRE_SPREAD * x.fire * dt) {
          report(w, s, 'fire_spread', `FEUER GREIFT ÜBER · ${layout[j]!.name.toUpperCase()}`);
          igniteCompartment(s, j, 0.15);
        }
      }
    }
    // A burning magazine may go up
    if (layout[i]!.tag === 'magazine' && x.fire > 0.85 && (w?.rng.next() ?? 1) < 0.01 * dt) {
      report(w, s, 'magazine', `MUNITION DETONIERT ${layout[i]!.dat}`);
      s.hp -= 45;
      x.leak = Math.min(1, x.leak + 0.6);
      x.dmg = 1;
    }
  });
}

/** Wreckage repairs, auto-sealing and the warnings that go with them. */
function stepCrew(s: Ship, comps: CompState[], prio: number | undefined, rate: number, dt: number, w?: World): void {
  const layout = compartmentLayout(s.cls);
  comps.forEach((x, i) => {
    if (x.dmg > 0 && !x.sealed && x.flood < 0.6 && x.fire < 0.3) x.dmg = Math.max(0, x.dmg - (i === prio ? FIX_PRIO : FIX_BG) * rate * dt);
    if (x.leak > 0 && x.leak < 0.005) {
      x.leak = 0;
      report(w, s, 'patched', `LECK ABGEDICHTET ${layout[i]!.dat}`);
    }
    if (!x.sealed && !x.manual && (x.flood >= AUTO_SEAL || (x.flood >= 0.55 && x.leak >= 0.5))) {
      x.sealed = true;
      report(w, s, 'bulkhead', `SCHOTT GESCHLOSSEN · ${layout[i]!.name.toUpperCase()}`);
    }
  });
}

const warned = new WeakMap<Ship, number>();

/** Trim, list, settling and the sinking point. */
function stepBuoyancy(s: Ship, dt: number, w?: World): void {
  const spec = CLASSES[s.cls];
  const W = floodWeight(s);
  const reserve = reserveBuoyancy(s);
  const share = W / reserve;
  // Bow-heavy water puts the bow down (+); a ship also lists toward the holed side
  s.trimDeg = Math.max(-25, Math.min(25, floodMoment(s) * (spec.submarine ? 120 : 60)));
  s.listDeg = spec.submarine && s.depth > 1 ? 0 : (s.heelSide ?? 1) * Math.min(30, share * share * 22);
  s.settle = Math.min(1, share);
  const level = share > 0.85 ? 2 : share > 0.55 ? 1 : 0;
  const was = warned.get(s) ?? 0;
  if (level > was) report(w, s, 'buoyancy', level === 2 ? 'AUFTRIEB FAST VERLOREN · SCHIFF SINKT' : spec.submarine ? 'BOOT WIRD SCHWER · FAHRT AUFNEHMEN ODER ANBLASEN' : 'SCHWERE SCHLAGSEITE');
  warned.set(s, level === 0 ? 0 : Math.max(was, level));
  if (spec.submarine && s.depth > 1) {
    // Water aboard drags the boat down; the planes hold her only with way on, a blow lifts her
    const heavy = Math.max(0, W - 0.04) * 6;
    const bowDown = Math.sin((s.trimDeg * Math.PI) / 180) * s.speed * 0.5;
    const sink = s.blowing ? 0 : heavy + bowDown;
    if (sink > 0) s.depth += sink * dt;
    // The engineer blows on his own when the boat drops toward her test depth
    if (w && sink > 0.4 && s.depth > CLASSES[s.cls].maxDepth * 0.8 && emergencyBlow(w, s) === true) report(w, s, 'autoblow', 'BOOT SACKT DURCH · LI BLÄST AUF EIGENE FAUST AN');
  }
  if (W >= reserve && s.alive) {
    s.hp = Math.min(s.hp, 0);
    report(w, s, 'sinking', 'AUFTRIEB VERLOREN · ALLE MANN VON BORD');
  }
}

/** One tick of damage control for a ship with compartments. */
export function stepCompartments(s: Ship, dt: number, w?: World): void {
  if (!s.comps || !s.alive) return;
  const comps = s.comps;
  if (!comps.some((x) => x.flood > 0 || x.leak > 0 || x.fire > 0 || x.dmg > 0) && !comps.some((x) => x.sealed)) {
    s.trimDeg = 0;
    s.listDeg = 0;
    s.settle = 0;
    return;
  }
  const prio = dcTarget(s);
  const rate = crewWorkRate(s);
  stepWater(s, comps, prio, rate, dt);
  stepFire(s, comps, prio, rate, dt, w);
  stepCrew(s, comps, prio, rate, dt, w);
  stepBuoyancy(s, dt, w);
}
