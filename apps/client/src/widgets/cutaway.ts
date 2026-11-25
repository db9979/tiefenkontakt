import { CLASSES, compartmentLayout, type ClassId, type CompartmentView, type WreckView } from '@tk/shared';
import type { RecogMeta } from './recog-render.js';
import { FONT } from './format.js';

/**
 * Schnittzeichnung for damage control: the own ship as rendered from her 3D model (above and
 * below the waterline), cut lengthwise into her compartments. The compartments are painted only
 * inside the real hull outline, keel to deck: water rises from the keel, fires glow and flicker,
 * wreckage is hatched, sealed compartments are tinted amber behind heavy bulkheads, the picked
 * one is outlined, the damage-control party is marked. The ship trims and settles with her state.
 */

export interface CutawayState {
  cls: ClassId;
  comps: CompartmentView[];
  wreck?: WreckView;
  /** Where the damage-control party works, and which compartment the player has picked. */
  dcAt?: number;
  selected?: number;
  /** Seconds, for the animation. */
  t: number;
}

export interface CutawayGeom {
  /** Left and right x of each compartment (canvas px, untrimmed). */
  cells: { x0: number; x1: number }[];
}

const PAD_X = 8;
/** Room for the compartment numbers above the picture (px). */
const TOP = 18;

/** One letter per system or special space in a compartment: A drive, S sonar, W weapons, B battery, M magazine. */
export function sysTags(spec: { sys: Partial<Record<string, number>>; tag?: string }): string[] {
  const out: string[] = [];
  if ((spec.sys.antrieb ?? 0) >= 0.5) out.push('A');
  if ((spec.sys.sonar ?? 0) >= 0.5) out.push('S');
  if ((spec.sys.waffen ?? 0) >= 0.5) out.push('W');
  if (spec.tag === 'battery') out.push('B');
  if (spec.tag === 'magazine') out.push('M');
  return out;
}

interface Pictures { above: HTMLImageElement; below?: HTMLImageElement; meta: RecogMeta }
const pics = new Map<ClassId, Pictures | null>();

/** The class pictures (rendered once from the 3D model); undefined until they are loaded. */
function picturesOf(cls: ClassId): Pictures | undefined {
  if (pics.has(cls)) return pics.get(cls) ?? undefined;
  pics.set(cls, null);
  void import('./recog-render.js').then((r) => {
    r.renderRecog([cls]);
    const meta = r.recogMeta(cls);
    const a = r.recogImage(cls, 'side');
    if (!meta || !a) return;
    const load = (src: string) => new Promise<HTMLImageElement>((ok) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.src = src;
    });
    const b = r.recogImage(cls, 'sideU');
    void Promise.all([load(a), b ? load(b) : Promise.resolve(undefined)]).then(([above, below]) => pics.set(cls, { above, below, meta }));
  });
  return undefined;
}

/** Where the compartments sit along the hull: x from the volume shares, bow (index 0) on the right. */
function cellsOf(cls: ClassId, x0: number, len: number): CutawayGeom {
  let acc = 0;
  return {
    cells: compartmentLayout(cls).map((c) => {
      const right = x0 + len * (1 - acc);
      acc += c.vol;
      return { x0: x0 + len * (1 - acc), x1: right };
    }),
  };
}

const smooth = { cls: '' as string, t: 0, trim: 0, settle: 0 };
const scratch = document.createElement('canvas');
const mask = document.createElement('canvas');

/** Light theme: the drawing on paper, darker inks. */
const light = () => document.documentElement.dataset.theme === 'light';

/** Palettes for the dark console and the light (paper) theme. */
const PAL = {
  dark: {
    bg: '#06100e', sea: 'rgba(24,70,86,0.45)', shipAlpha: 0.5, shipFilter: 'none', ok: 'rgba(93,202,165,0.2)', sealed: 'rgba(250,199,117,0.32)',
    hurt: 'rgba(240,149,149,0.3)', hatch: '240,149,149', water: 'rgba(70,150,215,0.88)', wall: 'rgba(200,235,225,0.85)', shut: '#fac775',
    wl: 'rgba(133,183,235,0.85)', tick: 'rgba(159,225,203,0.25)', sel: '#ffffff', party: '#5dcaa5', text: '#5f7a72',
    c: { sealed: '#fac775', fire: '#ff9a5a', flood: '#7fc4ff', bad: '#f09595', warn: '#fac775', ok: '#9fe1cb' },
  },
  light: {
    bg: '#eef3f1', sea: 'rgba(90,150,185,0.25)', shipAlpha: 0.8, shipFilter: 'brightness(0.62) contrast(1.15)', ok: 'rgba(27,116,88,0.18)', sealed: 'rgba(196,134,30,0.35)',
    hurt: 'rgba(190,60,60,0.28)', hatch: '170,40,40', water: 'rgba(30,110,190,0.85)', wall: 'rgba(20,50,44,0.8)', shut: '#b5770f',
    wl: 'rgba(30,100,170,0.85)', tick: 'rgba(20,60,50,0.3)', sel: '#111111', party: '#1b7458', text: '#4a6159',
    c: { sealed: '#a8690a', fire: '#c8500f', flood: '#1f6fb5', bad: '#b83a3a', warn: '#a8690a', ok: '#1b7458' },
  },
};
const pal = () => (light() ? PAL.light : PAL.dark);

/** Background of the cutaway canvas for the current theme. */
export const cutawayBg = () => pal().bg;

/** Colour of a compartment's state (numbers, list rows), for the current theme. */
export function compColour(c: CompartmentView): string {
  const k = pal().c;
  if (c.sealed) return k.sealed;
  if (c.fire > 0.02) return k.fire;
  if (c.flood > 0.3) return k.flood;
  if (c.dmg > 0.5 || c.leak > 0.3) return k.bad;
  if (c.flood > 0.01 || c.leak > 0.01 || c.dmg > 0.05) return k.warn;
  return k.ok;
}

export function drawCutaway(ctx: CanvasRenderingContext2D, w: number, h: number, st: CutawayState): CutawayGeom {
  ctx.clearRect(0, 0, w, h);
  const P = pal();
  const p = picturesOf(st.cls);
  if (!p) {
    ctx.fillStyle = P.text;
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SCHNITTZEICHNUNG WIRD AUFGEBAUT …', w / 2, h / 2);
    return cellsOf(st.cls, PAD_X, w - 2 * PAD_X);
  }
  const m = p.meta;
  const sub = CLASSES[st.cls].submarine;
  // Trim and settling ease towards the reported values (snapshots step them in jumps)
  const ease = Math.min(1, Math.max(0, st.t - smooth.t) * 1.5);
  smooth.t = st.t;
  if (smooth.cls !== st.cls) Object.assign(smooth, { cls: st.cls, trim: 0, settle: 0 });
  smooth.trim += ((st.wreck?.trim ?? 0) - smooth.trim) * ease;
  smooth.settle += ((st.wreck?.settle ?? 0) - smooth.settle) * ease;
  // Picture frame in metres: stern at the left, masthead to keel
  const lenM = m.maxZ - m.minZ + 2 * m.pad;
  const topM = m.maxY + m.pad;
  const botM = -m.minY + m.pad;
  const k = Math.min((w - 2 * PAD_X) / lenM, (h - TOP - 4) / (topM + botM));
  const pw = lenM * k;
  const ox = (w - pw) / 2;
  // Sea level, and the ship lower in it as she settles
  const sea = TOP + topM * k + Math.max(0, (h - TOP - 4 - (topM + botM) * k) / 2);
  const deckM = Math.min(m.maxY * 0.3, -m.minY * 0.9 + 1);
  const wl = sea + (sub ? 0 : smooth.settle * (deckM + 1) * k);
  const hx0 = ox + m.pad * k;
  const hLen = (m.maxZ - m.minZ) * k;
  const geom = cellsOf(st.cls, hx0, hLen);
  const deckY = wl - deckM * k;
  const keelY = wl - m.minY * k;
  const drawShip = (c: CanvasRenderingContext2D) => {
    c.drawImage(p.above, ox, wl - topM * k, pw, topM * k);
    if (p.below) c.drawImage(p.below, ox, wl, pw, botM * k);
  };

  // Water: all around a boat, below the waterline for a ship
  ctx.fillStyle = P.sea;
  if (sub) ctx.fillRect(0, 0, w, h);
  else ctx.fillRect(0, sea, w, h - sea);

  const base = ctx.getTransform();
  const dpr = base.a || 1;
  ctx.save();
  // Trim: the ship pitches about midships (bow down = positive)
  const cx = hx0 + hLen / 2;
  const trim = (c: CanvasRenderingContext2D) => {
    c.translate(cx, wl);
    c.rotate((smooth.trim * Math.PI) / 180);
    c.translate(-cx, -wl);
  };
  trim(ctx);
  // The ship herself, dimmed so the compartment colours read on her
  ctx.globalAlpha = P.shipAlpha;
  ctx.filter = P.shipFilter;
  drawShip(ctx);
  ctx.filter = 'none';
  ctx.globalAlpha = 1;

  // Compartments on a scratch layer, then cut to the hull outline (the pictures' alpha)
  if (scratch.width !== Math.ceil(w * dpr) || scratch.height !== Math.ceil(h * dpr)) {
    scratch.width = Math.ceil(w * dpr);
    scratch.height = Math.ceil(h * dpr);
  }
  const sc = scratch.getContext('2d')!;
  sc.setTransform(dpr, 0, 0, dpr, 0, 0);
  sc.globalCompositeOperation = 'source-over';
  sc.clearRect(0, 0, w, h);
  trim(sc);
  const hh = keelY - deckY;
  st.comps.forEach((c, i) => {
    const cell = geom.cells[i];
    if (!cell) return;
    const { x0, x1 } = cell;
    sc.fillStyle = c.sealed ? P.sealed : c.dmg > 0.5 ? P.hurt : P.ok;
    sc.fillRect(x0, deckY, x1 - x0, hh);
    if (c.dmg > 0.05) {
      sc.strokeStyle = `rgba(${P.hatch},${0.3 + 0.5 * c.dmg})`;
      sc.lineWidth = 1;
      const step = Math.max(4, 9 - 5 * c.dmg);
      sc.save();
      sc.beginPath();
      sc.rect(x0, deckY, x1 - x0, hh);
      sc.clip();
      sc.beginPath();
      for (let x = x0 - hh; x < x1; x += step) {
        sc.moveTo(x, keelY);
        sc.lineTo(x + hh, deckY);
      }
      sc.stroke();
      sc.restore();
    }
    if (c.flood > 0.005) {
      const lvl = keelY - hh * Math.min(1, c.flood);
      sc.fillStyle = P.water;
      sc.beginPath();
      sc.moveTo(x0, keelY);
      for (let x = x0; x <= x1 + 0.1; x += 3) sc.lineTo(Math.min(x, x1), lvl + Math.sin(x * 0.35 + st.t * 3 + i) * (c.leak > 0.01 ? 1.6 : 0.6));
      sc.lineTo(x1, keelY);
      sc.closePath();
      sc.fill();
    }
    if (c.fire > 0.02) {
      const floor = c.flood > 0.005 ? keelY - hh * Math.min(1, c.flood) : keelY;
      const g = sc.createLinearGradient(0, floor, 0, deckY);
      g.addColorStop(0, `rgba(255,120,30,${0.6 * c.fire})`);
      g.addColorStop(1, 'rgba(255,70,20,0.06)');
      sc.fillStyle = g;
      sc.fillRect(x0, deckY, x1 - x0, floor - deckY);
      const n = Math.max(2, Math.round((x1 - x0) / 7));
      for (let q = 0; q < n; q++) {
        const fx = x0 + ((q + 0.5) / n) * (x1 - x0);
        const fl = (0.55 + 0.45 * Math.sin(st.t * (8 + q) + q * 2.1)) * c.fire;
        const fh = (floor - deckY) * (0.3 + 0.55 * fl);
        sc.fillStyle = `rgba(255,${150 + Math.round(80 * fl)},60,${0.6 + 0.35 * fl})`;
        sc.beginPath();
        sc.moveTo(fx - 3, floor);
        sc.quadraticCurveTo(fx - 2, floor - fh * 0.6, fx + Math.sin(st.t * 7 + q) * 1.5, floor - fh);
        sc.quadraticCurveTo(fx + 2, floor - fh * 0.6, fx + 3, floor);
        sc.fill();
      }
    }
    // Bulkhead on the stern side (heavy and amber when either side is shut)
    if (i + 1 < st.comps.length) {
      const shut = c.sealed || st.comps[i + 1]?.sealed;
      sc.fillStyle = shut ? P.shut : P.wall;
      const bw = shut ? 3 : 1.2;
      sc.fillRect(x0 - bw / 2, deckY - 1, bw, hh + 2);
    }
  });
  // Deck over the compartments
  sc.fillStyle = P.wall;
  sc.fillRect(hx0, deckY - 0.6, hLen, 1.2);
  // Keep the layer only inside the hull: one mask of both pictures (destination-in with each
  // picture on its own would clear everything outside the other)
  const mk = mask.getContext('2d')!;
  if (mask.width !== scratch.width || mask.height !== scratch.height) {
    mask.width = scratch.width;
    mask.height = scratch.height;
  }
  mk.setTransform(1, 0, 0, 1, 0, 0);
  mk.clearRect(0, 0, mask.width, mask.height);
  mk.setTransform(sc.getTransform());
  drawShip(mk);
  sc.setTransform(1, 0, 0, 1, 0, 0);
  sc.globalCompositeOperation = 'destination-in';
  sc.drawImage(mask, 0, 0);
  sc.globalCompositeOperation = 'source-over';
  ctx.setTransform(base);
  ctx.drawImage(scratch, 0, 0, w, h);
  ctx.restore();

  // Waterline over the ship (a ship's; a boat is deep in it)
  if (!sub) {
    ctx.strokeStyle = P.wl;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 4) ctx.lineTo(x, sea + Math.sin(x * 0.09 + st.t * 1.6) * 0.9);
    ctx.stroke();
  }

  // Numbers above, selection frame, the party's marker
  ctx.font = `bold ${FONT.label}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  st.comps.forEach((c, i) => {
    const cell = geom.cells[i];
    if (!cell) return;
    const xm = (cell.x0 + cell.x1) / 2;
    ctx.fillStyle = compColour(c);
    ctx.fillText(String(i + 1), xm, 11);
    ctx.strokeStyle = P.tick;
    ctx.beginPath();
    ctx.moveTo(cell.x0 + 0.5, 14);
    ctx.lineTo(cell.x0 + 0.5, 17);
    ctx.stroke();
    if (i === st.selected) {
      ctx.strokeStyle = P.sel;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 2]);
      ctx.strokeRect(cell.x0 + 0.5, deckY - 3, cell.x1 - cell.x0 - 1, keelY - deckY + 6);
      ctx.setLineDash([]);
    }
    if (i === st.dcAt) {
      ctx.fillStyle = P.party;
      ctx.beginPath();
      ctx.moveTo(xm - 4, 13);
      ctx.lineTo(xm + 4, 13);
      ctx.lineTo(xm, 18);
      ctx.closePath();
      ctx.fill();
    }
  });
  return geom;
}

/** Which compartment a click at x (canvas px) falls in. */
export function cellAt(geom: CutawayGeom, x: number): number | undefined {
  const i = geom.cells.findIndex((c) => x >= c.x0 && x < c.x1);
  return i < 0 ? undefined : i;
}
