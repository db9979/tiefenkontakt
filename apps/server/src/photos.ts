import {
  ASPECT_DE,
  CLASSES,
  RECOG,
  allPlanes,
  angleDiff,
  aspectWord,
  bearing,
  distance,
  horizonRange,
  mastRaised,
  seeingLight,
  type ClassId,
  type ClientMsg,
  type PhotoRecord,
  type PlaneKind,
  type Ship,
  type World,
} from '@tk/shared';
import type { Match } from './match.js';

/**
 * Periscope and bridge photos. The client keeps the picture; the server only learns where the
 * camera looked (bearing, field of view, elevation) and grades the photo against the truth:
 * what is in the frame, how big and how central, its aspect, the visibility, and for a
 * submarine how long the mast had been showing.
 */

export type PhotoMsg = Extract<ClientMsg, { t: 'photo' }>;

/** Photos per ship and match (a roll of film). */
export const FILM = 24;
const D = Math.PI / 180;

const PLANE: Record<PlaneKind, { name: string; span: number; day: number }> = {
  airliner: { name: 'Verkehrsflugzeug', span: 45, day: 45_000 },
  recon: { name: 'Fernaufklärer', span: 50, day: 18_000 },
  mpa: { name: 'Seeaufklärer', span: 35, day: 15_000 },
  helo: { name: 'Hubschrauber', span: 17, day: 9000 },
  light: { name: 'Kleinflugzeug', span: 10, day: 6000 },
};

interface Candidate {
  id: string;
  cls?: ClassId;
  plane?: PlaneKind;
  name: string;
  range: number;
  limit: number;
  off: number;
  /** Half the angular width the target covers in the picture (deg). */
  halfW: number;
  aspect: number;
}

/** Visibility for the eye: sea state, daylight and rain (1 = clear day, calm sea). */
export function photoVisibility(w: World): number {
  const light = seeingLight(w.env);
  return Math.max(0.05, (1 - w.env.seaState * 0.08) * (0.3 + 0.7 * light) * (w.env.rain ? 0.5 : 1));
}

function shipsInFrame(w: World, own: Ship, req: PhotoMsg, eye: number, vis: number): Candidate[] {
  const out: Candidate[] = [];
  for (const s of w.ships) {
    if (s === own || !s.alive) continue;
    // Boats only when surfaced; a periscope head is no picture
    if (CLASSES[s.cls].submarine && s.depth > 3) continue;
    const r = distance(own.pos, s.pos);
    const rec = RECOG[s.cls];
    const seen = s.lights ? Math.max(vis, (1 - w.env.seaState * 0.08) * 0.85) : vis;
    const limit = horizonRange(eye, rec.mast) * seen;
    if (r > limit || r < 20) continue;
    const brg = bearing(own.pos, s.pos);
    const aspect = Math.abs(angleDiff(s.heading, bearing(s.pos, own.pos)));
    const proj = rec.length * Math.abs(Math.sin(aspect * D)) + rec.beam * Math.abs(Math.cos(aspect * D));
    const halfW = Math.atan(proj / 2 / r) / D;
    const off = angleDiff(req.bearing, brg);
    if (Math.abs(off) - halfW > req.fov / 2) continue;
    // Vertically the hull spans from the waterline (below the horizon by the dip) to the mast top
    const lo = -Math.atan(eye / r) / D;
    const hi = Math.atan((rec.mast - eye) / r) / D;
    if (lo > req.pitch + req.vfov / 2 || hi < req.pitch - req.vfov / 2) continue;
    out.push({ id: s.id, cls: s.cls, name: CLASSES[s.cls].name, range: r, limit, off, halfW, aspect });
  }
  return out;
}

function planesInFrame(w: World, own: Ship, req: PhotoMsg, eye: number): Candidate[] {
  const out: Candidate[] = [];
  const light = w.env.light ?? 1;
  for (const p of allPlanes(w)) {
    const r = distance(own.pos, p.pos);
    const spec = PLANE[p.kind];
    const limit = (light > 0.4 ? spec.day : 15_000) * (w.env.rain ? 0.4 : 1);
    if (r > limit || r < 20) continue;
    const off = angleDiff(req.bearing, bearing(own.pos, p.pos));
    const el = Math.atan2(p.alt - eye, r) / D;
    const halfW = Math.atan(spec.span / 2 / Math.hypot(r, p.alt)) / D;
    if (Math.abs(off) - halfW > req.fov / 2 || Math.abs(el - req.pitch) > req.vfov / 2) continue;
    out.push({ id: p.id, plane: p.kind, name: spec.name, range: Math.hypot(r, p.alt), limit, off, halfW, aspect: Math.abs(angleDiff(p.heading, bearing(p.pos, own.pos))) });
  }
  return out;
}

function score(c: Candidate, req: PhotoMsg, vis: number, mastS: number | undefined) {
  const flaws: PhotoRecord['flaws'] = [];
  const half = req.fov / 2;
  const centre = 1 - 0.5 * Math.min(1, Math.abs(c.off) / half) ** 2;
  if (Math.abs(c.off) > half * 0.6) flaws.push('rand');
  const fill = (2 * c.halfW) / req.fov;
  const size = Math.min(1, fill / 0.2);
  if (fill < 0.06) flaws.push('klein');
  const cut = Math.abs(c.off) + c.halfW > half ? 0.7 : 1;
  if (cut < 1) flaws.push('abgeschnitten');
  const aspect = 0.45 + 0.55 * Math.abs(Math.sin(c.aspect * D));
  const sight = Math.max(0.2, Math.min(1, vis)) * (1 - 0.4 * Math.min(1, c.range / c.limit));
  if (vis < 0.6) flaws.push('sicht');
  let mast = 1;
  if (mastS !== undefined && mastS > 20) mast = Math.max(0.5, 1 - (mastS - 20) / 80);
  if (mastS !== undefined && mastS > 30) flaws.push('mast');
  return { value: Math.round(100 * centre * size * cut * aspect * sight * mast), flaws };
}

const QUALITY: [number, PhotoRecord['quality'], string][] = [
  [70, 'gut', 'Gute Aufnahme'], [40, 'brauchbar', 'Brauchbare Aufnahme'], [15, 'schwach', 'Schwache Aufnahme'], [-1, 'unbrauchbar', 'Unbrauchbar'],
];
const FLAW_DE: Record<PhotoRecord['flaws'][number], string> = {
  klein: 'Ziel zu klein', rand: 'am Bildrand', abgeschnitten: 'angeschnitten', sicht: 'schlechte Sicht', mast: 'Mast zu lange oben',
};

const kmDe = (m: number) => `${(m / 1000).toFixed(1).replace('.', ',')} km`;

/**
 * Grade one photo. `prefer` is the target id of the contact the player had selected:
 * if it is in the picture it is the subject, otherwise the best-scoring object is.
 */
export function gradePhoto(
  w: World, own: Ship, req: PhotoMsg, who: { playerId: string; mastSince?: number; prefer?: string },
): PhotoRecord {
  const sub = CLASSES[own.cls].submarine;
  const eye = sub ? 4 : 20;
  const vis = photoVisibility(w);
  const mastS = sub && who.mastSince !== undefined ? Math.max(0, w.time - who.mastSince) : undefined;
  const base = { id: req.id, playerId: who.playerId, shipId: own.id, t: Math.round(w.time), mastS: mastS === undefined ? undefined : Math.round(mastS) };
  const cands = [...shipsInFrame(w, own, req, eye, vis), ...planesInFrame(w, own, req, eye)];
  const rated = cands.map((c) => ({ c, s: score(c, req, vis, mastS) }));
  const best = rated.find((r) => r.c.id === who.prefer) ?? rated.sort((a, b) => b.s.value - a.s.value)[0];
  if (!best) return { ...base, score: 0, quality: 'unbrauchbar', comment: 'Unbrauchbar: kein Ziel im Bild', flaws: [] };
  const { c, s } = best;
  const [, quality, word] = QUALITY.find(([min]) => s.value >= min)!;
  const asp = aspectWord(c.aspect);
  const extra = s.flaws.map((f) => (f === 'mast' ? `Mast ${mastS} s oben` : FLAW_DE[f]));
  const comment = `${word}: ${c.name} ${ASPECT_DE[asp]}, ${kmDe(c.range)}${extra.length ? ` (${extra.join(', ')})` : ''}`;
  return {
    ...base, score: s.value, quality, comment, cls: c.cls, plane: c.plane, targetId: c.id, range: Math.round(c.range), aspect: asp, flaws: s.flaws,
  };
}

/** Handle a photo message: checks, grading, and filing it with the match recording. */
export function takePhoto(m: Match, playerId: string, req: PhotoMsg): string | undefined {
  const w = m.world;
  const ship = m.shipOf(playerId);
  if (!w || !ship?.alive || m.state !== 'running') return 'Keine laufende Partie';
  if (CLASSES[ship.cls].submarine && !mastRaised(ship)) return 'Sehrohr ist nicht ausgefahren';
  const list = (m.recorder.s.photos ??= []);
  if (list.some((p) => p.id === req.id)) return undefined;
  if (list.filter((p) => p.shipId === ship.id).length >= FILM) return `Film voll (${FILM} Aufnahmen)`;
  const prefer = req.label ? w.books.get(ship.id)?.targetIdOf(req.label) : undefined;
  list.push(gradePhoto(w, ship, req, { playerId, mastSince: m.recorder.s.mastSince?.[ship.id], prefer }));
  return undefined;
}
