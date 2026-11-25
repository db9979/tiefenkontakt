import { CLASSES, type Debrief, type PlayerStats, type TmaSolution } from '@tk/shared';

/**
 * The debrief's per-player grade and the partial-victory band. Pure functions (no DOM, no
 * language switch: the page translation handles the German labels).
 */

export type Band = NonNullable<Debrief['band']>;

/** SIEG / KNAPPER SIEG / UNENTSCHIEDEN / KNAPPE NIEDERLAGE / NIEDERLAGE, from the own side's view. */
export function bandLabel(won: boolean, band?: Band): string {
  if (band === 'remis') return 'UNENTSCHIEDEN';
  if (band === 'knapp') return won ? 'KNAPPER SIEG' : 'KNAPPE NIEDERLAGE';
  return won ? 'SIEG' : 'NIEDERLAGE';
}

/** What the band means under the rules (the winner still counts for rankings). */
export function bandNote(band: Band | undefined, winner: 'west' | 'east'): string {
  const side = winner === 'west' ? 'WESTBUND' : 'OSTPAKT';
  return band === 'remis' ? `NACH DEN REGELN GEHT DIE PARTIE KNAPP AN DEN ${side}` : '';
}

/**
 * Best TMA quality (0..1) of the player's own solutions: position error against the nearest
 * enemy or convoy ship in the replay at the solution's time (300 m or better = 1, 3 km = 0).
 */
export function tmaQuality(d: Debrief, ownTeam: string, solutions: Iterable<TmaSolution>): number | undefined {
  const enemies = new Set(d.ships.filter((s) => s.team !== ownTeam && s.team !== 'neutral').map((s) => s.id));
  let best: number | undefined;
  for (const sol of solutions) {
    let frame = d.frames[0];
    for (const f of d.frames) if (Math.abs(f[0] - sol.t0) < Math.abs((frame?.[0] ?? Infinity) - sol.t0)) frame = f;
    if (!frame || Math.abs(frame[0] - sol.t0) > 60) continue;
    let err = Infinity;
    for (const [id, x, y, , alive] of frame[1]) if (alive && enemies.has(id)) err = Math.min(err, Math.hypot(x - sol.x0, y - sol.y0));
    if (!Number.isFinite(err)) continue;
    const q = Math.max(0, Math.min(1, 1 - (err - 300) / 2700));
    best = Math.max(best ?? 0, q);
  }
  return best;
}

export interface Grade {
  score: number;
  label: string;
  lines: { label: string; value: string; share: number }[];
}

const LABELS: [number, string][] = [[85, 'AUSGEZEICHNET'], [70, 'GUT'], [55, 'BEFRIEDIGEND'], [40, 'AUSREICHEND'], [0, 'MANGELHAFT']];
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const pct = (x: number) => `${Math.round(x * 100)} %`;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** Grade one player from the debrief figures (weights: what the role is for). */
export function gradeOf(st: PlayerStats, duration: number, tma?: number): Grade {
  const sub = CLASSES[st.cls].submarine;
  const lines: (Grade['lines'][number] & { w: number })[] = [];
  const add = (label: string, value: string, share: number, w: number) => lines.push({ label, value, share: clamp(share), w });
  const hits = st.hits ?? 0;
  add('KONTAKTE KLASSIFIZIERT', String(st.classified ?? 0), (st.classified ?? 0) / 2, 1);
  if (sub && st.team === 'east') {
    add('BESTE TMA-GÜTE', tma === undefined ? '—' : pct(tma), tma ?? 0, 1);
    const free = Math.min(duration, st.undetectedS ?? duration);
    add('UNENTDECKT', mmss(free), duration > 0 ? free / duration : 0, 1);
    add('SCHÜSSE / TREFFER', `${st.shots} / ${hits}`, st.shots ? (hits / st.shots) * 0.7 + (st.kills > 0 ? 0.3 : 0) : 0, 1.5);
  } else {
    add('KONTAKTE GEHALTEN', String(st.held ?? 0), (st.held ?? 0) / 2, 1);
    const attacks = st.shots + st.rockets;
    add('ANGRIFFE / TREFFER', `${attacks} / ${hits}`, Math.min(1, attacks / 3) * 0.4 + Math.min(1, hits) * 0.6, 1.5);
    if (st.merchantsSafe !== undefined) add('FRACHTER GESCHÜTZT', pct(st.merchantsSafe), st.merchantsSafe, 1.5);
    else if (sub) add('UNENTDECKT', mmss(Math.min(duration, st.undetectedS ?? duration)), duration > 0 ? Math.min(duration, st.undetectedS ?? duration) / duration : 0, 1);
  }
  add('ÜBERLEBT', st.survived ? 'JA' : 'NEIN', st.survived ? 1 : 0, 0.5);
  const total = lines.reduce((a, l) => a + l.w, 0);
  const score = Math.round((100 * lines.reduce((a, l) => a + l.share * l.w, 0)) / total);
  return { score, label: LABELS.find(([min]) => score >= min)![1], lines: lines.map(({ label, value, share }) => ({ label, value, share })) };
}

/** The grade block for the player's own line in the debrief. */
export function gradePanel(d: Debrief, playerId: string | undefined, tma?: number): string {
  const st = d.stats.find((s) => s.playerId === playerId);
  if (!st) return '';
  const g = gradeOf(st, d.duration, tma);
  return `<div class="hd" style="margin-top:4px"><span>Bewertung</span><span class="${g.score >= 55 ? '' : 'amber'}">${g.label} · ${g.score}</span></div>` +
    g.lines.map((l) => `<div class="row"><span class="dim">${l.label}</span><span>${l.value} <span class="cbar" style="display:inline-block;width:48px;height:5px;background:var(--line);vertical-align:middle"><i style="display:block;height:100%;width:${Math.round(l.share * 100)}%;background:var(--g)"></i></span></span></div>`).join('');
}
