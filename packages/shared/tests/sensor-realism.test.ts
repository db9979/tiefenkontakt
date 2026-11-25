import { describe, expect, it } from 'vitest';
import {
  AIR_MAST_RADAR,
  BUOY_GAIN,
  DEFAULT_ENV,
  KN,
  NIXIE_HULL_DB,
  NIXIE_MAX_KN,
  NIXIE_TOWED_DB,
  NM,
  Rng,
  TOWED_NB_GAIN_DB,
  aircraftRadarSweep,
  antennaTurned,
  buoySensors,
  createShip,
  createWorld,
  distance,
  esmReach,
  hullSelfNoise,
  installAir,
  installWeapons,
  mastDetectP,
  pingInterval,
  radioHorizon,
  runSensors,
  setTowedDecoy,
  stepShip,
  tonalTarget,
  towedArrayReady,
  towedSelfNoise,
  type Buoy,
  type Ship,
} from '../src/index.js';

const env = (seaState = 3) => ({ ...DEFAULT_ENV, seaState });
const ctx = (ships: Ship[], time: number, seed = 1, seaState = 3) => ({ ships, env: env(seaState), time, rng: new Rng(seed) });

function boat(pos: { x: number; y: number }, how: 'mast' | 'snorkel' | 'deep' = 'mast', speedKn = 4): Ship {
  const s = createShip({ id: 'u', cls: 'ssk', name: 'U', team: 'east', pos, heading: 90, speedKn, depth: how === 'deep' ? 60 : 14 });
  s.order.depth = s.depth;
  if (how === 'mast') {
    s.mastUp = true;
    s.mastExt = 1;
  } else if (how === 'snorkel') {
    s.snorkel = true;
    s.snorkelExt = 1;
  }
  return s;
}

/** Share of sensor seconds on which the frigate's radar painted the boat. */
function radarRate(sub: Ship, seconds: number, seaState = 3): number {
  const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0 });
  ffg.radarOn = true;
  let hits = 0;
  for (let t = 1; t <= seconds; t++) {
    if (runSensors(ctx([ffg, sub], t, t, seaState)).some((d) => d.observerId === 'f' && d.sensor === 'radar' && d.targetId === 'u')) hits++;
  }
  return hits / seconds;
}

describe('C1 radar against masts: one roll per antenna turn', () => {
  it('an antenna completes one turn per rotation period', () => {
    let turns = 0;
    for (let t = 1; t <= 1000; t++) if (antennaTurned('f', 2.5, t)) turns++;
    expect(turns).toBe(400);
  });

  it('p per turn = base · (1 − r/Rmax) · clutter', () => {
    expect(mastDetectP('mast', 0, 0)).toBeCloseTo(0.08);
    expect(mastDetectP('snorkel', 0, 0)).toBeCloseTo(0.4);
    expect(mastDetectP('snorkel', 4 * NM, 3)).toBeCloseTo(0.4 * 0.5 * 0.64);
    expect(mastDetectP('mast', 5 * NM, 0)).toBe(0);
    expect(mastDetectP('snorkel', 8 * NM, 0)).toBe(0);
    // Clutter never below 0.3
    expect(mastDetectP('snorkel', 0, 6)).toBeCloseTo(0.4 * 0.3);
  });

  it('Monte Carlo: the paint rate per second matches p / rotation period', () => {
    const snorkel = radarRate(boat({ x: 0, y: 4 * NM }, 'snorkel'), 4000);
    expect(snorkel).toBeGreaterThan(0.128 / 2.5 - 0.015);
    expect(snorkel).toBeLessThan(0.128 / 2.5 + 0.015);
    const mast = radarRate(boat({ x: 0, y: 2 * NM }, 'mast'), 4000);
    const pMast = 0.08 * (1 - 2 / 5) * 0.64;
    expect(mast).toBeGreaterThan(pMast / 2.5 - 0.008);
    expect(mast).toBeLessThan(pMast / 2.5 + 0.008);
  });

  it('no paint beyond Rmax: mast 5 nm, snorkel 8 nm', () => {
    expect(radarRate(boat({ x: 0, y: 5.2 * NM }, 'mast'), 600)).toBe(0);
    expect(radarRate(boat({ x: 0, y: 6 * NM }, 'snorkel'), 600)).toBeGreaterThan(0);
    expect(radarRate(boat({ x: 0, y: 8.2 * NM }, 'snorkel'), 600)).toBe(0);
  });
});

describe('C2 ESM range from the radio horizon', () => {
  it('reach = min(40 nm, 1.35 × radio horizon)', () => {
    expect(radioHorizon(20, 20)).toBeCloseTo(4120 * 2 * Math.sqrt(20));
    expect(esmReach(3, 20) / NM).toBeCloseTo((1.35 * 4120 * (Math.sqrt(3) + Math.sqrt(20))) / NM);
    expect(esmReach(3, 20) / NM).toBeGreaterThan(18);
    expect(esmReach(3, 20) / NM).toBeLessThan(19.5);
    expect(esmReach(20, 20) / NM).toBeGreaterThan(26);
    expect(esmReach(20, 20) / NM).toBeLessThan(27.5);
    expect(esmReach(1000, 1000)).toBe(40 * NM);
  });

  it('a boat on its mast hears a frigate radar inside the reach, not beyond', () => {
    const heard = (y: number) => {
      const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y }, heading: 0 });
      ffg.radarOn = true;
      return runSensors(ctx([ffg, boat({ x: 0, y: 0 })], 10)).some((d) => d.observerId === 'u' && d.sensor === 'esm');
    };
    expect(heard(18 * NM)).toBe(true);
    expect(heard(20 * NM)).toBe(false);
  });

  it('a frigate hears another frigate radar to about 27 nm', () => {
    const heard = (y: number) => {
      const a = createShip({ id: 'a', cls: 'ffg', name: 'A', pos: { x: 0, y: 0 }, heading: 0 });
      const b = createShip({ id: 'b', cls: 'ffg', name: 'B', team: 'east', pos: { x: 0, y }, heading: 0 });
      b.radarOn = true;
      return runSensors(ctx([a, b], 10)).some((d) => d.observerId === 'a' && d.sensor === 'esm');
    };
    expect(heard(26 * NM)).toBe(true);
    expect(heard(28 * NM)).toBe(false);
  });
});

describe('C3 aircraft radar finds exposed masts for the escort team', () => {
  function airWorld(kind: 'mpa' | 'buoy', sub: Ship, seaState = 3) {
    const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: -40_000 }, heading: 0 });
    const ffv = createShip({ id: 'g', cls: 'ffv', name: 'G', pos: { x: 5000, y: -40_000 }, heading: 0 });
    const w = createWorld([ffg, ffv, sub], 5, env(seaState));
    installAir(w);
    // The aircraft holds over the origin (transit leg from the point to itself)
    const at = { x: 0, y: 0 };
    w.air!.sorties.push({ kind, shipId: 'f', from: at, target: at, launchAt: 0, dropAt: 1e6, landAt: 2e6, readyAt: 2e6, deep: false, dropped: false });
    return w;
  }
  const run = (w: ReturnType<typeof airWorld>, seconds: number) => {
    for (let t = 1; t <= seconds; t++) {
      w.time = t;
      aircraftRadarSweep(w);
    }
  };

  it('ranges: MPA snorkel 30 km / mast 9 km, helicopter snorkel 15 km / mast 6 km', () => {
    expect(AIR_MAST_RADAR).toEqual({ mpa: { snorkel: 30_000, mast: 9000 }, helo: { snorkel: 15_000, mast: 6000 } });
  });

  it('a snorkel at 20 km is painted by the MPA; the fix reaches every escort with ≈1 km error and an alert', () => {
    const sub = boat({ x: 20_000, y: 0 }, 'snorkel');
    const w = airWorld('mpa', sub);
    run(w, 120);
    const errs: number[] = [];
    for (const id of ['f', 'g']) {
      const tr = w.books.get(id)?.tracks()[0];
      expect(tr?.sensors).toContain('radar');
      const h = tr!.history.find((x) => x.sensor === 'radar' && x.ox !== undefined)!;
      const v = { x: Math.sin((h.b * Math.PI) / 180), y: Math.cos((h.b * Math.PI) / 180) };
      errs.push(distance({ x: h.ox! + v.x * h.r!, y: h.oy! + v.y * h.r! }, sub.pos));
    }
    for (const e of errs) expect(e).toBeLessThan(3500);
    expect(w.events.filter((e) => e.kind === 'boat' && e.what === 'airradar').map((e) => (e as { shipId: string }).shipId).sort()).toEqual(['f', 'g']);
  });

  it('Monte Carlo: fix error is about 1 km', () => {
    let sum = 0, n = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const sub = boat({ x: 10_000, y: 0 }, 'snorkel');
      const w = airWorld('mpa', sub);
      w.rng = new Rng(seed);
      run(w, 200);
      for (const h of w.books.get('f')?.tracks()[0]?.history ?? []) {
        if (h.sensor !== 'radar' || h.ox === undefined) continue;
        const v = { x: Math.sin((h.b * Math.PI) / 180), y: Math.cos((h.b * Math.PI) / 180) };
        sum += distance({ x: h.ox + v.x * h.r!, y: h.oy! + v.y * h.r! }, sub.pos);
        n++;
      }
    }
    expect(n).toBeGreaterThan(100);
    // Rayleigh mean of σ = 700 m per axis ≈ 877 m
    expect(sum / n).toBeGreaterThan(700);
    expect(sum / n).toBeLessThan(1100);
  });

  it('nothing beyond the limits, nothing from a boat with no mast up', () => {
    const far = airWorld('mpa', boat({ x: 10_000, y: 0 }, 'mast'));
    run(far, 600);
    expect(far.books.get('f')?.tracks().length ?? 0).toBe(0);
    const helo = airWorld('buoy', boat({ x: 16_000, y: 0 }, 'snorkel'));
    run(helo, 600);
    expect(helo.books.get('f')?.tracks().length ?? 0).toBe(0);
    const deep = airWorld('mpa', boat({ x: 2000, y: 0 }, 'deep'));
    run(deep, 600);
    expect(deep.books.get('f')?.tracks().length ?? 0).toBe(0);
  });

  it('the helicopter paints a snorkel at 10 km in transit, not while it hovers to dip', () => {
    const transit = airWorld('buoy', boat({ x: 10_000, y: 0 }, 'snorkel'));
    run(transit, 300);
    expect(transit.books.get('f')?.tracks().length).toBe(1);
    const dip = airWorld('buoy', boat({ x: 10_000, y: 0 }, 'snorkel'));
    const s = dip.air!.sorties[0]!;
    Object.assign(s, { kind: 'dip', dropAt: 0, hoverUntil: 1e6 });
    run(dip, 300);
    expect(dip.books.get('f')?.tracks().length ?? 0).toBe(0);
  });
});

describe('C6 sonobuoys and towed array processing', () => {
  const buoyRate = (sub: Ship, r: number) => {
    let n = 0;
    for (let i = 0; i < 200; i++) {
      sub.pos = { x: r, y: 0 };
      const b: Buoy = { id: 'b', ownerId: 'f', pos: { x: 0, y: 0 }, depth: 30, expiresAt: 1e9 };
      if (buoySensors([b], ctx([sub], 1000 + i, i + 1)).length) n++;
    }
    return n / 200;
  };

  it('buoy gain is 16 dB: a battery boat at 4 kn inside about 1 km, a snorkeling boat tens of km', () => {
    expect(BUOY_GAIN).toBe(16);
    const battery = boat({ x: 0, y: 0 }, 'deep', 4);
    expect(buoyRate(battery, 300)).toBe(1);
    expect(buoyRate(battery, 1500)).toBe(0);
    const snork = boat({ x: 0, y: 0 }, 'snorkel', 6);
    expect(buoyRate(snork, 30_000)).toBe(1);
  });

  it('narrowband gain only on noisy targets, never on a quiet battery boat ≤ 6 kn', () => {
    expect(TOWED_NB_GAIN_DB).toBe(8);
    expect(tonalTarget(boat({ x: 0, y: 0 }, 'deep', 6))).toBe(false);
    expect(tonalTarget(boat({ x: 0, y: 0 }, 'snorkel', 6))).toBe(true);
    const pumping = boat({ x: 0, y: 0 }, 'deep', 4);
    pumping.trim = 1;
    expect(tonalTarget(pumping)).toBe(true);
    const blowing = boat({ x: 0, y: 0 }, 'deep', 4);
    blowing.blowing = true;
    expect(tonalTarget(blowing)).toBe(true);
    const fast = boat({ x: 0, y: 0 }, 'deep', 15);
    fast.depth = 20;
    expect(tonalTarget(fast)).toBe(true); // cavitating
    expect(tonalTarget(createShip({ id: 'm', cls: 'merchant', name: 'M', pos: { x: 0, y: 0 }, heading: 0 }))).toBe(true);
  });

  it('the towed array adds the gain once the boat makes noise (trim pumps)', () => {
    const se = (sub: Ship) => {
      const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0, speedKn: 8 });
      ffg.towedLength = 900;
      const d = runSensors(ctx([ffg, sub], 1000, 3)).find((x) => x.observerId === 'f' && x.sensor === 'towed');
      return d?.se ?? -Infinity;
    };
    // Same boat, trim pumps on and off: +3 dB radiated and +8 dB processing. 155° off the bow:
    // in the hull sonar's baffles (so the random draws match), not yet in the array's endfire
    const at = { x: 3000 * Math.sin((155 * Math.PI) / 180), y: 3000 * Math.cos((155 * Math.PI) / 180) };
    // A nuclear boat at 8 kn (loud enough to hold at 3 km without the gain)
    const ssn = () => createShip({ id: 'u', cls: 'ssn', name: 'U', team: 'east', pos: at, heading: 90, speedKn: 8, depth: 60 });
    const quiet = ssn();
    const pump = ssn();
    pump.trim = 1;
    const a = se(quiet), b = se(pump);
    expect(Number.isFinite(a)).toBe(true);
    expect(b - a).toBeCloseTo(3 + TOWED_NB_GAIN_DB, 1);
  });
});

describe('C7 Nixie towed decoy', () => {
  it('adds self-noise to the own sonars and limits speed to 25 kn', () => {
    const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0, speedKn: 12 });
    const w = createWorld([ffg], 1);
    installWeapons(w);
    const hull = hullSelfNoise(ffg), towed = towedSelfNoise(ffg);
    setTowedDecoy(w, ffg, true);
    expect(ffg.nixie).toBe(true);
    expect(hullSelfNoise(ffg) - hull).toBeCloseTo(NIXIE_HULL_DB);
    expect(towedSelfNoise(ffg) - towed).toBeCloseTo(NIXIE_TOWED_DB);
    ffg.order.speedKn = 29;
    for (let i = 0; i < 6000; i++) stepShip(ffg, 0.1, i * 0.1);
    expect(ffg.speed / KN).toBeCloseTo(NIXIE_MAX_KN, 1);
    setTowedDecoy(w, ffg, false);
    expect(ffg.nixie).toBeUndefined();
    for (let i = 0; i < 3000; i++) stepShip(ffg, 0.1, 600 + i * 0.1);
    expect(ffg.speed / KN).toBeGreaterThan(27);
  });
});

describe('C12 ping interval by range scale', () => {
  it('4 / 8 / 16 km → 6 / 11 / 22 s, default 8 km', () => {
    expect(pingInterval({ pingRange: 4000 })).toBe(6);
    expect(pingInterval({ pingRange: 8000 })).toBe(11);
    expect(pingInterval({ pingRange: 16_000 })).toBe(22);
    expect(pingInterval({})).toBe(11);
    expect(pingInterval({ pingRange: 5000 })).toBe(11);
  });

  const pings = (s: Ship, seconds: number, from = 100) => {
    const at: number[] = [];
    for (let t = from; t < from + seconds; t++) {
      runSensors(ctx([s], t));
      if (s.lastPingAt === t) at.push(t);
    }
    return at;
  };

  it('continuous pinging follows the scale', () => {
    const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0 });
    ffg.activeSonar = true;
    ffg.pingRange = 4000;
    expect(pings(ffg, 30)).toEqual([100, 106, 112, 118, 124]);
    ffg.pingRange = 16_000;
    expect(pings(ffg, 30, 130)).toEqual([146]);
  });

  it('a single ping goes out once, as soon as the last one is back', () => {
    const sub = createShip({ id: 'u', cls: 'ssk', name: 'U', pos: { x: 0, y: 0 }, heading: 0, depth: 60 });
    sub.pingOnce = true;
    expect(pings(sub, 30)).toEqual([100]);
    expect(sub.pingOnce).toBeUndefined();
    sub.pingOnce = true;
    sub.lastPingAt = 195; // 8 km scale: next one at 206
    expect(pings(sub, 30, 200)).toEqual([206]);
  });

  it('echoes from beyond the scale are not received', () => {
    const echo = (scale: number) => {
      const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0 });
      ffg.pingOnce = true;
      ffg.pingRange = scale;
      const sub = createShip({ id: 'u', cls: 'ssk', name: 'U', team: 'east', pos: { x: 0, y: 6000 }, heading: 90, speedKn: 4, depth: 60 });
      const dets = runSensors(ctx([ffg, sub], 1000));
      return { echo: dets.some((d) => d.observerId === 'f' && d.sensor === 'active' && d.targetId === 'u'), heard: dets.some((d) => d.observerId === 'u' && d.sensor === 'intercept') };
    };
    expect(echo(4000)).toEqual({ echo: false, heard: true });
    expect(echo(8000)).toEqual({ echo: true, heard: true });
  });
});

describe('C13 towed array settling by the size of the alteration', () => {
  /** Turn by `deg` at 10 kn, then report seconds after the turn until the array is ready. */
  function settle(deg: number): number {
    const ffg = createShip({ id: 'f', cls: 'ffg', name: 'F', pos: { x: 0, y: 0 }, heading: 0, speedKn: 10 });
    ffg.towedLength = 900;
    let t = 0;
    const step = () => {
      t += 0.1;
      stepShip(ffg, 0.1, t);
    };
    for (let i = 0; i < 100; i++) step();
    ffg.lastTurnAt = -1e9;
    ffg.order.heading = deg;
    while (Math.abs(ffg.heading - deg) > 0.01 || Math.abs(ffg.yawRate ?? 0) > 0) step();
    const end = t;
    if (towedArrayReady(ffg, t)) return 0;
    while (!towedArrayReady(ffg, t)) step();
    return t - end;
  }

  it('< 10°: no reset; 10–45°: 60 s; > 45°: 150 s', () => {
    expect(settle(8)).toBe(0);
    expect(settle(30)).toBeGreaterThan(55);
    expect(settle(30)).toBeLessThanOrEqual(60.1);
    expect(settle(90)).toBeGreaterThan(145);
    expect(settle(90)).toBeLessThanOrEqual(150.1);
  });
});
