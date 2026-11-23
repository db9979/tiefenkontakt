import { CLASSES, type Debrief, type PhotoRecord } from '@tk/shared';
import { net } from '../net.js';
import { esc } from './format.js';
import { lang } from '../i18n/index.js';

/**
 * Periscope and bridge photos. The picture (a small JPEG of the 3D view and its reticle) stays
 * in this browser for the match; the server is told only where the camera looked and grades
 * the photo from the truth. The debrief shows the strip with the grades.
 */

const KEY = 'tk_photos';
const KEEP = 48;
interface Stored { id: string; url: string; at: number }

function load(): Stored[] {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as Stored[];
  } catch {
    return [];
  }
}
let roll: Stored[] = load();
/** Photos taken in this match (for the counter on the button). */
let taken = 0;

function save(): void {
  roll = roll.slice(-KEEP);
  try {
    sessionStorage.setItem(KEY, JSON.stringify(roll));
  } catch {
    roll = roll.slice(-KEEP / 2);
  }
}

export interface PhotoView {
  /** Layers bottom to top: the WebGL canvas, then the 2D overlay; may be hidden (skipped). */
  layers: HTMLCanvasElement[];
  /** Crop in CSS pixels of the layers. */
  crop: { x: number; y: number; w: number; h: number };
  bearing: number;
  fov: number;
  vfov: number;
  pitch: number;
  label?: string;
}

/** Capture now (call right after rendering, in the same frame) and send the metadata. */
export function snapPhoto(v: PhotoView): string {
  const out = document.createElement('canvas');
  out.className = 'keep'; // a photo, not a display: no light-mode ink
  out.width = 240;
  out.height = Math.max(60, Math.round((240 * v.crop.h) / v.crop.w));
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#030504';
  ctx.fillRect(0, 0, out.width, out.height);
  for (const c of v.layers) {
    if (c.style.visibility === 'hidden' || !c.width) continue;
    const k = c.width / (c.clientWidth || c.width);
    ctx.drawImage(c, v.crop.x * k, v.crop.y * k, v.crop.w * k, v.crop.h * k, 0, 0, out.width, out.height);
  }
  const id = `ph-${Date.now().toString(36)}-${Math.floor(Math.random() * 1296).toString(36)}`.slice(0, 24);
  roll.push({ id, url: out.toDataURL('image/jpeg', 0.72), at: Date.now() });
  save();
  taken++;
  net.send({ t: 'photo', id, bearing: ((v.bearing % 360) + 360) % 360, fov: v.fov, vfov: v.vfov, pitch: Math.max(-30, Math.min(90, v.pitch)), label: v.label });
  return id;
}

export function photosTaken(): number {
  return taken;
}

/** New match: restart the counter (old pictures stay for a debrief still open). */
export function resetPhotoCounter(): void {
  taken = 0;
}

export function photoUrl(id: string): string | undefined {
  // Another tab of this session may have stored it (sessionStorage is the source of truth)
  return (roll.find((p) => p.id === id) ?? load().find((p) => p.id === id))?.url;
}

/** A white flash over a canvas area: the shutter. */
export function shutterFlash(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, ageMs: number): void {
  if (ageMs > 220) return;
  ctx.fillStyle = `rgba(235,245,240,${0.55 * (1 - ageMs / 220)})`;
  ctx.fillRect(x, y, w, h);
}

const L = (de: string, en: string) => (lang === 'en' ? en : de);
const Q_EN = { gut: 'Good photo', brauchbar: 'Usable photo', schwach: 'Weak photo', unbrauchbar: 'Useless' } as const;
const ASP_EN = { bug: 'bow on', bugschraeg: 'bow quarter', querab: 'beam on', heckschraeg: 'stern quarter', heck: 'stern on' } as const;
const PLANE_EN = { airliner: 'airliner', light: 'light aircraft', recon: 'long-range recon aircraft', mpa: 'maritime patrol aircraft', helo: 'helicopter' } as const;
const FLAW_EN = { klein: 'target too small', rand: 'at the edge', abgeschnitten: 'cut off', sicht: 'poor visibility', mast: 'mast up too long' } as const;

function commentEn(p: PhotoRecord, name: string): string {
  if (!p.targetId) return 'Useless: nothing in the picture';
  const flaws = p.flaws.map((f) => FLAW_EN[f]);
  return `${Q_EN[p.quality]}: ${name} ${p.aspect ? ASP_EN[p.aspect] : ''}, ${((p.range ?? 0) / 1000).toFixed(1)} km${flaws.length ? ` (${flaws.join(', ')})` : ''}`;
}

/** Debrief: the own photos as a strip of thumbnails with grade and comment. */
export function photoStrip(d: Debrief, playerId: string | undefined): string {
  const mine = (d.photos ?? []).filter((p) => p.playerId === playerId);
  if (!mine.length) return '';
  const col = { gut: 'var(--g)', brauchbar: 'var(--amber)', schwach: 'var(--amber)', unbrauchbar: 'var(--red)' } as const;
  const avg = Math.round(mine.reduce((a, p) => a + p.score, 0) / mine.length);
  const cells = mine.map((p) => {
    const url = photoUrl(p.id);
    const name = p.plane ? PLANE_EN[p.plane] : p.cls ? CLASSES[p.cls].name : '';
    const text = lang === 'en' ? commentEn(p, name) : p.comment;
    return `<div style="flex:0 0 132px;border:1px solid var(--line);padding:3px" title="${esc(text)}" data-noi18n>
      ${url ? `<img src="${url}" alt="" style="width:124px;display:block">` : `<div class="dim" style="height:70px;display:flex;align-items:center;justify-content:center">${L('KEIN BILD', 'NO IMAGE')}</div>`}
      <div style="display:flex;justify-content:space-between;margin-top:2px"><span style="color:${col[p.quality]}">${p.score}</span><span class="dim">${Math.floor(p.t / 60)}:${String(p.t % 60).padStart(2, '0')}</span></div>
      <div style="font-size:0.8333rem;line-height:1.3">${esc(text)}</div></div>`;
  });
  return `<div class="hd" style="margin-top:8px"><span>${L('Sehrohrfotos', 'Periscope photos')}</span><span class="dim">${mine.length} · ${L('SCHNITT', 'AVERAGE')} ${avg}</span></div>
    <div style="display:flex;gap:6px;overflow-x:auto;padding:4px 0">${cells.join('')}</div>`;
}
