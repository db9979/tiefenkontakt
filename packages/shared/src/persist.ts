import type { AirState } from './aviation.js';
import { airSystem } from './aviation.js';
import { boatSystem } from './boat.js';
import { ContactBook } from './contacts.js';
import type { Loadout } from './loadout.js';
import { Rng } from './rng.js';
import type { WeaponsState } from './weapons.js';
import { weaponsSystem } from './weapons.js';
import type { World } from './world.js';

/** Save and restore a whole simulation (JSON-safe), so matches survive server restarts. */

export interface SavedWorld {
  v: 1;
  time: number;
  ships: World['ships'];
  env: World['env'];
  rng: number;
  convoy?: World['convoy'];
  books: [string, ReturnType<ContactBook['toJSON']>][];
  events: World['events'];
  sensorAccum: number;
  weapons?: Omit<WeaponsState, 'loadouts'> & { loadouts: [string, Loadout][] };
  air?: Omit<AirState, 'stock' | 'heloTorps'> & { stock: [string, number][]; heloTorps?: [string, number][] };
  /** Boat and crew systems were running. */
  boats?: boolean;
}

export function saveWorld(w: World): SavedWorld {
  return structuredClone({
    v: 1 as const,
    time: w.time,
    ships: w.ships,
    env: w.env,
    rng: w.rng.state,
    convoy: w.convoy,
    books: [...w.books].map(([id, b]) => [id, b.toJSON()] as [string, ReturnType<ContactBook['toJSON']>]),
    events: w.events,
    sensorAccum: w.sensorAccum,
    weapons: w.weapons && { ...w.weapons, loadouts: [...w.weapons.loadouts] },
    air: w.air && { ...w.air, stock: [...w.air.stock], heloTorps: w.air.heloTorps && [...w.air.heloTorps] },
    boats: w.systems.includes(boatSystem),
  });
}

export function restoreWorld(d: SavedWorld): World {
  const rng = new Rng(0);
  rng.state = d.rng;
  const w: World = {
    time: d.time,
    ships: d.ships,
    env: d.env,
    rng,
    convoy: d.convoy,
    books: new Map(d.books.map(([id, b]) => [id, ContactBook.fromJSON(b)])),
    lastDetections: [],
    events: d.events,
    sensorAccum: d.sensorAccum,
    systems: [],
  };
  if (d.weapons) {
    w.weapons = { ...d.weapons, loadouts: new Map(d.weapons.loadouts) };
    w.systems.push(weaponsSystem);
  }
  if (d.air) {
    w.air = { ...d.air, stock: new Map(d.air.stock), heloTorps: d.air.heloTorps ? new Map(d.air.heloTorps) : undefined };
    w.systems.push(airSystem);
  }
  // Boat and crew systems (their state lives on the ships), installed last like in the scenarios
  if (d.boats) w.systems.push(boatSystem);
  return w;
}
