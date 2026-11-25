import { RECOG, lofarBars, recogDraught, type AcousticSheet, type ClassId } from '@tk/shared';
import type { RecogMeta, RecogPart } from './recog-render.js';
import { BOW_ZOOM, gridLines, scaleCat, scaleFrame, type ScaleFrame } from './recog-scale.js';

/**
 * SVG drawings for the recognition book: side, bow and top view of a class at the common scale
 * of its category (height grid, waterline, mast height, draught, length), and the narrowband
 * line chart of the acoustic page. Pictures come from recog-render.ts; without them the frame
 * and measurements are drawn alone.
 */

export interface Pics {
  image(cls: ClassId, part: RecogPart): string | undefined;
  meta(cls: ClassId): RecogMeta | undefined;
}

const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString('de-DE');
const st = (s: string) => `style="${s}"`;

/** A picture part placed in metres; side views put the stern at x = 0. */
function placed(pics: Pics, cls: ClassId, part: RecogPart, extra = ''): string {
  const src = pics.image(cls, part);
  const m = pics.meta(cls);
  if (!src || !m) return '';
  const p = m.pad;
  const len = m.maxZ - m.minZ + 2 * p;
  const beam = m.maxX - m.minX + 2 * p;
  const [x, y, w, h] =
    part === 'side' ? [-p, -(m.maxY + p), len, m.maxY + p]
    : part === 'sideU' ? [-p, 0, len, -m.minY + p]
    : part === 'bow' ? [m.minX - p, -(m.maxY + p), beam, m.maxY + p]
    : part === 'bowU' ? [m.minX - p, 0, beam, -m.minY + p]
    : [-p, -(m.maxX + p), len, beam];
  return `<image href="${src}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none" ${extra}/>`;
}

/** Horizontal grid lines with height labels on the left. */
function grid(f: ScaleFrame, x0: number, x1: number, labels: boolean): string {
  const sw = f.font * 0.06;
  return gridLines(f).map((y) => {
    const wl = y === 0;
    const line = `<line x1="${x0}" x2="${x1}" y1="${-y}" y2="${-y}" ${st(`stroke:${wl ? 'var(--blue)' : 'var(--line2)'};stroke-width:${wl ? sw * 2.2 : sw}${wl ? '' : `;stroke-dasharray:${f.font * 0.4} ${f.font * 0.3}`}`)}/>`;
    const lab = labels ? `<text x="${x0 - f.font * 0.3}" y="${-y + f.font * 0.35}" text-anchor="end" ${st(`fill:${wl ? 'var(--blue)' : 'var(--dim)'};font-size:${f.font}px`)}>${wl ? 'WL' : `${y} m`}</text>` : '';
    return line + lab;
  }).join('');
}

/** Side view at the category scale: grid, waterline, hull above and (faint) below, mast, draught, length. */
export function sideSvg(pics: Pics, cls: ClassId, ghost?: ClassId): string {
  const f = scaleFrame(scaleCat(cls));
  const r = RECOG[cls];
  const m = pics.meta(cls);
  const len = m ? m.maxZ - m.minZ : r.length;
  const draught = recogDraught(cls);
  const fs = f.font;
  const sw = fs * 0.08;
  const gx = f.x0 + fs * 3.4;
  const W = f.x1 - f.x0;
  const H = f.yTop - f.yBot;
  const amber = `stroke:var(--amber);stroke-width:${sw}`;
  const label = (x: number, y: number, s: string, anchor = 'start', color = 'var(--g2)') =>
    `<text x="${x}" y="${y}" text-anchor="${anchor}" ${st(`fill:${color};font-size:${fs}px`)}>${s}</text>`;
  // Length dimension just below the deepest point of this hull
  const dimY = Math.max(draught, m ? -m.minY : 0) + fs * 1.3;
  const tick = (x: number) => `<line x1="${x}" x2="${x}" y1="${dimY - fs * 0.45}" y2="${dimY + fs * 0.45}" ${st(`stroke:var(--g);stroke-width:${sw}`)}/>`;
  const ghostSvg = ghost && ghost !== cls && scaleCat(ghost) === scaleCat(cls)
    ? `<g ${st('opacity:0.85')}>${placed(pics, ghost, 'side', 'filter="url(#rb-ghostf)"')}</g>` : '';
  // Ghost: the reference class as an amber outline with a faint fill, over the current hull
  const ghostFilter = `<filter id="rb-ghostf" x="-5%" y="-5%" width="110%" height="110%">
      <feColorMatrix type="matrix" values="0 0 0 0 0.98  0 0 0 0 0.78  0 0 0 0 0.46  0 0 0 1 0" result="c"/>
      <feMorphology in="c" operator="dilate" radius="${fs * 0.1}" result="d"/>
      <feComposite in="d" in2="c" operator="out" result="o"/>
      <feComponentTransfer in="c" result="f"><feFuncA type="linear" slope="0.18"/></feComponentTransfer>
      <feMerge><feMergeNode in="f"/><feMergeNode in="o"/></feMerge></filter>`;
  return `<svg class="rb-svg" viewBox="${f.x0} ${-f.yTop} ${W} ${H}" preserveAspectRatio="xMinYMin meet" ${st('width:100%;display:block')}>
    <defs>${ghostFilter}</defs>
    ${grid(f, gx, f.x1, true)}
    <g ${st('opacity:0.33')}>${placed(pics, cls, 'sideU')}</g>
    ${placed(pics, cls, 'side')}
    ${ghostSvg}
    <line x1="0" x2="${len}" y1="${-r.mast}" y2="${-r.mast}" ${st(`${amber};stroke-dasharray:${fs * 0.5} ${fs * 0.3}`)}/>
    ${label(len + fs * 0.3, -r.mast + fs * 0.35, `Mast ${n1(r.mast)} m`, 'start', 'var(--amber)')}
    ${draught > 0 ? `<line x1="${len + fs * 0.6}" x2="${len + fs * 0.6}" y1="0" y2="${draught}" ${st(`stroke:var(--blue);stroke-width:${sw * 1.5}`)}/>
      ${label(len + fs * 1, draught / 2 + fs * 0.35, `Tg ${n1(draught)} m`, 'start', 'var(--blue)')}` : ''}
    <line x1="0" x2="${len}" y1="${dimY}" y2="${dimY}" ${st(`stroke:var(--g);stroke-width:${sw}`)}/>${tick(0)}${tick(len)}
    ${label(len / 2, dimY - fs * 0.25, `${n1(r.length)} m`, 'middle')}
  </svg>`;
}

/** Bow view, BOW_ZOOM times the side scale, centred; give it bowWidthShare() of the side view's width. */
export function bowSvg(pics: Pics, cls: ClassId): string {
  const f = scaleFrame(scaleCat(cls));
  const r = RECOG[cls];
  const fs = f.font;
  const hw = f.bowHalf;
  const yBot = -Math.ceil(recogDraught(cls) / f.grid) * f.grid - fs * 0.4;
  const sw = fs * 0.08;
  return `<svg class="rb-svg" viewBox="${-hw} ${-f.yTop} ${2 * hw} ${f.yTop - yBot}" ${st('width:100%;display:block')}>
    ${grid({ ...f, yBot }, -hw, hw, false)}
    <g ${st('opacity:0.33')}>${placed(pics, cls, 'bowU')}</g>
    ${placed(pics, cls, 'bow')}
    <line x1="${-r.beam / 2}" x2="${r.beam / 2}" y1="${-f.yTop + fs * 1.1}" y2="${-f.yTop + fs * 1.1}" ${st(`stroke:var(--g);stroke-width:${sw}`)}/>
    <text x="0" y="${-f.yTop + fs * 0.85}" text-anchor="middle" ${st(`fill:var(--g2);font-size:${fs / BOW_ZOOM}px`)}>${n1(r.beam)} m</text>
  </svg>`;
}

/** Top view at the side scale, bow to the right. */
export function topSvg(pics: Pics, cls: ClassId): string {
  const f = scaleFrame(scaleCat(cls));
  const m = pics.meta(cls);
  const len = m ? m.maxZ - m.minZ : RECOG[cls].length;
  const fs = f.font;
  return `<svg class="rb-svg" viewBox="${f.x0} ${-f.topHalf} ${f.x1 - f.x0} ${2 * f.topHalf}" ${st('width:100%;display:block')}>
    <line x1="${f.x0 + fs * 3.4}" x2="${f.x1}" y1="0" y2="0" ${st(`stroke:var(--line2);stroke-width:${fs * 0.06};stroke-dasharray:${fs * 0.4} ${fs * 0.3}`)}/>
    ${placed(pics, cls, 'top')}
    <text x="${len + fs * 0.4}" y="${fs * 0.35}" ${st(`fill:var(--g2);font-size:${fs}px`)}>B ${n1(RECOG[cls].beam)} m</text>
  </svg>`;
}

/** Narrowband lines 0–500 Hz as bars (height from the line's strength); snorkel lines in amber. HTML, so labels keep their size. */
export function lofarChart(sheet: AcousticSheet): string {
  const axis = [0, 100, 200, 300, 400, 500].map((hz) => `<div style="position:absolute;left:${hz / 5}%;bottom:1px;transform:translateX(${hz === 0 ? 0 : hz === 500 ? -100 : -50}%);font-size:0.75rem;color:var(--dim)">${hz}</div>`).join('');
  const bars = lofarBars(sheet).map((b) => `<div title="${n1(b.hz)} Hz" style="position:absolute;left:calc(${(b.x * 100).toFixed(2)}% - 1.5px);bottom:16px;width:3px;height:${(b.h * 62).toFixed(0)}px;background:${b.snorkel ? 'var(--amber)' : 'var(--g)'}"></div>`).join('');
  return `<div style="position:relative;height:84px;background:var(--well);border:1px solid var(--line);padding:0 8px;margin-top:2px">
    <div style="position:relative;height:100%">
      <div style="position:absolute;left:0;right:0;bottom:16px;border-top:1px solid var(--line2)"></div>${bars}${axis}
    </div>
  </div>`;
}
