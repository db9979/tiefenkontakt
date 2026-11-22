/**
 * Dev-only page: the 3D sea view with local weather (?wx=fog|fogin|squall|squallin|ice&b=bearing&light=1&eye=20).
 * For render checks of fog banks, squalls and ice. Not part of the build.
 */
import type { MetCells } from '@tk/shared';
import { Periscope3D } from '../src/widgets/periscope3d.js';

const p = new URLSearchParams(location.search);
const wx = p.get('wx') ?? 'fog';
const own = { x: 0, y: 0 };
const met: MetCells = { wind: { x: 3, y: 0 }, drift: { x: 0, y: 0 }, fog: [], squalls: [], floes: [], bergs: [] };
if (wx === 'fog') met.fog.push({ id: 1, x: 0, y: 4500, r: 2500, d: 1 });
if (wx === 'fogin') met.fog.push({ id: 1, x: 0, y: 600, r: 2500, d: 1 });
if (wx === 'squall') met.squalls.push({ id: 2, x: 1500, y: 9000, r: 2500, until: 1e9 });
if (wx === 'squallin') met.squalls.push({ id: 2, x: 0, y: 500, r: 2500, until: 1e9 });
if (wx === 'ice') {
  met.floes.push({ id: 3, x: 0, y: 3000, r: 4000, cover: 0.6 });
  met.bergs.push({ id: 4, x: -300, y: 1400, r: 90, h: 35, draft: 175 }, { id: 5, x: 900, y: 3800, r: 60, h: 22, draft: 110 }, { id: 6, x: -1500, y: 6000, r: 110, h: 45, draft: 220 });
}
const canvas = document.getElementById('c') as HTMLCanvasElement;
const eye = Number(p.get('eye') ?? 20);
const v = new Periscope3D(canvas, { eye });
const ship = p.get('ship');
v.render({
  bearing: Number(p.get('b') ?? 0), fovDeg: Number(p.get('fov') ?? 50), t: 10, sea: Number(p.get('sea') ?? 3), light: Number(p.get('light') ?? 1),
  targets: ship ? [{ label: 'S1', cls: 'merchant', bearing: Number(p.get('b') ?? 0), range: Number(ship), course: 90, alpha: 1 }] : [],
  rain: wx === 'squallin', hour: 11, met, own, pitchDeg: Number(p.get('pitch') ?? 0),
});
document.title = 'ready';
