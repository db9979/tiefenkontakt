import { CLASSES, boundedQuality, evaluateSolution, speedPrior, type SpeedPrior } from '@tk/shared';
import { store } from '../store.js';

type Contact = NonNullable<typeof store.snap>['contacts'][number];

/** What the ear and the eye say about her speed: classification, DEMON shaft rate, tonals. */
export function priorFor(c: Contact): SpeedPrior {
  const m = store.marks.get(c.label);
  const cls = c.assignedCls ?? c.classified;
  const tonals = (c.evidence?.tonals ?? []).map((t) => t.hz);
  if (m?.tonalHz) tonals.push(m.tonalHz);
  return speedPrior({
    choice: c.assigned,
    classMaxKn: cls ? CLASSES[cls].maxSpeedKn : undefined,
    shaftHz: m?.shaftHz ?? c.evidence?.shaftHz,
    tonalsHz: tonals,
  });
}

/**
 * Güte of a contact's solution as TMA and FEUER show it: capped while its speed only sits on a
 * bound of the prior (N4: the hint read the raw quality, 68 % against 29 % on the stations).
 */
export function solutionQuality(label: string): number {
  const c = store.snap?.contacts.find((x) => x.label === label);
  const sol = store.solutions.get(label);
  if (!c || !sol) return 0;
  return boundedQuality(evaluateSolution(sol, c.history, store.ownTrack).quality, sol, priorFor(c));
}
