/** German → English: match pacing (duration, fast-forward), lobby start row, sunk overlay, debrief grade. */
export const EN_PACING: [string, string][] = [
  ['EINSATZDAUER', 'DURATION'], ['ZEITRAFFER', 'TIME COMPRESSION'], ['ECHTZEIT', 'REAL TIME'],
  ['So lange dauert die Partie in echten Minuten; mit Zeitraffer vergeht auf See entsprechend mehr Zeit', 'How long the match lasts in real minutes; with time compression more time passes at sea'],
  ['Wie schnell die Zeit auf See läuft. Die echte Spieldauer bleibt gleich; mit Zeitraffer ist der Weg des Konvois länger und die Lage weiter auseinander', 'How fast time runs at sea. The real duration stays the same; with compression the convoy’s passage is longer and the forces start further apart'],
];

export const EN_PACING_PHRASES: [RegExp, string][] = [
  [/ECHTZEIT · (\d+) MIN AUF SEE/, 'REAL TIME · $1 MIN AT SEA'], [/(\d)× · (\d+) MIN AUF SEE/, '$1× · $2 MIN AT SEA'],
  [/(\d+) MIN · ECHTZEIT/, '$1 MIN · REAL TIME'], [/(\d+) MIN AUF SEE · ZEITRAFFER (\d)×, (\d+) MIN ECHT/, '$1 MIN AT SEA · COMPRESSION $2×, $3 MIN REAL'],
];
