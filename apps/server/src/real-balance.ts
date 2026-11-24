import type { DatabaseSync } from 'node:sqlite';

/**
 * Balance from real matches (the `matches` table of finished, non-training matches). Only
 * matches with humans count: "pvp" has at least one human on each side, "pve" humans on one
 * side against the AI (counted for the humans' side). AI-only matches are left out.
 * Read only, so scripts/real-balance.ts can open the live database read-only.
 */

export type Group = 'pvp' | 'pve';
type Side = 'west' | 'east';
/** Who sailed a class: human, AI, or unknown (older rows without crew data, mixed sides). */
export type Crew = 'mensch' | 'ki' | '?';

export interface MissionBalance { mission: string; group: Group; side: Side; games: number; wins: number }
export interface ClassBalance { cls: string; group: Group; side: Side; crew: Crew; games: number; wins: number }
export interface RealBalance { total: number; pvp: number; pve: number; botsOnly: number; missions: MissionBalance[]; classes: ClassBalance[] }

interface Row { mission: string; winner: string; humans_west: number; humans_east: number; classes: string; crew?: string | null }

/** [team, cls, human 0/1] per player ship of a finished match. */
export type CrewEntry = [Side, string, 0 | 1];

/** Human flag per ship: 1 human, 0 AI, -1 unknown. */
function crewOf(r: Row): [Side, string, number][] {
  if (r.crew) return JSON.parse(r.crew) as CrewEntry[];
  // Older rows: player ships only, humans counted per side
  const ships = (JSON.parse(r.classes) as string[]).map((c) => c.split(':') as [Side, string]);
  const humans = { west: r.humans_west, east: r.humans_east };
  const n = { west: ships.filter(([t]) => t === 'west').length, east: ships.filter(([t]) => t === 'east').length };
  return ships.map(([t, cls]) => [t, cls, humans[t] === 0 ? 0 : humans[t] >= n[t] ? 1 : -1]);
}

export function realBalance(db: DatabaseSync): RealBalance {
  const cols = (db.prepare('PRAGMA table_info(matches)').all() as { name: string }[]).map((c) => c.name);
  if (!cols.length) return { total: 0, pvp: 0, pve: 0, botsOnly: 0, missions: [], classes: [] };
  const rows = db.prepare(`SELECT mission, winner, humans_west, humans_east, classes${cols.includes('crew') ? ', crew' : ''} FROM matches`).all() as unknown as Row[];
  const out: RealBalance = { total: rows.length, pvp: 0, pve: 0, botsOnly: 0, missions: [], classes: [] };
  const missions = new Map<string, MissionBalance>();
  const classes = new Map<string, ClassBalance>();
  const bump = <T extends { games: number; wins: number }>(map: Map<string, T>, key: string, init: () => T, won: boolean) => {
    const r = map.get(key) ?? init();
    r.games++;
    if (won) r.wins++;
    map.set(key, r);
  };
  for (const r of rows) {
    const w = r.humans_west > 0;
    const e = r.humans_east > 0;
    if (!w && !e) {
      out.botsOnly++;
      continue;
    }
    const group: Group = w && e ? 'pvp' : 'pve';
    out[group]++;
    const sides: Side[] = group === 'pvp' ? ['west', 'east'] : [w ? 'west' : 'east'];
    for (const side of sides) {
      bump(missions, `${r.mission}|${group}|${side}`, () => ({ mission: r.mission, group, side, games: 0, wins: 0 }), r.winner === side);
    }
    // Each class once per match, side and crew
    const seen = new Set<string>();
    for (const [side, cls, human] of crewOf(r)) {
      const crew: Crew = human === 1 ? 'mensch' : human === 0 ? 'ki' : '?';
      const key = `${cls}|${group}|${side}|${crew}`;
      if (seen.has(key)) continue;
      seen.add(key);
      bump(classes, key, () => ({ cls, group, side, crew, games: 0, wins: 0 }), r.winner === side);
    }
  }
  const order = (a: { group: string; side: string }, b: { group: string; side: string }) => a.group.localeCompare(b.group) || a.side.localeCompare(b.side);
  out.missions = [...missions.values()].sort((a, b) => order(a, b) || a.mission.localeCompare(b.mission));
  out.classes = [...classes.values()].sort((a, b) => order(a, b) || a.cls.localeCompare(b.cls) || a.crew.localeCompare(b.crew));
  return out;
}

/** Plain text tables of the same numbers (scripts/real-balance.ts). */
export function formatRealBalance(b: RealBalance): string {
  const pct = (w: number, g: number) => `${Math.round((100 * w) / Math.max(1, g))} %`.padStart(6);
  const lines = [
    `Partien: ${b.total} · Mensch gegen Mensch ${b.pvp} · Mensch gegen KI ${b.pve} · nur KI (nicht gezählt) ${b.botsOnly}`,
    '',
    '== Siegquote je Einsatz und Seite ==',
    `${'Gruppe'.padEnd(7)}${'Seite'.padEnd(6)}${'Einsatz'.padEnd(12)}${'Partien'.padStart(8)}${'Siege'.padStart(7)}${'Quote'.padStart(7)}`,
    ...b.missions.map((m) => `${m.group.padEnd(7)}${m.side.padEnd(6)}${m.mission.padEnd(12)}${String(m.games).padStart(8)}${String(m.wins).padStart(7)} ${pct(m.wins, m.games)}`),
    '',
    '== Siegquote je Klasse ==',
    `${'Gruppe'.padEnd(7)}${'Seite'.padEnd(6)}${'Klasse'.padEnd(8)}${'Crew'.padEnd(8)}${'Partien'.padStart(8)}${'Siege'.padStart(7)}${'Quote'.padStart(7)}`,
    ...b.classes.map((c) => `${c.group.padEnd(7)}${c.side.padEnd(6)}${c.cls.padEnd(8)}${c.crew.padEnd(8)}${String(c.games).padStart(8)}${String(c.wins).padStart(7)} ${pct(c.wins, c.games)}`),
  ];
  return lines.join('\n');
}
