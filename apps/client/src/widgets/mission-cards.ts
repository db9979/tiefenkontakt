import { KIND_REGION, MISSION_REGION, depthAt, northOffset, type MissionKey, type RegionId, type SeabedKind } from '@tk/shared';
import { ensureGrid } from './bathy-client.js';
import { esc } from './format.js';
import { drawSymbol } from './symbols.js';

interface Card { key: MissionKey; title: string; info: string; seabed: SeabedKind; kind: 'convoy' | 'duel' | 'harbour' | 'custom' | 'shadow' | 'strait' | 'recon' }

const CARDS: Card[] = [
  { key: 'groenland', title: 'Grönland-Lücke', info: 'Färöer-Bank · Kanal und Bank', seabed: 'tief', kind: 'convoy' },
  { key: 'schelf', title: 'Schelfmeer', info: 'Barentssee · flach, Nachhall', seabed: 'schelf', kind: 'convoy' },
  { key: 'fjord', title: 'Fjordausfahrt', info: 'Vestfjord · Rinne vor den Lofoten', seabed: 'fjord', kind: 'convoy' },
  { key: 'duell', title: 'U-Boot-Duell', info: 'Lofotenbecken · Boot gegen Boot', seabed: 'tief', kind: 'duel' },
  { key: 'hafen', title: 'Hafenangriff', info: 'Kolabucht · Ankerplatz vor Murmansk', seabed: 'fjord', kind: 'harbour' },
  { key: 'fuehlung', title: 'Fühlung halten', info: 'Waffen gesperrt · melden', seabed: 'tief', kind: 'shadow' },
  { key: 'meerenge', title: 'Meerengen-Durchbruch', info: 'Gibraltar · durch die Enge', seabed: 'fjord', kind: 'strait' },
  { key: 'aufklaerung', title: 'Aufklärung', info: 'Erkennen, melden, entkommen', seabed: 'schelf', kind: 'recon' },
  { key: 'eigene', title: 'Eigene Mission', info: 'Frei einstellbar', seabed: 'tief', kind: 'custom' },
];

/** Chart canvases are drawn at double resolution so lines and labels stay crisp on phones. */
const W = 320;
const H = 180;
const BLUE = '#85b7eb';
const RED = '#f09595';
const ROUTE = 28_000; // convoy route at the default 40 min limit (scenario.routeLength)

/** Mission picker: cards with a small tactical chart of the sea area and the starting situation. */
export function missionCards(current: MissionKey): string {
  return `<div class="mcards">${CARDS.map((c) => `<button class="mcard ${c.key === current ? 'on' : ''}" data-mission="${c.key}">
    <canvas data-chart="${c.key}" width="${W}" height="${H}"></canvas>
    <div class="mcard-t">${esc(c.title)}</div><div class="dim">${esc(c.info)}</div></button>`).join('')}</div>`;
}

/**
 * Visible sea area in meters, in the game frame (x right of the route, y along it). The card is
 * drawn north-up: the sea is sampled turned by the area's bearing about the view centre, and the
 * scene is drawn with the canvas turned the same way (symbols and labels stay upright).
 */
interface View { x0: number; x1: number; y0: number; y1: number }
const WIDE: View = { x0: -30_000, x1: 30_000, y0: -3_000, y1: 30_750 };
const HARBOUR: View = { x0: -20_000, x1: 20_000, y0: 0, y1: 22_500 };

const px = (v: View, x: number) => ((x - v.x0) / (v.x1 - v.x0)) * W;
const py = (v: View, y: number) => (1 - (y - v.y0) / (v.y1 - v.y0)) * H;

const charts = new Map<string, { img: ImageData; typical: number }>();

/** Depth tint, relief shading and isobaths, computed once per sea area. */
function seaImage(ctx: CanvasRenderingContext2D, kind: SeabedKind, v: View, off: number, region?: RegionId): { img: ImageData; typical: number } {
  const spec = { kind, seed: 7, region };
  const depth = new Float32Array(W * H);
  let lo = Infinity;
  let hi = -Infinity;
  // Pixel (north-up, metres east/north of the centre) → game frame
  const mpp = (v.x1 - v.x0) / W;
  const cx = (v.x0 + v.x1) / 2, cy = (v.y0 + v.y1) / 2;
  const b = (off * Math.PI) / 180;
  const cos = Math.cos(b), sin = Math.sin(b);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const e = (i + 0.5 - W / 2) * mpp, n = (H / 2 - j - 0.5) * mpp;
      const d = depthAt(spec, cx + e * cos - n * sin, cy + e * sin + n * cos);
      depth[j * W + i] = d;
      if (d > 0) { lo = Math.min(lo, d); hi = Math.max(hi, d); }
    }
  }
  const span = Math.max(40, hi - lo);
  // Contour spacing adapted to the depth range so every sea shows structure
  const step = span > 1500 ? 250 : span > 400 ? 100 : 25;
  const img = ctx.createImageData(W, H);
  const at = (i: number, j: number) => depth[Math.min(H - 1, Math.max(0, j)) * W + Math.min(W - 1, Math.max(0, i))]!;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const d = at(i, j);
      let r: number, g: number, b: number;
      if (d <= 0) {
        // Land: olive, lighter inland, with a bright coastline
        const coast = at(i + 1, j) > 0 || at(i - 1, j) > 0 || at(i, j + 1) > 0 || at(i, j - 1) > 0;
        const k = Math.min(1, -d / 150);
        [r, g, b] = coast ? [176, 160, 112] : [70 + 30 * k, 66 + 26 * k, 44 + 14 * k];
      } else {
        // Water: shallow teal → deep navy, relative to this sea's own range
        const t = Math.min(1, Math.max(0, (d - lo) / span));
        // Absolute depth dominates, so a shelf sea reads clearly lighter than the deep ocean
        const abs = Math.min(1, Math.max(0, (Math.log10(Math.max(10, d)) - 1.5) / 2.1));
        const m = 0.25 * t + 0.75 * abs;
        r = 34 - 26 * m; g = 92 - 66 * m; b = 92 - 58 * m;
        // Relief: light from the north-west
        const slope = (at(i - 1, j - 1) - at(i + 1, j + 1)) / span;
        const s = Math.max(-0.35, Math.min(0.35, slope * 22));
        r *= 1 - s; g *= 1 - s; b *= 1 - s;
        // Isobaths
        if (Math.floor(d / step) !== Math.floor(at(i + 1, j) / step) || Math.floor(d / step) !== Math.floor(at(i, j + 1) / step)) {
          r += 28; g += 46; b += 46;
        }
      }
      img.data.set([r, g, b, 255], (j * W + i) * 4);
    }
  }
  const wet = [...depth].filter((d) => d > 0).sort((a, b) => a - b);
  return { img, typical: wet[Math.floor(wet.length / 2)] ?? 0 };
}

/** Canvas point of (x, y) under the current (turned) transform; the card canvases have no other transform. */
function upright(ctx: CanvasRenderingContext2D, x: number, y: number): { x: number; y: number } {
  const p = ctx.getTransform().transformPoint(new DOMPoint(x, y));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { x: p.x, y: p.y };
}

/** Text at a point of the (possibly turned) scene, drawn upright. */
function label(ctx: CanvasRenderingContext2D, text: string, x0: number, y0: number, color: string, align: CanvasTextAlign = 'left'): void {
  const { x, y } = upright(ctx, x0, y0);
  ctx.font = '600 15px ui-monospace, Menlo, monospace';
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(3, 10, 12, 0.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Text at a fixed place on the card (not part of the turned scene). */
function hud(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  label(ctx, text, x, y, color);
  ctx.restore();
}

function chartFrame(ctx: CanvasRenderingContext2D, v: View): void {
  // 10 km grid along true north and east, through the view centre
  const k = 10_000 / ((v.x1 - v.x0) / W);
  ctx.strokeStyle = 'rgba(180, 230, 220, 0.09)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = W / 2 - Math.floor(W / 2 / k) * k; x < W; x += k) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = H / 2 - Math.floor(H / 2 / k) * k; y < H; y += k) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
  // Scale bar and north arrow
  const ten = px(v, v.x0 + 10_000);
  ctx.strokeStyle = '#cfe8e0';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(10, H - 12); ctx.lineTo(10 + ten, H - 12); ctx.moveTo(10, H - 17); ctx.lineTo(10, H - 7); ctx.moveTo(10 + ten, H - 17); ctx.lineTo(10 + ten, H - 7); ctx.stroke();
  label(ctx, '10 KM', 16 + ten, H - 12, '#cfe8e0');
  ctx.fillStyle = '#cfe8e0';
  ctx.beginPath(); ctx.moveTo(W - 16, 8); ctx.lineTo(W - 22, 24); ctx.lineTo(W - 16, 20); ctx.lineTo(W - 10, 24); ctx.fill();
  label(ctx, 'N', W - 16, 33, '#cfe8e0', 'center');
}

function sym(ctx: CanvasRenderingContext2D, x: number, y: number, aff: 'friend' | 'hostile' | 'neutral', dim: 'surface' | 'subsurface', size: number): void {
  const p = upright(ctx, x, y);
  ctx.strokeStyle = ctx.fillStyle = aff === 'hostile' ? RED : aff === 'friend' ? BLUE : '#c9d4d0';
  ctx.lineWidth = 2.2;
  drawSymbol(ctx, p.x, p.y, aff, dim, size, true);
  ctx.restore();
}

function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx, y + dy); ctx.stroke();
  const a = Math.atan2(dy, dx);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + dx, y + dy);
  ctx.lineTo(x + dx - 8 * Math.cos(a - 0.45), y + dy - 8 * Math.sin(a - 0.45));
  ctx.lineTo(x + dx - 8 * Math.cos(a + 0.45), y + dy - 8 * Math.sin(a + 0.45));
  ctx.fill();
}

/** Convoy steaming north, escorts ahead, wolfpack waiting along the route. */
function convoyScene(ctx: CanvasRenderingContext2D, v: View): void {
  const x = px(v, 0);
  ctx.strokeStyle = BLUE;
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 5]);
  ctx.beginPath(); ctx.moveTo(x, py(v, 0)); ctx.lineTo(x, py(v, ROUTE)); ctx.stroke();
  ctx.setLineDash([]);
  // Destination
  ctx.beginPath(); ctx.arc(x, py(v, ROUTE), 7, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(x, py(v, ROUTE), 2.5, 0, Math.PI * 2); ctx.fillStyle = BLUE; ctx.fill();
  label(ctx, 'ZIELHAFEN', x + 12, py(v, ROUTE), BLUE);
  // Merchants in columns, escorts on the flanks ahead
  // Merchants as separate APP-6 neutral surface symbols (pixel spacing, so they never merge into a block)
  for (let i = 0; i < 6; i++) sym(ctx, x + ((i % 3) - 1) * 22, py(v, 0) - 16 + Math.floor(i / 3) * 16, 'neutral', 'surface', 5);
  label(ctx, 'KONVOI', x + 60, py(v, 0) + 2, '#c9d4d0');
  for (const ex of [-1, 1]) sym(ctx, x + ex * 48, py(v, 3600), 'friend', 'surface', 6);
  // Ambush zone and the pack
  const zy0 = py(v, ROUTE * 0.42);
  const zy1 = py(v, ROUTE * 0.78);
  ctx.strokeStyle = 'rgba(240, 149, 149, 0.75)';
  ctx.fillStyle = 'rgba(240, 149, 149, 0.08)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.ellipse(x, (zy0 + zy1) / 2, px(v, 9_000) - x, (zy0 - zy1) / 2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.setLineDash([]);
  for (const [sx, sy] of [[-5_000, 0.5], [4_000, 0.62], [-1_500, 0.72]] as const) sym(ctx, px(v, sx), py(v, ROUTE * sy), 'hostile', 'subsurface', 6);
  label(ctx, 'RUDEL', px(v, 9_800), (zy0 + zy1) / 2, RED);
}

function duelScene(ctx: CanvasRenderingContext2D, v: View): void {
  const a = { x: px(v, -3_000), y: py(v, 2_500) };
  const b = { x: px(v, 3_000), y: py(v, 25_000) };
  // Sonar search arcs reaching toward each other
  ctx.lineWidth = 1.5;
  for (const [p, col, dir] of [[a, BLUE, -1], [b, RED, 1]] as const) {
    ctx.strokeStyle = col;
    for (const r of [26, 46, 66]) {
      ctx.globalAlpha = 0.9 - r / 90;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, dir < 0 ? Math.PI * 1.2 : Math.PI * 0.2, dir < 0 ? Math.PI * 1.8 : Math.PI * 0.8); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  sym(ctx, a.x, a.y, 'friend', 'subsurface', 8);
  sym(ctx, b.x, b.y, 'hostile', 'subsurface', 8);
  ctx.strokeStyle = 'rgba(207, 232, 224, 0.5)';
  ctx.setLineDash([3, 5]);
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.setLineDash([]);
  label(ctx, '≈ 23 KM', (a.x + b.x) / 2 + 8, (a.y + b.y) / 2, '#cfe8e0');
  label(ctx, 'WESTBUND', a.x + 14, a.y + 4, BLUE);
  label(ctx, 'OSTPAKT', b.x + 14, b.y + 2, RED);
}

/** Merchants at anchor deep in the bay, escorts patrol the entrance, subs come in from the sea. */
function harbourScene(ctx: CanvasRenderingContext2D, v: View): void {
  for (let i = 0; i < 6; i++) sym(ctx, px(v, 0) + ((i % 3) - 1) * 22, py(v, 3000) - 6 + Math.floor(i / 3) * 16, 'neutral', 'surface', 5);
  label(ctx, 'ANKERPLATZ', px(v, 0) + 34, py(v, 3000) + 2, '#c9d4d0');
  const gy = py(v, 6_500);
  ctx.strokeStyle = BLUE;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(px(v, -4_500), gy); ctx.lineTo(px(v, 4_500), gy); ctx.stroke();
  ctx.setLineDash([]);
  for (const ex of [-2_500, 2_500]) sym(ctx, px(v, ex), gy, 'friend', 'surface', 6);
  label(ctx, 'SPERRE', px(v, 5_000), gy, BLUE);
  for (const [sx, sy] of [[-2_000, 19_000], [2_000, 20_500]] as const) {
    sym(ctx, px(v, sx), py(v, sy), 'hostile', 'subsurface', 6);
    arrow(ctx, px(v, sx), py(v, sy) + 12, 0, 26, RED);
  }
  label(ctx, 'ANGRIFF', px(v, 3_200), py(v, 20_000), RED);
}

/** Shadowing: a boat trails the convoy at the edge of its sonar range and keeps reporting. */
function shadowScene(ctx: CanvasRenderingContext2D, v: View): void {
  const x = px(v, 0);
  ctx.strokeStyle = BLUE;
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 5]);
  ctx.beginPath(); ctx.moveTo(x, py(v, 0)); ctx.lineTo(x, py(v, ROUTE)); ctx.stroke();
  ctx.setLineDash([]);
  const cy = py(v, 14_000);
  for (let i = 0; i < 6; i++) sym(ctx, x + ((i % 3) - 1) * 22, cy - 8 + Math.floor(i / 3) * 16, 'neutral', 'surface', 5);
  for (const ex of [-1, 1]) sym(ctx, x + ex * 48, cy - 34, 'friend', 'surface', 6);
  const sx = px(v, 9_000);
  const sy = py(v, 9_500);
  sym(ctx, sx, sy, 'hostile', 'subsurface', 6);
  ctx.strokeStyle = 'rgba(240,149,149,0.7)';
  ctx.setLineDash([3, 4]);
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(x + 30, cy); ctx.stroke();
  ctx.setLineDash([]);
  label(ctx, 'FÜHLUNG', sx + 12, sy + 6, RED);
  label(ctx, '((( FUNK', sx + 12, sy + 24, '#e8c37a');
  hud(ctx, 'WAFFEN GESPERRT', 10, 36, '#e8c37a');
}

/** Strait: escorts across the narrows, boats coming up from the south to the exit line. */
function straitScene(ctx: CanvasRenderingContext2D, v: View): void {
  const guard = py(v, 7_000);
  const exit = py(v, 15_000);
  ctx.strokeStyle = BLUE;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(px(v, -3_500), guard); ctx.lineTo(px(v, 3_500), guard); ctx.stroke();
  ctx.setLineDash([]);
  for (const ex of [-1_200, 1_200]) sym(ctx, px(v, ex), guard, 'friend', 'surface', 6);
  label(ctx, 'SPERRE', px(v, 4_000), guard, BLUE);
  ctx.strokeStyle = '#e8c37a';
  ctx.beginPath(); ctx.moveTo(px(v, -6_000), exit); ctx.lineTo(px(v, 6_000), exit); ctx.stroke();
  label(ctx, 'AUSGANG', px(v, 6_500), exit, '#e8c37a');
  for (const sx of [-600, 600]) {
    const y = py(v, -1_000);
    sym(ctx, px(v, sx), y, 'hostile', 'subsurface', 6);
    arrow(ctx, px(v, sx), y - 12, 0, -30, RED);
  }
  label(ctx, 'DURCHBRUCH', px(v, 1_500), py(v, 1_500), RED);
}

/** Reconnaissance: a boat close to an escort with the periscope up, then away on the DF bearing. */
function reconScene(ctx: CanvasRenderingContext2D, v: View): void {
  convoyScene(ctx, v);
  const ex = px(v, 0) + 48;
  const ey = py(v, 3_600);
  const sx = px(v, 6_000);
  const sy = py(v, 7_500);
  ctx.strokeStyle = '#e8c37a';
  ctx.setLineDash([2, 3]);
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(ex, ey, 11, 0, 7); ctx.stroke();
  label(ctx, '≤ 4 KM · SEHROHR', sx + 10, sy - 4, '#e8c37a');
  hud(ctx, 'MELDEN + 20 MIN ENTKOMMEN', 10, 36, '#e8c37a');
}

/** Draw the chart canvases rendered by missionCards (sea area cached per mission). */
// Theme switched while the cards are on screen: paint them again in the new ink
let lastSeabed: SeabedKind | undefined;
window.addEventListener('tk-ink', () => paintMissionCharts(document.body, lastSeabed));
window.addEventListener('tk-bathy', () => paintMissionCharts(document.body, lastSeabed));

export function paintMissionCharts(root: HTMLElement, customSeabed?: SeabedKind): void {
  lastSeabed = customSeabed;
  root.querySelectorAll<HTMLCanvasElement>('canvas[data-chart]').forEach((cv) => {
    const card = CARDS.find((c) => c.key === cv.dataset.chart)!;
    const seabed = card.kind === 'custom' && customSeabed ? customSeabed : card.seabed;
    const v = card.kind === 'harbour' ? HARBOUR : WIDE;
    const ctx = cv.getContext('2d')!;
    const region = card.kind === 'custom' && customSeabed ? KIND_REGION[customSeabed] : MISSION_REGION[card.key];
    // The real sea area: drawn once its bathymetry is here (the cards repaint when it arrives)
    const ready = !region || ensureGrid(region);
    // North-up: the area's bearing (no snapshot in the lobby, so straight from the region)
    const off = northOffset(region);
    const key = `${card.kind === 'harbour' ? 'h' : 'w'}|${seabed}|${region ?? ''}|${ready}|${off}`;
    let sea = charts.get(key);
    if (!sea) charts.set(key, (sea = seaImage(ctx, seabed, v, off, ready ? region : undefined)));
    ctx.putImageData(sea.img, 0, 0);
    chartFrame(ctx, v);
    // Typical water depth: the first thing a captain wants to know about the area
    const deep = sea.typical >= 1000 ? `${(sea.typical / 1000).toFixed(1).replace('.', ',')} KM` : `${Math.round(sea.typical / 10) * 10} M`;
    label(ctx, `TIEFE ~${deep}`, 10, 16, '#cfe8e0');
    // The scene in the game frame, turned about the card centre like the sea
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate((off * Math.PI) / 180);
    ctx.translate(-W / 2, -H / 2);
    if (card.kind === 'duel') duelScene(ctx, v);
    else if (card.kind === 'harbour') harbourScene(ctx, v);
    else if (card.kind === 'strait') straitScene(ctx, v);
    else if (card.kind === 'shadow') shadowScene(ctx, v);
    else if (card.kind === 'recon') reconScene(ctx, v);
    else convoyScene(ctx, v);
    ctx.restore();
    if (card.kind === 'custom') label(ctx, '⚙ FREI', 10, 36, '#e8c37a');
  });
}
