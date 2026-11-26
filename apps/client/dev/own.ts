/**
 * Dev-only page: the own ship's close-range model seen from her bridge, for render checks.
 * ?cls=ffg|ffv|kor|sub,b=bearing rel. to the bow &pitch &light &hour &kn &sea &t &fov
 * &region=faroebank (sea area: places the sun, moon and stars) &month=1..12 &day=1..31 (the moon's age) &rain=1
 * &cam=x:y:z:tx:ty:tz (free camera in ship coordinates, bow +z). Not part of the build.
 * window.__done once drawn; __shot() redraws, __bench(n) gives ms per frame, __info() draw stats.
 */
import * as THREE from 'three';
import { REGIONS, type RegionId } from '@tk/shared';
import { Periscope3D } from '../src/widgets/periscope3d.js';

// Commas work as separators too (the DevTools /json/new endpoint swallows '&')
const p = new URLSearchParams(location.search.replace(/,/g, '&'));
const num = (k: string, d: number) => (p.has(k) ? Number(p.get(k)) : d);
const cls = (p.get('cls') ?? 'ffg') as 'ffg' | 'ffv' | 'kor' | 'sub';
const canvas = document.getElementById('c') as HTMLCanvasElement;
// cls=sub: the U-boat's periscope, 4 m over the water, no own ship in the picture
const v = new Periscope3D(canvas, cls === 'sub' ? { eye: 4 } : { eye: 20, own: cls });
let t = num('t', 10);
const region = p.get('region') as RegionId | null;
const place = region && REGIONS[region] ? { lat: REGIONS[region].lat, lon: REGIONS[region].lon, month: num('month', 10), day: p.has('day') ? num('day', 15) : undefined, turn: REGIONS[region].bearing } : undefined;
// &glow=range: a lookout's glow sighting of a boat dead ahead of the view at that range (m);
// &torp=range: a glowing torpedo track crossing the view at that range (&tk=strength 0..1, &tdir=deg of its run)
const look = (num('b', 0) * Math.PI) / 180;
const at = (r: number) => ({ x: Math.sin(look) * r, y: Math.cos(look) * r });
const targets = p.has('glow') ? [{ label: 'A1', cls: 'ssk' as const, sighting: 'glow' as const, bearing: num('b', 0), range: num('glow', 1500), alpha: 1, speedKn: 6, course: num('b', 0) + 90 }] : [];
const glowTracks = () => {
  if (!p.has('torp')) return undefined;
  const c = at(num('torp', 1500));
  const d = ((num('tdir', num('b', 0) + 90) * Math.PI) / 180);
  const pts: number[] = [];
  // 40 s of run at 45 kn, a crumb every 2 s, the head moving with t
  for (let i = 0; i <= 20; i++) {
    const s = (i - 20) * 2 * 23 + ((t * 23) % 46);
    pts.push(c.x + Math.sin(d) * s, c.y + Math.cos(d) * s);
  }
  return [{ id: 'T1', k: num('tk', 0.8), pts }];
};
const opts = () => ({ place, rain: num('rain', 0) > 0, targets, glowTracks: glowTracks(),
  bearing: (num('b', 0) + 360) % 360, fovDeg: num('fov', 60), t, sea: num('sea', 3), light: num('light', 1),
  hour: num('hour', 11), pitchDeg: num('pitch', -8), ownHeading: 0, ownKn: num('kn', 15), own: { x: 0, y: 0 },
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vv = v as any;
const cam = p.get('cam')?.split(':').map(Number);
// ?off=own-foam-side:own-foam-stern:own-smoke:own-night:lights drops parts (cost checks)
for (const name of p.get('off')?.split(':') ?? []) {
  const g = vv.own.g as THREE.Group;
  if (name === 'lights') g.children.filter((o) => (o as THREE.PointLight).isPointLight).forEach((o) => o.removeFromParent());
  else g.getObjectByName(name)?.removeFromParent();
}
function draw(): void {
  v.render(opts());
  if (!cam) return;
  // Free camera in ship coordinates: redraw both passes from there
  const g = vv.own.g as THREE.Group;
  const c = vv.camera as THREE.PerspectiveCamera;
  c.position.set(cam[0]!, cam[1]!, cam[2]!).applyMatrix4(g.matrixWorld);
  c.up.set(0, 1, 0);
  c.lookAt(new THREE.Vector3(cam[3]!, cam[4]!, cam[5]!).applyMatrix4(g.matrixWorld));
  c.updateMatrixWorld();
  const r = vv.renderer as THREE.WebGLRenderer;
  r.render(vv.scene, c);
  const nc = vv.nearCam as THREE.PerspectiveCamera | undefined;
  if (nc) {
    nc.position.copy(c.position);
    nc.quaternion.copy(c.quaternion);
    nc.fov = c.fov;
    nc.aspect = c.aspect;
    nc.near = 0.05;
    nc.far = 40;
    nc.updateProjectionMatrix();
    r.autoClear = false;
    r.clearDepth();
    r.render(vv.scene, nc);
    r.autoClear = true;
  }
}
const w = window as unknown as Record<string, unknown>;
w.__shot = draw;
w.__view = vv;
w.__bench = (n: number) => {
  const gl = (vv.renderer as THREE.WebGLRenderer).getContext();
  const px = new Uint8Array(4);
  draw();
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    t += 1 / 30;
    draw();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  }
  return (performance.now() - t0) / n;
};
w.__info = () => {
  const r = vv.renderer as THREE.WebGLRenderer;
  let tris = 0;
  (vv.own?.g as THREE.Group | undefined)?.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position!.count) / 3;
  });
  return { calls: r.info.render.calls, frameTris: r.info.render.triangles, ownTris: Math.round(tris) };
};
// Let the canvas textures settle for a few frames, then report
let n = 0;
// Sightings fade in over a few seconds of scene time: with targets, step the clock through that first
const t0 = t;
const tick = () => {
  if (targets.length) t = t0 + n * 2;
  draw();
  if (++n < (targets.length ? 6 : 4)) requestAnimationFrame(tick);
  else w.__done = true;
};
requestAnimationFrame(tick);
