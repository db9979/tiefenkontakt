import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { campaignBadges, careerBadges, type Debrief, type PlayerStats } from '@tk/shared';
import { AuthStore } from '../src/auth.js';
import { BadgeStore } from '../src/badges.js';
import { newRun } from '../src/campaign-state.js';
import { Rankings } from '../src/rankings.js';
import { feats } from '../src/recorder.js';
import { previousSeason, seasonById, seasonMonths, seasonOf } from '../src/seasons.js';
import { BOT_ONLY_WEIGHT, StatsStore, pointsFor } from '../src/stats.js';

const st = (playerId: string, team: 'west' | 'east', won: boolean, extra: Partial<PlayerStats> = {}): PlayerStats => ({
  playerId, callsign: playerId, team, cls: team === 'west' ? 'ffg' : 'ssk', survived: true, shots: 0, rockets: 0, buoys: 0,
  kills: 0, tonnageSunk: 0, distanceNm: 0, won, ...extra,
});
const debrief = (stats: PlayerStats[]): Debrief => ({
  ships: [], frames: [], torpedoes: [], events: [], stats, winner: stats.find((s) => s.won)?.team ?? 'west', reason: '', duration: 600,
});

async function setup(names: string[]) {
  const auth = new AuthStore(':memory:');
  const ids: number[] = [];
  for (const n of names) {
    const r = await auth.register({ callsign: n, email: `${n.toLowerCase()}@x.de`, password: 'passwort1', faction: 'east' });
    if (!('user' in r)) throw new Error('register');
    auth.markVerified(r.user.id);
    ids.push(r.user.id);
  }
  const stats = new StatsStore(auth.db);
  const badges = new BadgeStore(auth.db);
  const rankings = new Rankings(auth.db, stats, badges, 3);
  return { auth, stats, badges, rankings, ids };
}

describe('seasons', () => {
  it('assigns calendar quarters in UTC by default and other lengths when configured', () => {
    expect(seasonMonths(undefined)).toBe(3);
    expect(seasonMonths('5')).toBe(3);
    expect(seasonMonths('6')).toBe(6);
    const nov = Date.UTC(2026, 10, 22, 12);
    expect(seasonOf(nov, 3)).toEqual({ id: '2026-Q4', start: Date.UTC(2026, 9, 1), end: Date.UTC(2027, 0, 1) });
    expect(seasonOf(nov, 12).id).toBe('2026');
    expect(seasonOf(nov, 6).id).toBe('2026-H2');
    expect(seasonOf(nov, 1).id).toBe('2026-11');
    expect(seasonOf(Date.UTC(2027, 0, 1) - 1, 3).id).toBe('2026-Q4');
    expect(seasonOf(Date.UTC(2027, 0, 1), 3).id).toBe('2027-Q1');
    expect(previousSeason(seasonOf(Date.UTC(2027, 0, 5), 3), 3).id).toBe('2026-Q4');
    expect(seasonById('2026-Q2', 3)?.start).toBe(Date.UTC(2026, 3, 1));
    expect(seasonById('2026-H1', 3)).toBeUndefined();
    expect(seasonById('nonsense', 3)).toBeUndefined();
  });
});

describe('season ranking', () => {
  it('ranks per season and all time, weights AI-only opposition half, never lists guests or bots', async () => {
    const { stats, rankings, ids } = await setup(['Alpha', 'Bravo']);
    const [a, b] = ids as [number, number];
    const q3 = Date.UTC(2026, 7, 10);
    const q4 = Date.UTC(2026, 10, 10);
    // Q3: Alpha beats Bravo (human opposition, full points)
    stats.record(debrief([st(`u-${a}`, 'east', true, { tonnageSunk: 20_000 }), st(`u-${b}`, 'west', false)]), 'groenland', 'tag', q3);
    // Q4: Bravo beats AI only (half points), a guest and a bot also played
    stats.record(debrief([st(`u-${b}`, 'west', true), st('g-abc', 'west', true), st('bot-1', 'east', false)]), 'groenland', 'tag', q4);

    const q4View = rankings.view('current', Date.UTC(2026, 10, 22))!;
    expect(q4View.season?.id).toBe('2026-Q4');
    expect(q4View.rows.map((r) => r.callsign)).toEqual(['Bravo']);
    expect(q4View.rows[0]!.points).toBe(Math.round(pointsFor(st('x', 'west', true)) * BOT_ONLY_WEIGHT));

    const q3View = rankings.view('2026-Q3', Date.UTC(2026, 10, 22))!;
    expect(q3View.rows.map((r) => r.callsign)).toEqual(['Alpha', 'Bravo']);
    expect(q3View.rows[0]!.points).toBe(pointsFor(st('x', 'east', true, { tonnageSunk: 20_000 })));

    const all = rankings.view('all', Date.UTC(2026, 10, 22))!;
    expect(all.season).toBeNull();
    expect(all.rows.map((r) => r.callsign).sort()).toEqual(['Alpha', 'Bravo']);
    expect(all.rows.some((r) => r.callsign === 'g-abc' || r.callsign === 'bot-1')).toBe(false);

    // Unknown or future seasons are refused
    expect(rankings.view('2099-Q1', Date.UTC(2026, 10, 22))).toBeUndefined();
    expect(rankings.view("'; DROP TABLE results", Date.UTC(2026, 10, 22))).toBeUndefined();
  });

  it('freezes the top three of a finished season and awards the podium badge once', async () => {
    const { stats, rankings, badges, ids } = await setup(['Alpha', 'Bravo', 'Charlie', 'Delta']);
    const q3 = Date.UTC(2026, 7, 10);
    ids.forEach((id, i) => {
      for (let k = 0; k <= i; k++) stats.record(debrief([st(`u-${id}`, 'east', true), st('g-x', 'west', false)]), 'groenland', 'tag', q3 + k);
    });
    const closed = rankings.closeSeasons(Date.UTC(2026, 10, 1));
    expect(closed.map((s) => s.id)).toEqual(['2026-Q3']);
    expect(rankings.closeSeasons(Date.UTC(2026, 10, 2))).toEqual([]);
    const past = rankings.seasons.past();
    expect(past[0]!.podium.map((p) => p.callsign)).toEqual(['Delta', 'Charlie', 'Bravo']);
    expect(badges.of(ids[3]!).map((x) => x.id)).toContain('season_podium');
    expect(badges.of(ids[0]!).map((x) => x.id)).not.toContain('season_podium');
  });
});

describe('badges', () => {
  it('judges career totals and campaign runs', () => {
    expect(careerBadges({ matches: 1, kills: 0, tonnage: 0, mineKills: 0, attacksSurvived: 0 })).toEqual([]);
    expect(careerBadges({ matches: 50, kills: 3, tonnage: 60_000, mineKills: 1, attacksSurvived: 10 }))
      .toEqual(['first_kill', 'grt_50k', 'mine_kill', 'survivor_10', 'matches_50']);
    const run = newRun('ssk');
    expect(campaignBadges(run)).toEqual([]);
    expect(campaignBadges({ ...run, status: 'complete' })).toEqual(['campaign_won', 'campaign_no_replacement']);
    expect(campaignBadges({ ...run, status: 'complete', replacements: 1, crew: { ...run.crew, xp: 0.8 } })).toEqual(['campaign_veteran', 'campaign_won']);
  });

  it('awards after a match, keeps each badge once and shows them on the leaderboard', async () => {
    const { stats, rankings, badges, ids } = await setup(['Alpha']);
    const a = ids[0]!;
    const d = debrief([st(`u-${a}`, 'east', true, { kills: 4, tonnageSunk: 52_000, mineKills: 1, attacksSurvived: 6 }), st('bot-1', 'west', false)]);
    stats.record(d, 'groenland', 'tag');
    rankings.afterMatch(d);
    expect(badges.of(a).map((x) => x.id)).toEqual(['first_kill', 'grt_50k', 'mine_kill']);
    stats.record(d, 'groenland', 'tag');
    rankings.afterMatch(d);
    const ids2 = badges.of(a).map((x) => x.id);
    expect(ids2).toContain('survivor_10');
    expect(ids2.filter((x) => x === 'first_kill')).toHaveLength(1);
    rankings.afterCampaign(a, { ...newRun('ssk'), status: 'complete' });
    expect(badges.of(a).map((x) => x.id)).toContain('campaign_no_replacement');
    const row = rankings.view('current')!.rows[0]!;
    expect(row.badges).toEqual(['first_kill', 'grt_50k', 'mine_kill', 'survivor_10', 'campaign_won', 'campaign_no_replacement']);
    let body: unknown;
    expect(rankings.handle('GET', '/api/leaderboard', (_s, b) => (body = b))).toBe(true);
    expect((body as Record<string, unknown>[])[0]).not.toHaveProperty('userId');
    expect(rankings.handle('GET', '/api/rankings?season=bogus', (s) => expect(s).toBe(400))).toBe(true);
  });
});

describe('migration on an existing database', () => {
  it('adds columns and tables without losing data, backfills weights and badges', () => {
    const db = new DatabaseSync(':memory:');
    // Schema as in production before this change
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, callsign TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE results (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), ended_at INTEGER NOT NULL,
        mission TEXT NOT NULL, time_of_day TEXT NOT NULL, team TEXT NOT NULL, cls TEXT NOT NULL, won INTEGER NOT NULL, kills INTEGER NOT NULL,
        tonnage INTEGER NOT NULL, shots INTEGER NOT NULL, survived INTEGER NOT NULL, points INTEGER NOT NULL);
      CREATE TABLE matches (id INTEGER PRIMARY KEY AUTOINCREMENT, ended_at INTEGER NOT NULL, mission TEXT NOT NULL, time_of_day TEXT NOT NULL,
        winner TEXT NOT NULL, duration INTEGER NOT NULL, humans_west INTEGER NOT NULL, humans_east INTEGER NOT NULL, classes TEXT NOT NULL);
      CREATE TABLE campaign_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, started_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, state TEXT NOT NULL);
      INSERT INTO users (callsign) VALUES ('Alt'), ('Neu');
      INSERT INTO matches (ended_at, mission, time_of_day, winner, duration, humans_west, humans_east, classes) VALUES
        (1000, 'groenland', 'tag', 'east', 600, 0, 1, '[]'), (2000, 'schelf', 'tag', 'east', 600, 1, 1, '[]');
      INSERT INTO results (user_id, ended_at, mission, time_of_day, team, cls, won, kills, tonnage, shots, survived, points) VALUES
        (1, 1000, 'groenland', 'tag', 'east', 'ssk', 1, 4, 60000, 4, 1, 55),
        (1, 2000, 'schelf', 'tag', 'east', 'ssk', 1, 1, 10000, 2, 1, 35),
        (2, 2000, 'schelf', 'tag', 'west', 'ffg', 0, 0, 0, 2, 0, -5);`);
    db.prepare('INSERT INTO campaign_runs (user_id, started_at, updated_at, active, state) VALUES (2, 1, 1, 0, ?)').run(JSON.stringify({ ...newRun('ffg'), status: 'complete', replacements: 1 }));

    const stats = new StatsStore(db);
    const rankings = new Rankings(db, stats, new BadgeStore(db), 3);
    rankings.init(Date.UTC(2026, 10, 22));
    // Constructing twice (next server start) is harmless
    new StatsStore(db);

    const rows = db.prepare('SELECT user_id, points, weight, mine_kills, attacks_survived FROM results ORDER BY id').all() as Record<string, number>[];
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.points)).toEqual([55, 35, -5]);
    expect(rows.map((r) => r.weight)).toEqual([BOT_ONLY_WEIGHT, 1, 1]);
    expect(rows.every((r) => r.mine_kills === 0 && r.attacks_survived === 0)).toBe(true);
    expect(stats.leaderboard(10).map((r) => [r.callsign, r.points])).toEqual([['Alt', 63], ['Neu', -5]]);
    const badges = new BadgeStore(db);
    expect(badges.of(1).map((b) => b.id)).toEqual(['first_kill', 'grt_50k', 'season_podium']);
    expect(badges.of(2).map((b) => b.id)).toEqual(['campaign_won']);
    // 1970's results start the season history: the old seasons are closed with their podium
    expect(rankings.seasons.past(1000).some((s) => s.podium.some((p) => p.callsign === 'Alt'))).toBe(true);
  });
});

describe('debrief feats for badges', () => {
  it('counts mine kills and torpedo attacks survived', () => {
    const events = [
      { kind: 'mine', what: 'detonated', time: 99.6, mineId: 'M1', team: 'east', shipId: 'm1', x: 0, y: 0 },
      { kind: 'torpedo_alert', time: 50, shipId: 'p_u-1', bearing: 0 },
      { kind: 'torpedo_alert', time: 80, shipId: 'p_u-1', bearing: 0 },
      { kind: 'torpedo_alert', time: 80, shipId: 'p_u-2', bearing: 0 },
    ];
    const w = { events } as unknown as Parameters<typeof feats>[0];
    const kills = [{ t: 100, shipId: 'm1' }, { t: 120, shipId: 'm2' }];
    expect(feats(w, 'p_u-1', kills, true)).toEqual({ mineKills: 1, attacksSurvived: 2 });
    expect(feats(w, 'p_u-1', [], false)).toEqual({ mineKills: undefined, attacksSurvived: undefined });
  });
});
