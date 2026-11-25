import { CLASSES, compartmentLayout, type ClassId, type CompartmentView, type WreckView } from '@tk/shared';

/**
 * Schnittzeichnung: the own ship cut open lengthwise, bow to the right. Each compartment is
 * a cell between bulkheads; water rises in it with a moving surface, fires flicker, wreckage
 * is hatched, closed bulkheads are drawn heavy, the damage-control party is marked. The whole
 * hull tilts with the trim and, for surface ships, settles into the sea.
 */

export interface CutawayState {
  cls: ClassId;
  comps: CompartmentView[];
  wreck?: WreckView;
  /** Where the damage-control party works, and which cell the player has picked. */
  dcAt?: number;
  selected?: number;
  /** Seconds, for the animation. */
  t: number;
}

export interface CutawayGeom {
  /** Left and right x of each cell (canvas px, untilted). */
  cells: { x0: number; x1: number }[];
}

const PAD = 10;

/** One letter per system or special space in a compartment: A drive, S sonar, W weapons, B battery, M magazine, R reactor/engine. */
export function sysTags(spec: { sys: Partial<Record<string, number>>; tag?: string }): string[] {
  const out: string[] = [];
  if ((spec.sys.antrieb ?? 0) >= 0.5) out.push('A');
  if ((spec.sys.sonar ?? 0) >= 0.5) out.push('S');
  if ((spec.sys.waffen ?? 0) >= 0.5) out.push('W');
  if (spec.tag === 'battery') out.push('B');
  if (spec.tag === 'magazine') out.push('M');
  return out;
}

const pics = new Map<ClassId, HTMLImageElement | null>();
/** The class side silhouette as an image (rendered once from the 3D model; undefined until ready). */
function silhouette(cls: ClassId): HTMLImageElement | undefined {
  if (pics.has(cls)) return pics.get(cls) ?? undefined;
  pics.set(cls, null);
  void import('./recog-render.js').then((r) => {
    r.renderRecog([cls]);
    const src = r.recogImage(cls, 'side');
    if (!src) return;
    const img = new Image();
    img.onload = () => pics.set(cls, img);
    img.src = src;
  });
  return undefined;
}

/** Cell edges from the volume shares: bow (index 0) on the right. */
export function cutawayGeom(cls: ClassId, w: number): CutawayGeom {
  const layout = compartmentLayout(cls);
  const x0 = PAD;
  const len = w - 2 * PAD;
  let acc = 0;
  const cells = layout.map((c) => {
    const right = x0 + len * (1 - acc);
    acc += c.vol;
    return { x0: x0 + len * (1 - acc), x1: right };
  });
  return { cells };
}

/** Hull outline in local coordinates (centre of the hull at 0,0; bow to the right). */
function hullPath(ctx: CanvasRenderingContext2D, sub: boolean, L: number, H: number): void {
  const l = -L / 2;
  const r = L / 2;
  ctx.beginPath();
  if (sub) {
    // Teardrop: round bow, tapering stern
    ctx.moveTo(l, 0);
    ctx.bezierCurveTo(l + L * 0.25, -H * 0.55, r - L * 0.2, -H * 0.5, r - L * 0.06, -H * 0.42);
    ctx.quadraticCurveTo(r, -H * 0.25, r, 0);
    ctx.quadraticCurveTo(r, H * 0.25, r - L * 0.06, H * 0.42);
    ctx.bezierCurveTo(r - L * 0.2, H * 0.5, l + L * 0.25, H * 0.55, l, 0);
  } else {
    // Raked bow, transom stern, flat main deck
    ctx.moveTo(l, -H * 0.5);
    ctx.lineTo(r, -H * 0.62);
    ctx.lineTo(r - L * 0.08, H * 0.15);
    ctx.quadraticCurveTo(r - L * 0.14, H * 0.5, r - L * 0.25, H * 0.5);
    ctx.lineTo(l + L * 0.06, H * 0.5);
    ctx.lineTo(l, H * 0.05);
  }
  ctx.closePath();
}

export function drawCutaway(ctx: CanvasRenderingContext2D, w: number, h: number, st: CutawayState): CutawayGeom {
  const sub = CLASSES[st.cls].submarine;
  const layout = compartmentLayout(st.cls);
  const geom = cutawayGeom(st.cls, w);
  const L = w - 2 * PAD;
  const H = Math.min(h * (sub ? 0.55 : 0.4), L * (sub ? 0.16 : 0.2));
  const cy = h * (sub ? 0.52 : 0.62);
  const settle = st.wreck?.settle ?? 0;
  const trim = ((st.wreck?.trim ?? 0) * Math.PI) / 180;
  ctx.clearRect(0, 0, w, h);
  // Sea: deep water for a boat, a waterline for a ship that sinks lower as she settles
  const waterY = sub ? -1 : cy - H * 0.05;
  if (!sub) {
    ctx.fillStyle = 'rgba(20,60,70,0.35)';
    ctx.fillRect(0, waterY, w, h - waterY);
  } else {
    ctx.fillStyle = 'rgba(16,40,48,0.35)';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.save();
  ctx.translate(w / 2, cy + (sub ? 0 : H * 0.3 * settle));
  ctx.rotate(trim);
  // The ship above the deck: the silhouette rendered from her 3D model (recognition pictures), else a simple block
  const pic = silhouette(st.cls);
  if (pic) {
    const ph = (pic.naturalHeight / pic.naturalWidth) * L;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(pic, -L / 2, (sub ? -H * 0.15 : -H * 0.5) - ph * (sub ? 0.75 : 0.98), L, ph);
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = '#16211e';
    ctx.strokeStyle = '#5f7a72';
    ctx.lineWidth = 1;
    if (sub) ctx.fillRect(L * 0.05, -H * 0.95, L * 0.11, H * 0.5);
    else ctx.fillRect(-L * 0.02, -H * 1.05, L * 0.22, H * 0.5);
  }
  hullPath(ctx, sub, L, H);
  ctx.fillStyle = '#0d1614';
  ctx.fill();
  ctx.save();
  ctx.clip();
  const top = -H * 0.65;
  const bot = H * 0.55;
  st.comps.forEach((c, i) => {
    const cell = geom.cells[i];
    if (!cell) return;
    const x0 = cell.x0 - w / 2;
    const x1 = cell.x1 - w / 2;
    if (c.sealed) {
      ctx.fillStyle = 'rgba(80,60,20,0.25)';
      ctx.fillRect(x0, top, x1 - x0, bot - top);
    }
    // Wreckage: hatching
    if (c.dmg > 0.05) {
      ctx.strokeStyle = `rgba(240,149,149,${0.15 + 0.45 * c.dmg})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = x0 - (bot - top); x < x1; x += 7) {
        ctx.moveTo(x, bot);
        ctx.lineTo(x + (bot - top), top);
      }
      ctx.stroke();
    }
    // Water: level with a moving surface; spray at the hole while it leaks
    if (c.flood > 0.005) {
      const lvl = bot - (bot - top) * c.flood;
      ctx.fillStyle = 'rgba(40,120,170,0.75)';
      ctx.beginPath();
      ctx.moveTo(x0, bot);
      for (let x = x0; x <= x1; x += 4) ctx.lineTo(x, lvl + Math.sin(x * 0.25 + st.t * 3 + i) * 1.4 * (c.leak > 0 ? 1.6 : 0.6));
      ctx.lineTo(x1, bot);
      ctx.closePath();
      ctx.fill();
    }
    if (c.leak > 0.02) {
      ctx.strokeStyle = 'rgba(170,220,240,0.8)';
      ctx.lineWidth = 1;
      const xm = (x0 + x1) / 2;
      for (let k = 0; k < 2 + c.leak * 5; k++) {
        const ph = (st.t * 1.6 + k * 0.37) % 1;
        const dx = (k - 2) * 2.2;
        ctx.beginPath();
        ctx.moveTo(xm + dx, bot - 1);
        ctx.lineTo(xm + dx * (1 + ph * 2), bot - 2 - ph * (bot - top) * 0.5 * c.leak);
        ctx.stroke();
      }
    }
    // Fire: flickering tongues from the deck plates, a red glow over the cell
    if (c.fire > 0.02) {
      const g = ctx.createLinearGradient(0, bot, 0, top);
      g.addColorStop(0, `rgba(255,110,30,${0.35 * c.fire})`);
      g.addColorStop(1, 'rgba(255,60,20,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x0, top, x1 - x0, bot - top);
      const n = Math.max(2, Math.round((x1 - x0) / 9));
      for (let k = 0; k < n; k++) {
        const fx = x0 + ((k + 0.5) / n) * (x1 - x0);
        const fl = (0.55 + 0.45 * Math.sin(st.t * (9 + k) + k * 2.1) * Math.sin(st.t * 4.3 + k)) * c.fire;
        const fh = (bot - top) * (0.25 + 0.55 * fl);
        const base = c.flood > 0 ? bot - (bot - top) * c.flood : bot;
        ctx.fillStyle = `rgba(255,${150 + Math.round(80 * fl)},60,${0.5 + 0.4 * fl})`;
        ctx.beginPath();
        ctx.moveTo(fx - 4, base);
        ctx.quadraticCurveTo(fx - 3, base - fh * 0.6, fx + Math.sin(st.t * 7 + k) * 2, base - fh);
        ctx.quadraticCurveTo(fx + 3, base - fh * 0.6, fx + 4, base);
        ctx.closePath();
        ctx.fill();
      }
    }
  });
  // Decks and frames: the ship's structure through the cut
  ctx.strokeStyle = 'rgba(159,225,203,0.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const f of sub ? [-0.15, 0.2] : [-0.2, 0.15]) {
    ctx.moveTo(-L / 2, H * f);
    ctx.lineTo(L / 2, H * f);
  }
  for (let x = -L / 2; x < L / 2; x += 6) {
    ctx.moveTo(x, bot - 3);
    ctx.lineTo(x, bot);
  }
  ctx.stroke();
  ctx.restore();
  // Bulkheads between cells: thin when open, heavy amber when closed (either neighbour sealed)
  for (let i = 0; i + 1 < geom.cells.length; i++) {
    const x = geom.cells[i]!.x0 - w / 2;
    const shut = st.comps[i]?.sealed || st.comps[i + 1]?.sealed;
    ctx.strokeStyle = shut ? '#fac775' : 'rgba(159,225,203,0.45)';
    ctx.lineWidth = shut ? 3 : 1;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bot);
    ctx.stroke();
  }
  hullPath(ctx, sub, L, H);
  ctx.strokeStyle = '#9fe1cb';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Labels, party marker, selection
  ctx.font = '9px ui-monospace, monospace';
  ctx.textAlign = 'center';
  st.comps.forEach((c, i) => {
    // (labels are translated before they are shortened to fit the cell)
    const cell = geom.cells[i];
    if (!cell) return;
    const xm = (cell.x0 + cell.x1) / 2 - w / 2;
    const cw = cell.x1 - cell.x0;
    // Compartment number in a badge (the names are in the table below), water level, systems inside
    const warn = c.sealed ? '#fac775' : c.fire > 0.02 ? '#ff9a5a' : c.flood > 0.3 ? '#7fc4ff' : '#9fe1cb';
    ctx.fillStyle = 'rgba(5,12,10,0.75)';
    ctx.beginPath(); ctx.arc(xm, top + 9, 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = warn;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = warn;
    ctx.font = 'bold 9px ui-monospace, monospace';
    ctx.fillText(String(i + 1), xm, top + 12);
    ctx.font = '9px ui-monospace, monospace';
    if (c.flood > 0.02) {
      ctx.fillStyle = '#cfeaff';
      ctx.fillText(`${Math.round(c.flood * 100)}%`, xm, H * 0.05);
    }
    const tags = sysTags(layout[i]!);
    if (cw > tags.length * 9) {
      tags.forEach((tg, k) => {
        const x = xm + (k - (tags.length - 1) / 2) * 9;
        ctx.fillStyle = c.dmg > 0.6 || c.sealed ? '#f09595' : c.dmg > 0.25 ? '#fac775' : 'rgba(159,225,203,0.75)';
        ctx.fillText(tg, x, bot - 6);
      });
    }
    if (i === st.selected) {
      ctx.strokeStyle = '#ffffff';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.strokeRect(cell.x0 - w / 2 + 1.5, top + 1.5, cw - 3, bot - top - 3);
      ctx.setLineDash([]);
    }
    if (i === st.dcAt) {
      ctx.fillStyle = '#5dcaa5';
      ctx.beginPath();
      ctx.moveTo(xm - 5, -H * 0.85 - 8);
      ctx.lineTo(xm + 5, -H * 0.85 - 8);
      ctx.lineTo(xm, -H * 0.85);
      ctx.closePath();
      ctx.fill();
    }
  });
  ctx.restore();
  // Waterline drawn over the hull: the part below it is under water
  if (!sub) {
    ctx.strokeStyle = 'rgba(93,202,165,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 6) ctx.lineTo(x, waterY + Math.sin(x * 0.08 + st.t * 1.5) * 1.2);
    ctx.stroke();
  }
  return geom;
}

/** Which cell a click at x (canvas px) falls in. */
export function cellAt(geom: CutawayGeom, x: number): number | undefined {
  const i = geom.cells.findIndex((c) => x >= c.x0 && x < c.x1);
  return i < 0 ? undefined : i;
}
