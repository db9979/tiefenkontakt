/** German → English: seasons on the leaderboard and badges (names, descriptions, shelf). */
export const EN_RANKS: [string, string][] = [
  ['Abzeichen', 'Badges'], ['GESAMT', 'ALL TIME'], ['Saison wählen', 'Choose season'], ['ALLE PARTIEN', 'ALL MATCHES'],
  ['Partien gegen eine reine KI-Seite zählen halb.', 'Matches against an AI-only side count half.'],
  ['Frühere Saisons', 'Past seasons'], ['PODEST', 'PODIUM'],
  ['Erste Versenkung', 'First sinking'], ['Das erste Schiff versenkt', 'Sank the first ship'],
  ['50.000 BRT', '50,000 GRT'], ['50.000 BRT versenkt', '50,000 GRT sunk'],
  ['200.000 BRT', '200,000 GRT'], ['200.000 BRT versenkt', '200,000 GRT sunk'],
  ['Minenerfolg', 'Mine kill'], ['Ein Schiff mit eigener Mine versenkt', 'Sank a ship with an own mine'],
  ['Zähes Boot', 'Tough boat'], ['10 Torpedoangriffe überlebt', 'Survived 10 torpedo attacks'],
  ['Alter Hase', 'Old hand'], ['50 Partien gefahren', 'Sailed 50 matches'],
  ['Feldzug gewonnen', 'Campaign won'], ['Eine Kampagne gewonnen', 'Won a campaign'],
  ['Ohne Ersatzschiff', 'No replacement ship'], ['Eine Kampagne ohne Ersatzschiff gewonnen', 'Won a campaign without a replacement ship'],
  ['Veteranenbesatzung', 'Veteran crew'], ['Eine Kampagnenbesatzung zu Veteranen gemacht', 'Made a campaign crew veterans'],
  ['Saisonpodest', 'Season podium'], ['Unter den ersten drei einer Saison', 'Top three of a season'],
];

export const EN_RANKS_PHRASES: [RegExp, string][] = [
  [/^SAISON (\d{4}(?:-[A-Z]?\d+)?)$/, 'SEASON $1'],
];
