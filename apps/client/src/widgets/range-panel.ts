import { predictRanges, predictionSummary, type RangePrediction, type Snapshot } from '@tk/shared';
import { COL, fitCanvas, FONT, h, setText } from './format.js';

/**
 * Listening-range prediction ("Reichweitenvorhersage"): a range × depth section from the
 * shared acoustics model. Green = we hear the reference target there, red hatching = an
 * enemy sonar hears us. For boats the y axis is the own depth (where could we be), for
 * surface ships the boat's depth. Recomputed every few seconds (cached by inputs).
 */

const HEIGHT = 200;
const RECOMPUTE_S = 3;
const OPEN_KEY = 'tk.rangePanel';

export function rangePanel(): { el: HTMLElement; update(s: Snapshot): void } {
  const open = localStorage.getItem(OPEN_KEY) !== '0';
  const el = h(`<div class="panel"><details class="filters" ${open ? 'open' : ''}><summary>REICHWEITENVORHERSAGE <span id="rp-cond" class="dim"></span></summary>
    <canvas id="rp-cv" style="cursor:crosshair"></canvas>
    <div id="rp-sum" class="amber" style="margin-top:4px"></div>
    <div class="row"><span id="rp-note" class="dim"></span><span id="rp-hover" class="dim"></span></div></details></div>`);
  const details = el.querySelector('details')!;
  const cv = el.querySelector<HTMLCanvasElement>('#rp-cv')!;
  let pred: RangePrediction | undefined;
  let ownDepth = 0;
  let last = -Infinity;
  details.addEventListener('toggle', () => {
    localStorage.setItem(OPEN_KEY, details.open ? '1' : '0');
    if (details.open && pred) draw(cv, pred, ownDepth);
  });
  cv.addEventListener('mousemove', (e) => {
    if (!pred) return;
    const g = geom(cv);
    const i = Math.floor(((e.offsetX - g.l) / g.w) * pred.ranges.length);
    const j = Math.round(((e.offsetY - g.t) / g.h) * (pred.depths.length - 1));
    if (i < 0 || j < 0 || i >= pred.ranges.length || j >= pred.depths.length) return setText(el.querySelector('#rp-hover')!, '');
    const n = j * pred.ranges.length + i;
    const db = (v: number) => (Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(0)} DB` : '—');
    setText(el.querySelector('#rp-hover')!, `${(pred.ranges[i]! / 1000).toFixed(1)} KM · ${pred.depths[j]!.toFixed(0)} M · HÖREN ${db(pred.hear[0][n]!)} · GEHÖRT ${db(pred.heard[n]!)}`);
  });
  return {
    el,
    update(s) {
      const o = s.own;
      if (!details.open || s.time - last < RECOMPUTE_S) return;
      last = s.time;
      ownDepth = o.depth;
      pred = predictRanges({
        ownCls: o.cls, ownTeam: o.team === 'east' ? 'east' : 'west', ownDepth: o.depth, ownSpeedKn: o.speedKn,
        towedLength: o.towedLength, vdsDepth: o.vdsDepth, seaState: s.env.seaState, rain: s.env.rain,
        layerDepth: s.env.layerDepth, bottom: s.env.bottom, seabedKind: s.env.seabed?.kind,
      });
      setText(el.querySelector('#rp-cond')!, `· ${Math.round(o.speedKn)} KN · SEEGANG ${s.env.seaState}`);
      setText(el.querySelector('#rp-sum')!, predictionSummary(pred));
      // Plain words: what each colour means and what the axes are
      const ref = pred.refs.map((r, k) => `${k ? 'BLASSGRÜN' : 'GRÜN'}: HIER HÖREN WIR ${r.name}`).join(' · ');
      setText(el.querySelector('#rp-note')!, (pred.layerKnown ? '' : 'SCHICHT UNBEKANNT · NUR GROBE SCHÄTZUNG · ') +
        `${ref} · ROT: HIER HÖRT ${pred.enemy.name} UNS · ${pred.axis === 'own' ? 'SENKRECHT: EIGENE TIEFE' : 'SENKRECHT: TIEFE DES U-BOOTS'} · WAAGERECHT: ENTFERNUNG`);
      draw(cv, pred, ownDepth);
    },
  };
}

function geom(cv: HTMLCanvasElement): { l: number; t: number; w: number; h: number } {
  const l = 34, t = 6;
  return { l, t, w: (cv.clientWidth || 600) - l - 8, h: HEIGHT - t - 18 };
}

function draw(cv: HTMLCanvasElement, p: RangePrediction, ownDepth: number): void {
  const ctx = fitCanvas(cv, HEIGHT);
  const W = cv.clientWidth || 600;
  const g = geom(cv);
  const cols = p.ranges.length, rows = p.depths.length;
  const cw = g.w / cols, ch = g.h / (rows - 1);
  const x = (r: number) => g.l + (r / p.maxRange) * g.w;
  const y = (d: number) => g.t + (d / p.maxDepth) * g.h;
  ctx.fillStyle = COL.bg;
  ctx.fillRect(0, 0, W, HEIGHT);
  // We hear them: main reference strong green by signal excess, second reference faint
  // Cell edges on whole pixels: overlapping translucent cells would show seams
  const cx = (i: number) => Math.round(g.l + i * cw);
  const cy = (j: number) => Math.round(g.t + Math.max(0, j - 0.5) * ch);
  const cell = (i: number, j: number): [number, number, number, number] =>
    [cx(i), cy(j), cx(i + 1) - cx(i), (j === rows - 1 ? Math.round(g.t + g.h) : cy(j + 1)) - cy(j)];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const n = j * cols + i;
      const se = p.hear[0][n]!;
      if (se > 0) ctx.fillStyle = `rgba(93,202,165,${(0.25 + 0.45 * Math.min(1, se / 20)).toFixed(2)})`;
      else if (p.hear[1] && p.hear[1][n]! > 0) ctx.fillStyle = 'rgba(93,202,165,0.1)';
      else continue;
      ctx.fillRect(...cell(i, j));
    }
  }
  // They hear us: red hatching clipped to the cells
  ctx.save();
  ctx.beginPath();
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) if (p.heard[j * cols + i]! > 0) ctx.rect(...cell(i, j));
  }
  ctx.clip();
  ctx.strokeStyle = 'rgba(240,149,149,0.75)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = -g.h; k < g.w; k += 6) {
    ctx.moveTo(g.l + k, g.t + g.h);
    ctx.lineTo(g.l + k + g.h, g.t);
  }
  ctx.stroke();
  ctx.restore();
  // Frame, range and depth scale
  ctx.strokeStyle = '#2c3a36';
  ctx.strokeRect(g.l + 0.5, g.t + 0.5, g.w, g.h);
  ctx.font = FONT.tick;
  ctx.fillStyle = COL.dim;
  ctx.textAlign = 'center';
  const stepKm = p.maxRange > 40_000 ? 10 : 5;
  for (let km = 0; km * 1000 <= p.maxRange; km += stepKm) {
    ctx.fillRect(x(km * 1000), g.t + g.h, 1, 3);
    ctx.fillText(km ? `${km}` : '0 KM', x(km * 1000) + (km ? 0 : 10), HEIGHT - 4);
  }
  ctx.textAlign = 'right';
  const stepM = p.maxDepth > 200 ? 100 : 50;
  for (let d = 0; d <= p.maxDepth; d += stepM) ctx.fillText(`${d}`, g.l - 4, y(d) + 4);
  // Axis title: the depth of the boat in the picture, in metres
  ctx.textAlign = 'left';
  ctx.fillText('M', 2, g.t + 4);
  // Layer
  if (p.layerKnown && (p.layerDepth ?? 0) > 0 && p.layerDepth! < p.maxDepth) {
    ctx.strokeStyle = COL.amber;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(g.l, y(p.layerDepth!));
    ctx.lineTo(g.l + g.w, y(p.layerDepth!));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COL.amber;
    ctx.textAlign = 'right';
    ctx.fillText(`SCHICHT ${p.layerDepth} M`, g.l + g.w - 4, y(p.layerDepth!) - 3);
  }
  // Seabed when it is inside the section
  if (p.bottom - 5 <= p.maxDepth + 1) {
    ctx.fillStyle = 'rgba(120,100,70,0.6)';
    ctx.fillRect(g.l, g.t + g.h - 2, g.w, 2);
    ctx.fillStyle = COL.dim;
    ctx.textAlign = 'right';
    ctx.fillText(`GRUND ${Math.round(p.bottom)} M`, g.l + g.w - 4, g.t + g.h - 5);
  } else {
    // The section ends at the deepest the boat can go; say so, and where the bottom really is
    ctx.fillStyle = COL.dim;
    ctx.textAlign = 'right';
    ctx.fillText(`TAUCHGRENZE ${p.axis === 'own' ? 'EIGENES BOOT' : 'U-BOOT'} · GRUND ${Math.round(p.bottom)} M`, g.l + g.w - 4, g.t + g.h - 5);
  }
  // Own depth marker (boats: the row we are on; ships: own hull at the surface)
  ctx.fillStyle = COL.g2;
  ctx.strokeStyle = COL.g2;
  const oy = p.axis === 'own' ? y(Math.min(ownDepth, p.maxDepth)) : g.t + 1;
  ctx.beginPath();
  ctx.moveTo(g.l - 1, oy);
  ctx.lineTo(g.l - 8, oy - 4);
  ctx.lineTo(g.l - 8, oy + 4);
  ctx.fill();
  if (p.axis === 'own') {
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(g.l, oy);
    ctx.lineTo(g.l + g.w, oy);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.textAlign = 'left';
  ctx.fillText(p.axis === 'own' ? `EIGENE TIEFE ${Math.round(ownDepth)} M` : 'EIGENES SCHIFF', g.l + 4, Math.max(g.t + 10, oy - 3));
}
