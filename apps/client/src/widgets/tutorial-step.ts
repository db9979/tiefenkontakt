import type { Snapshot, StationId } from '@tk/shared';

/**
 * One tutorial step (E2): one imperative line, the reason behind it folded away under
 * "Warum?", the station it happens at (a click on the step goes there) and the control it is
 * about (an amber outline pulses twice on it).
 */
export interface Step {
  /** Station of the step; none for the helm and the side panels (always on screen). */
  station?: StationId;
  /** Place on the station or a short topic: "Lagebild", "Ruderstand · Fahrt". */
  where: string;
  /** What to do, as one short imperative line. */
  do: string;
  /** Why (collapsed under "Warum?"). */
  why?: string;
  /** CSS selector of the control the step is about. */
  target?: string;
  done: (s: Snapshot) => boolean;
}

export interface Lesson {
  title: string;
  steps: Step[];
  /** Strictly in order: only the current step is checked. */
  sequential?: boolean;
}

/** Helm telegraph buttons by speed name (index in screens/helm.ts TELEGRAPH). */
export const TEL = { schleich: '#h-tel [data-tel="4"]', langsam: '#h-tel [data-tel="5"]', halbe: '#h-tel [data-tel="6"]' } as const;
