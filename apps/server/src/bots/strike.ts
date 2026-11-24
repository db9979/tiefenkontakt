import { SSM_SPECS, bearing, distance, fireSsm, headingVec, ssmLeft, type ContactTrack, type Ship, type Vec2, type World } from '@tk/shared';

/**
 * Anti-ship strike for a missile-armed escort (Ostpakt patrol ship): radar in short bursts
 * once the convoy is within reach, then one round per launcher cycle at the radar contact
 * nearest the convoy's middle. The radar gives the ship away to ESM, as for a player.
 */
export function thinkStrike(w: World, s: Ship, tracks: ContactTrack[], convoyMid: Vec2 | undefined): void {
  const spec = SSM_SPECS[s.cls];
  if (!spec || !convoyMid || ssmLeft(w, s) <= 0) return;
  const far = distance(s.pos, convoyMid);
  if (far > spec.maxRange + 8000) return;
  // Stand off: keep the convoy between 14 and 30 km, outside the escorts' guns and inside missile reach
  if (far < 14_000) {
    s.order.heading = bearing(convoyMid, s.pos);
    s.order.speedKn = 24;
  } else if (far < 30_000) {
    s.order.heading = (bearing(s.pos, convoyMid) + 90) % 360;
    s.order.speedKn = 12;
  }
  // Burst the radar: 40 s in every two minutes
  s.radarOn = w.time % 120 < 40;
  const fixes = tracks
    .filter((t) => w.time - t.lastSeen < 20 && t.sensors.includes('radar') && t.range !== undefined)
    .map((t) => {
      const v = headingVec(t.bearing);
      return { at: { x: s.pos.x + v.x * t.range!, y: s.pos.y + v.y * t.range! }, r: t.range! };
    })
    .filter((f) => f.r >= spec.minRange && f.r <= spec.maxRange)
    .sort((a, b) => distance(a.at, convoyMid) - distance(b.at, convoyMid));
  // Two salvos of four (one per launcher pair), ten minutes apart: a salvo saturates the defence
  const left = ssmLeft(w, s);
  const last = w.env.ssm?.lastShot[s.id];
  if (left % 4 === 0 && left < spec.magazine && last !== undefined && w.time - last < 600) return;
  const aim = fixes[0];
  if (!aim || distance(aim.at, convoyMid) > 6000) return;
  // Aim a little short so the seeker opens on the near side of the formation
  const back = headingVec(bearing(aim.at, s.pos));
  fireSsm(w, s, { x: aim.at.x + back.x * 1500, y: aim.at.y + back.y * 1500 });
}
