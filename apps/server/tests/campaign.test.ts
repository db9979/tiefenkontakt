import { describe, expect, it } from 'vitest';
import { CLASSES, createShip, createWorld, installWeapons, emptyDamage, type ServerMsg } from '@tk/shared';
import { AuthStore } from '../src/auth.js';
import {
  CAMPAIGN_MISSIONS, afterMission, crewLevel, dockDays, dockyard, enemySkill, fullStock, missionSettings, newRun,
  type CampaignRun, type MissionOutcome,
} from '../src/campaign-state.js';
import { CampaignStore } from '../src/campaign-store.js';
import { CampaignService, applyCarry, stockOf } from '../src/campaign-match.js';
import { Lobby } from '../src/lobby.js';
import type { Conn } from '../src/match.js';

function outcome(o: Partial<MissionOutcome> = {}): MissionOutcome {
  return {
    won: true, reason: 'x', survived: true, kills: 1, tonnage: 12_000, hull: 0.6,
    damage: { ...emptyDamage(), sonar: 0.5 }, casualties: 2, stock: { torpedoes: 5, rockets: 0, depthCharges: 0, noisemakers: 2 }, attacks: 2, ...o,
  };
}

describe('campaign state transitions', () => {
  it('a new run starts ready with a full ship and a green crew', () => {
    const r = newRun('ssk');
    expect(r).toMatchObject({ status: 'ready', side: 'east', stage: 0, day: 0 });
    expect(r.ship.stock).toEqual(fullStock('ssk'));
    // The Kilo-type carries 4 mines in place of 2 torpedoes
    expect(r.ship.stock.torpedoes).toBe(10);
    expect(crewLevel(r.crew.xp)).toBe('Grün');
    expect(newRun('ffg').side).toBe('west');
  });

  it('damage, losses and spent weapons carry over after a won mission', () => {
    const r = afterMission({ ...newRun('ssk'), status: 'sea' }, outcome());
    expect(r.status).toBe('dock');
    expect(r.stage).toBe(1);
    expect(r.ship.hull).toBe(0.6);
    expect(r.ship.damage.sonar).toBe(0.5);
    expect(r.ship.crewLost).toBe(2);
    expect(r.ship.stock.torpedoes).toBe(5);
    expect(r.crew).toMatchObject({ missions: 1, kills: 1, survivedAttacks: 2 });
    expect(r.crew.xp).toBeGreaterThan(0.1);
    expect(r.history).toHaveLength(1);
    expect(r.history[0]).toMatchObject({ won: true, lost: false, kills: 1 });
  });

  it('mines carry over into the next mission (old runs without a count start full)', () => {
    expect(fullStock('ssk').mines).toBe(4);
    expect(fullStock('ffg').mines).toBe(0);
    const r = afterMission({ ...newRun('ssk'), status: 'sea' }, outcome({ stock: { ...outcome().stock, mines: 1 } }));
    expect(r.ship.stock.mines).toBe(1);
    const boat = () => createShip({ id: 'u1', cls: 'ssk', name: 'U1', pos: { x: 0, y: 0 }, heading: 0 });
    const sub = boat();
    const w = createWorld([sub], 3);
    installWeapons(w);
    applyCarry(w, sub, r);
    expect(w.weapons!.loadouts.get('u1')!.mines).toBe(1);
    expect(stockOf(w, sub).mines).toBe(1);
    const old = { ...r, ship: { ...r.ship, stock: { ...r.ship.stock, mines: undefined } } };
    const w2 = createWorld([boat()], 3);
    installWeapons(w2);
    applyCarry(w2, w2.ships[0]!, old);
    expect(w2.weapons!.loadouts.get('u1')!.mines).toBe(4);
  });

  it('a lost mission keeps the stage; the next mission needs a dockyard decision first', () => {
    const r = afterMission({ ...newRun('ssk'), status: 'sea' }, outcome({ won: false }));
    expect(r.stage).toBe(0);
    expect(missionSettings(r)).toBe('Erst die Werftliegezeit festlegen');
  });

  it('the dockyard trades days against repairs and resupply', () => {
    const r = afterMission({ ...newRun('ssk'), status: 'sea' }, outcome());
    expect(dockDays(r.ship, { repair: 'keine', resupply: false })).toBe(0);
    expect(dockDays(r.ship, { repair: 'keine', resupply: true })).toBe(1);
    const fullDays = dockDays(r.ship, { repair: 'voll', resupply: true });
    expect(fullDays).toBeGreaterThan(2);
    // Going out damaged: nothing changes but the status
    const out = dockyard(r, { repair: 'keine', resupply: false }) as CampaignRun;
    expect(out.status).toBe('ready');
    expect(out.ship.hull).toBe(0.6);
    expect(out.day).toBe(r.day);
    // Patch-up: one day, half the damage, flooding stopped
    const patch = dockyard(r, { repair: 'notdienst', resupply: true }) as CampaignRun;
    expect(patch.day).toBe(r.day + 1);
    expect(patch.ship.damage.sonar).toBe(0.25);
    expect(patch.ship.hull).toBeCloseTo(0.8);
    expect(patch.ship.stock).toEqual(fullStock('ssk'));
    // Full repair: like new, empty posts filled (experience diluted a little), days pass
    const full = dockyard(r, { repair: 'voll', resupply: true }) as CampaignRun;
    expect(full.ship.hull).toBe(1);
    expect(full.ship.damage).toEqual(emptyDamage());
    expect(full.ship.crewLost).toBe(0);
    expect(full.crew.xp).toBeLessThan(r.crew.xp);
    expect(full.day).toBe(r.day + fullDays);
    expect(full.points).toBe(r.points - 2 * fullDays);
    expect(typeof missionSettings(full)).toBe('object');
  });

  it('a long dockyard stay strengthens the enemy', () => {
    const r: CampaignRun = { ...newRun('ssk'), stage: 2 };
    expect(enemySkill(r)).toBe('normal');
    expect(enemySkill({ ...r, dockDays: 5 })).toBe('schwer');
    expect(enemySkill({ ...r, stage: 0 })).toBe('leicht');
  });

  it('losing the ship costs a replacement of a lesser class, then ends the run', () => {
    let r: CampaignRun = { ...newRun('ssn'), status: 'sea', crew: { xp: 0.6, missions: 3, kills: 4, survivedAttacks: 2 } };
    r = afterMission(r, outcome({ survived: false, won: false }));
    expect(r.status).toBe('dock');
    expect(r.ship.cls).toBe('ssk');
    expect(r.ship.hull).toBe(1);
    expect(r.replacements).toBe(1);
    expect(r.crew.xp).toBeLessThan(0.4);
    expect(r.points).toBeLessThan(-100);
    r = afterMission({ ...r, status: 'sea' }, outcome({ survived: false, won: false }));
    expect(r.ship.cls).toBe('ssa');
    r = afterMission({ ...r, status: 'sea' }, outcome({ survived: false, won: false }));
    expect(r.status).toBe('lost');
    expect(missionSettings(r)).toBe('Die Kampagne ist beendet');
    // The smallest class has no replacement at all
    expect(afterMission({ ...newRun('kor'), status: 'sea' }, outcome({ survived: false })).status).toBe('lost');
  });

  it('winning every mission completes the run; experience is capped', () => {
    let r: CampaignRun = newRun('ffg');
    for (let i = 0; i < CAMPAIGN_MISSIONS.west.length; i++) {
      r = afterMission({ ...r, status: 'sea' }, outcome({ kills: 6, attacks: 6 }));
      if (r.status === 'dock') r = dockyard(r, { repair: 'keine', resupply: false }) as CampaignRun;
    }
    expect(r.status).toBe('complete');
    expect(r.crew.xp).toBeLessThanOrEqual(1);
    expect(crewLevel(r.crew.xp)).toBe('Veteranen');
  });
});

function fakeConn(id: string): Conn & { inbox: ServerMsg[] } {
  const inbox: ServerMsg[] = [];
  return { playerId: id, callsign: 'Kaleu', inbox, send: (m) => inbox.push(m) };
}

describe('campaign store and matches', () => {
  it('stores runs safely and carries the ship state into and out of a match', async () => {
    const auth = new AuthStore(':memory:');
    const reg = await auth.register({ callsign: 'Kaleu', email: 'k@x.de', password: 'passwort1', faction: 'east' });
    if (!('user' in reg)) throw new Error('register');
    const uid = reg.user.id;
    const store = new CampaignStore(auth.db);
    new CampaignStore(auth.db); // migration runs twice without harm
    expect(store.active(uid)).toBeUndefined();
    // A damaged boat with few torpedoes left goes out
    const run = dockyard(afterMission({ ...newRun('ssk'), status: 'sea' }, outcome({ won: true })), { repair: 'keine', resupply: false }) as CampaignRun;
    store.create(uid, run);
    const svc = new CampaignService(store);
    const lobby = new Lobby();
    lobby.onCampaignStart = (c) => svc.plan(c);
    const conn = fakeConn(`u-${uid}`);
    lobby.connect(conn);
    lobby.handle(conn, { t: 'campaign_start' });
    const m = lobby.matchOf(conn.playerId)!;
    m.stop();
    expect(m.settings).toMatchObject({ campaign: true, private: true, mission: CAMPAIGN_MISSIONS.east[1]!.mission });
    const ship = m.shipOf(conn.playerId)!;
    expect(ship.hp).toBeCloseTo(0.6 * CLASSES.ssk.hp);
    expect(ship.damage?.sonar).toBe(0.5);
    expect(ship.crew?.wounded).toBe(2);
    expect(ship.crew?.xp).toBe(run.crew.xp);
    const l = m.world!.weapons!.loadouts.get(ship.id)!;
    expect(l.tubes.filter((t) => t.loaded).length + l.heavy).toBe(5);
    expect(store.active(uid)!.run.status).toBe('sea');
    // Guests have no campaign
    const guest = fakeConn('g-1');
    lobby.connect(guest);
    lobby.handle(guest, { t: 'campaign_start' });
    expect(guest.inbox.some((x) => x.t === 'error')).toBe(true);
    // Leaving before the end counts as an aborted sortie with the ship as it is now
    ship.hp = 0.3 * CLASSES.ssk.hp;
    svc.finish(m);
    const after = store.active(uid)!.run;
    expect(after.status).toBe('dock');
    expect(after.stage).toBe(1);
    expect(after.ship.hull).toBeCloseTo(0.3);
    expect(after.history.at(-1)?.reason).toBe('Einsatz abgebrochen');
    // Unknown stored versions are ignored rather than crashing
    auth.db.prepare('UPDATE campaign_runs SET state = ? WHERE user_id = ?').run('{"v":99}', uid);
    expect(store.active(uid)).toBeUndefined();
  });
});
