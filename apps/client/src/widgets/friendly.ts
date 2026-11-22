import { angleDiff, bearing, type ClassChoice, type ContactTrack, type Snapshot } from '@tk/shared';

const CHOICE_OF_CLASS = { merchant: 'merchant', ffg: 'warship', kor: 'warship', ssn: 'submarine', ssk: 'submarine', ssc: 'submarine' } as const;

/**
 * Datalink correlation: a sonar contact that lines up with a known friendly ship
 * (convoy or escort) is tagged as own. Uses only information the player has.
 */
export function isFriendlyContact(
  c: Pick<ContactTrack, 'bearing' | 'range' | 'classified' | 'sensors'> & { assigned?: ClassChoice },
  s: Snapshot,
): boolean {
  if (c.assigned === 'torpedo') return false;
  if (s.friendlies.length === 0 || c.sensors.includes('esm')) return false;
  for (const f of s.friendlies) {
    if (!f.alive || s.time - f.reportedAt > 30) continue;
    if (c.classified && c.classified !== f.cls) continue;
    if (c.assigned && c.assigned !== 'unknown' && c.assigned !== CHOICE_OF_CLASS[f.cls]) continue;
    const b = bearing(s.own, f);
    if (Math.abs(angleDiff(b, c.bearing)) > 2) continue;
    if (c.range !== undefined && Math.abs(c.range - Math.hypot(f.x - s.own.x, f.y - s.own.y)) > 800) continue;
    return true;
  }
  return false;
}
