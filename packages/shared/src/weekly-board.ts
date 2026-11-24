/** One line of the weekly board: best result of an account on one side. */
export interface WeeklyRow {
  rank: number;
  callsign: string;
  cls: string;
  score: number;
  won: boolean;
}

/** The week's situation and its board (GET /api/weekly). */
export interface WeeklyBoard {
  week: string;
  west: WeeklyRow[];
  east: WeeklyRow[];
  /** What this week's situation is (resolved: no 'zufall'). */
  lage?: { mission: string; area?: string; timeOfDay: string; weather: string; seaState: number; endsAt: number };
}
