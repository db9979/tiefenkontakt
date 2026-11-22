/**
 * Badges ("Abzeichen") for career milestones and campaign achievements. The server awards
 * them per account (apps/server/src/badges.ts); the client shows the symbol with the name
 * and description as tooltip. Names are German; the client's i18n translates them.
 */

export type BadgeId =
  | 'first_kill' | 'grt_50k' | 'grt_200k' | 'mine_kill' | 'survivor_10' | 'matches_50'
  | 'campaign_won' | 'campaign_no_replacement' | 'campaign_veteran' | 'season_podium';

export interface BadgeDef {
  id: BadgeId;
  symbol: string;
  name: string;
  desc: string;
  kind: 'career' | 'campaign' | 'season';
}

export const BADGES: readonly BadgeDef[] = [
  { id: 'first_kill', symbol: '✦', name: 'Erste Versenkung', desc: 'Das erste Schiff versenkt', kind: 'career' },
  { id: 'grt_50k', symbol: '⚓', name: '50.000 BRT', desc: '50.000 BRT versenkt', kind: 'career' },
  { id: 'grt_200k', symbol: '♆', name: '200.000 BRT', desc: '200.000 BRT versenkt', kind: 'career' },
  { id: 'mine_kill', symbol: '✸', name: 'Minenerfolg', desc: 'Ein Schiff mit eigener Mine versenkt', kind: 'career' },
  { id: 'survivor_10', symbol: '◈', name: 'Zähes Boot', desc: '10 Torpedoangriffe überlebt', kind: 'career' },
  { id: 'matches_50', symbol: '◎', name: 'Alter Hase', desc: '50 Partien gefahren', kind: 'career' },
  { id: 'campaign_won', symbol: '✠', name: 'Feldzug gewonnen', desc: 'Eine Kampagne gewonnen', kind: 'campaign' },
  { id: 'campaign_no_replacement', symbol: '✪', name: 'Ohne Ersatzschiff', desc: 'Eine Kampagne ohne Ersatzschiff gewonnen', kind: 'campaign' },
  { id: 'campaign_veteran', symbol: '❖', name: 'Veteranenbesatzung', desc: 'Eine Kampagnenbesatzung zu Veteranen gemacht', kind: 'campaign' },
  { id: 'season_podium', symbol: '♛', name: 'Saisonpodest', desc: 'Unter den ersten drei einer Saison', kind: 'season' },
];

export const BADGE_BY_ID: Readonly<Record<string, BadgeDef>> = Object.fromEntries(BADGES.map((b) => [b.id, b]));

/** Career totals the career badges are judged on. */
export interface CareerTotals {
  matches: number;
  kills: number;
  tonnage: number;
  mineKills: number;
  attacksSurvived: number;
}

/** Career badges a player has earned with these totals. */
export function careerBadges(t: CareerTotals): BadgeId[] {
  const out: BadgeId[] = [];
  if (t.kills >= 1) out.push('first_kill');
  if (t.tonnage >= 50_000) out.push('grt_50k');
  if (t.tonnage >= 200_000) out.push('grt_200k');
  if (t.mineKills >= 1) out.push('mine_kill');
  if (t.attacksSurvived >= 10) out.push('survivor_10');
  if (t.matches >= 50) out.push('matches_50');
  return out;
}

/** Campaign badges for a run's final state. */
export function campaignBadges(run: { status: string; replacements: number; crew: { xp: number } }): BadgeId[] {
  const out: BadgeId[] = [];
  if (run.crew.xp >= 0.7) out.push('campaign_veteran');
  if (run.status === 'complete') {
    out.push('campaign_won');
    if (run.replacements === 0) out.push('campaign_no_replacement');
  }
  return out;
}
