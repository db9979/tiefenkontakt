import * as THREE from 'three';
import type { ClassId, MetCells, PlaneKind, SamView, SeabedSpec, Sighting, Vec2, WreckView } from '@tk/shared';
import { Terrain } from './sea3d/terrain.js';
import { WeatherFx } from './sea3d/weather3d.js';
import { MissileTrails } from './sea3d/missiles.js';
import { shipModel, sightingModel } from './sea3d/models.js';
import { aircraftModel, animateAircraft } from './sea3d/aircraft.js';
import { mergeStatic } from './sea3d/merge.js';
import { OCEAN_FRAG, OCEAN_VERT } from './sea3d/shaders.js';
import { SkyFx } from './sea3d/sky.js';
import { applyWaves, hullOnSea, oceanGrid, ownRoll, seaWaves, waveHeight, waveUniforms, type Waves } from './sea3d/waves.js';
import { wakeUniforms } from './sea3d/wake.js';
import { bridgeFront, cullNear, handShake } from './sea3d/own-ship.js';
import { ownDetail } from './sea3d/own-detail.js';
import { createAftermath, updateAftermath } from './sea3d/aftermath.js';
import { addSlick, applyWreck, startSinking, stepSinking, updateSlicks, type Sinking, type Slick } from './sea3d/wreck.js';
import { dprGl, oceanSegments } from './perf.js';
import { store } from '../store.js';

/**
 * 3D sea view used by the periscope (eye 4 m) and the escorts' bridge (eye 20 m):
 * multi-wave ocean with whitecaps and glitter, sky with clouds, sun and moon,
 * ship models placed from (filtered) bearing/range and sunk by earth curvature.
 * The 2D reticle or binocular mask is drawn on top by the station.
 */

const EARTH_R = 6_371_000;
/** Stable 0…2π phase from a label, so every ship keeps its own rhythm. */
function phaseOf(label: string): number {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return (h % 6283) / 1000;
}

export interface PeriscopeTarget {
  label: string;
  cls: ClassId;
  bearing: number;
  range: number;
  course?: number;
  speedKn?: number;
  alpha: number;
  /** Lookout sighting of a submerged boat: draw what is visible of it (feather, snorkel). */
  sighting?: Sighting;
  /** Navigation lights burning (shown at dusk and night). */
  lit?: boolean;
  /** Aircraft: type and height above the sea (m). */
  plane?: PlaneKind;
  alt?: number;
  /** Visible damage (list, trim, fire, settling). */
  wreck?: WreckView;
  /** Known to have sunk: a ship already in the picture goes down (never drawn anew). */
  sunk?: boolean;
}

/** A detonation seen through the optic (from a hit/sunk report): water column, smoke, fire. */
export interface PeriscopeEffect {
  id: string;
  bearing: number;
  range: number;
  age: number;
  /** World position of the blast (east, north); with the observer's position it stays put while we move. */
  x?: number;
  y?: number;
  /** The struck ship goes down (sinking report); quiet: no new detonation, only the sinking. */
  sinks?: boolean;
  quiet?: boolean;
}

const DEFAULT_KN: Partial<Record<ClassId, number>> = { merchant: 9, ffg: 14, kor: 14 };

interface Placed { g: THREE.Group; key: string; bearing: number; born?: number }

/** Seconds a newly sighted ship takes to come out of the haze, and a lost one to fade into it. */
const FADE_IN_S = 5;
const FADE_OUT_S = 4;

/**
 * Fade a whole model (k 0..1): its materials are cloned once so other ships sharing them are not
 * touched, made transparent while fading and restored to their own opacity when fully in view.
 */
function fadeModel(g: THREE.Object3D, k: number): void {
  const full = k >= 0.999;
  if (full && !g.userData.fading) return;
  g.userData.fading = !full;
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.material) return;
    if (!g.userData.ownMats) m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const ud = mat.userData as { op?: number; tr?: boolean };
      ud.op ??= mat.opacity;
      ud.tr ??= mat.transparent;
      mat.opacity = ud.op * (full ? 1 : k);
      const tr = full ? ud.tr : true;
      if (mat.transparent !== tr) {
        mat.transparent = tr;
        mat.needsUpdate = true;
      }
    }
  });
  g.userData.ownMats = true;
}

export class Periscope3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 1, 60_000);
  private ocean: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private hemi = new THREE.HemisphereLight(0xb8c8d0, 0x1a2a30, 1.2);
  private sun = new THREE.DirectionalLight(0xffffff, 1.2);
  private ships = new Map<string, Placed>();
  /** Lost ships fading into the haze: model and the time the fade began. */
  private fading: { g: THREE.Group; at: number }[] = [];
  private sinking: Sinking[] = [];
  private slicks: Slick[] = [];
  private ownPos = { x: 0, y: 0 };
  private terrain = new Terrain();
  /** This frame's time and sea state (for the own ship's roll). */
  private t = 0;
  private sea = 3;
  /** How far a wave covers the periscope head this frame (0 clear … 1 under). */
  wash = 0;
  /** Extinction of the air this frame (1/m): lights fade with it. */
  private sigma = 0;
  private glow = 0;
  private effects = new Map<string, THREE.Group>();
  private skyFx: SkyFx;
  private fire = new THREE.PointLight(0xff7a30, 0, 6000, 1.2);
  /** Eye height above the water (m): 4 for a periscope, about 20 on a frigate's bridge. */
  private eye: number;
  /** Ocean grid cell law (for wakes on the same grid) and this frame's sea. */
  private cell: THREE.Vector2;
  private waves!: Waves;
  /** Own ship around the camera (bridge view): model and how far forward of midships the bridge is. */
  private own?: { g: THREE.Group; bridgeZ: number };
  /** Camera for the own bridge's near parts (second pass, near plane a few centimetres). */
  private nearCam?: THREE.PerspectiveCamera;
  private wx: WeatherFx;
  /** Surface-to-air missiles: smoke trails, flames, bursts. */
  private missiles = new MissileTrails(this.scene);

  constructor(private canvas: HTMLCanvasElement, opts: { eye?: number; own?: ClassId } = {}) {
    this.eye = opts.eye ?? 4;
    this.camera.near = opts.own ? 1.5 : 3; // depth precision at range: nothing comes within 3 m of a periscope head
    canvas.classList.add('gl');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x24343b);
    this.camera.rotation.order = 'YXZ';
    const grid = oceanGrid(oceanSegments());
    this.cell = grid.cell;
    this.ocean = new THREE.Mesh(
      grid.geo,
      new THREE.ShaderMaterial({
        vertexShader: OCEAN_VERT, fragmentShader: OCEAN_FRAG,
        uniforms: {
          ...waveUniforms(), uCell: { value: grid.cell }, uTime: { value: 0 }, uDeep: { value: new THREE.Color(0x10303a) }, uSky: { value: new THREE.Color(0x5a7078) }, uSkyTop: { value: new THREE.Color(0x3d5560) },
          uSun: { value: new THREE.Vector3(0.3, 0.5, -0.8) }, uMoon: { value: new THREE.Vector3(-0.3, 0.4, 0.8) }, uFog: { value: new THREE.Color(0x4b5f67) },
          uFogDensity: { value: 0.00006 }, uLight: { value: 1 }, uFoam: { value: 0 }, uSunUp: { value: 1 }, uRain: { value: 0 }, uSpin: { value: 0 },
        },
      }),
    );
    this.scene.add(this.ocean);
    // Coasts, islands and mountains from the sea chart
    this.scene.add(this.terrain.group);
    this.wx = new WeatherFx(this.scene, this.ocean.material);
    this.skyFx = new SkyFx(this.scene);
    this.scene.add(this.hemi, this.sun, this.fire);
    this.scene.add(this.camera);
    if (opts.own) {
      // Foredeck, gun and bridge front in the lower part of the picture: the eye sits on the bridge roof
      const g = shipModel(opts.own);
      // Eye just behind the forward bridge windows; parts right at the eye (dome, mast foot) would fill the view
      const bridgeZ = bridgeFront(g) - 1.5;
      cullNear(g, new THREE.Vector3(0, this.eye, bridgeZ), 6);
      // Close-range detail (hull, foredeck, fittings, lookout platform): only the own ship gets it
      if (opts.own === 'ffg' || opts.own === 'kor' || opts.own === 'ffv') {
        ownDetail(g, opts.own, this.eye, bridgeZ);
        // The open bridge around the eye is on layer 1, drawn after the rest with a short near plane
        for (const l of [this.hemi, this.sun, this.fire]) l.layers.enable(1);
        this.nearCam = new THREE.PerspectiveCamera();
        this.nearCam.layers.set(1);
      }
      this.own = { g: mergeStatic(g), bridgeZ };
      this.scene.add(g);
    }
  }

  private effectGroup(): THREE.Group {
    const g = new THREE.Group();
    const water = new THREE.Mesh(new THREE.ConeGeometry(14, 90, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xeef6f7, transparent: true, opacity: 0.9 }));
    water.name = 'water';
    water.position.y = 45;
    g.add(water);
    for (let i = 0; i < 7; i++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshLambertMaterial({ color: 0x2a2c2e, transparent: true, opacity: 0.75 }));
      puff.name = `smoke${i}`;
      g.add(puff);
    }
    g.add(createAftermath(Math.random() * 6));
    return g;
  }

  /** Detonations: a water column that collapses, then a smoke column drifting up and away. */
  private updateEffects(list: PeriscopeEffect[], light: number): void {
    const seen = new Set<string>();
    let glow = 0;
    for (const e of list) {
      seen.add(e.id);
      let g = this.effects.get(e.id);
      if (!g) {
        // The ship nearest to the blast in bearing starts to sink once it drops out of the picture
        if (e.sinks) for (const s of this.ships.values()) if (Math.abs(((s.bearing - e.bearing + 540) % 360) - 180) < 4) (s.g.userData as { doomed?: number }).doomed = e.age;
        if (e.quiet) continue;
        g = this.effectGroup();
        // Size of the struck ship: a big hull throws a bigger column; a tanker leaves a burning sea
        let best: { len: number; oil: boolean } | undefined;
        let bestD = 6;
        for (const s of this.ships.values()) {
          const d = Math.abs(((s.bearing - e.bearing + 540) % 360) - 180);
          if (d >= bestD) continue;
          bestD = d;
          const box = new THREE.Box3().setFromObject(s.g).getSize(new THREE.Vector3());
          best = { len: box.z, oil: !!s.g.userData.oil };
        }
        g.userData.k = best ? Math.max(0.35, Math.min(1.6, best.len / 130)) : 1;
        g.userData.oil = best?.oil ? 2.5 : 1;
        this.effects.set(e.id, g);
        this.scene.add(g);
      }
      const b = (e.bearing * Math.PI) / 180;
      const drop = (e.range * e.range) / (2 * EARTH_R);
      if (e.x !== undefined && e.y !== undefined) g.position.set(e.x - this.ownPos.x, -drop, -(e.y - this.ownPos.y));
      else g.position.set(Math.sin(b) * e.range, -drop, -Math.cos(b) * e.range);
      const water = g.getObjectByName('water') as THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>;
      const rise = Math.min(1, e.age / 2.5);
      const fall = Math.max(0, 1 - Math.max(0, e.age - 4) / 6);
      const k = (g.userData.k as number | undefined) ?? 1;
      const kh = Math.sqrt(k);
      water.scale.set((1 + e.age * 0.25) * k, Math.max(0.01, rise * fall) * kh, (1 + e.age * 0.25) * k);
      water.position.y = 45 * rise * fall * kh;
      water.material.opacity = 0.9 * fall;
      for (let i = 0; i < 7; i++) {
        const puff = g.getObjectByName(`smoke${i}`) as THREE.Mesh<THREE.SphereGeometry, THREE.MeshLambertMaterial>;
        const a = Math.max(0, e.age - 2 - i * 1.5);
        puff.visible = a > 0;
        puff.scale.setScalar((8 + a * 2.5 + i * 2) * kh);
        puff.position.set(a * 3 + i * 2, 15 + a * 6 + i * 10, Math.sin(i) * 6);
        puff.material.opacity = Math.max(0, 0.75 - a / 120);
      }
      const am = g.getObjectByName('aftermath') as THREE.Group;
      updateAftermath(am, e.age, performance.now() / 1000, light, (e.bearing * 7) % 6, (g.userData.oil as number | undefined) ?? 1);
      // Burning oil keeps lighting the scene at night for a few minutes
      const burnS = 240 * ((g.userData.oil as number | undefined) ?? 1);
      if (e.age < burnS) glow = Math.max(glow, (1 - light) * (1 - e.age / burnS));
      if (glow > 0) this.fire.position.copy(g.position).setY(20);
    }
    this.glow = glow;
    for (const [id, g] of this.effects) {
      if (!seen.has(id)) {
        this.scene.remove(g);
        this.effects.delete(id);
      }
    }
  }

  /** Funnel smoke and snorkel haze drift downwind and fade; radars turn. */
  private animate(g: THREE.Group, t: number, kn: number, seed: number): void {
    const sm = g.userData.smoke as { puffs: THREE.Mesh<THREE.SphereGeometry, THREE.MeshLambertMaterial>[]; origin: THREE.Vector3 } | undefined;
    if (sm) {
      const n = sm.puffs.length;
      sm.puffs.forEach((p, i) => {
        const ph = (t * 0.12 + i / n + seed) % 1;
        // Apparent wind: the smoke streams aft at speed and drifts to one side
        p.position.set(sm.origin.x + ph * 14, sm.origin.y + ph * 16, sm.origin.z - ph * (8 + kn * 3));
        p.scale.setScalar(1.5 + ph * 7);
        p.material.opacity = 0.45 * (1 - ph);
      });
    }
    const radar = g.userData.radar as THREE.Mesh | undefined;
    if (radar) radar.rotation.y = t * 2.1 + seed * 6;
  }

  static supported(): boolean {
    try {
      return !!document.createElement('canvas').getContext('webgl2');
    } catch {
      return false;
    }
  }

  render(o: {
    bearing: number; fovDeg: number; t: number; sea: number; light: number; targets: PeriscopeTarget[];
    rain?: boolean; hour?: number; effects?: PeriscopeEffect[]; pitchDeg?: number; ownKn?: number; ownHeading?: number;
    /** Met cells (fog banks, squalls, ice) and the own position they are placed from. */
    met?: MetCells; own?: Vec2;
    /** Sea chart: land shows as coasts and mountains. */
    seabed?: SeabedSpec;
    /** The own ship's damage: she lists and trims, and the view with her. */
    ownWreck?: WreckView;
    missiles?: { list: SamView[]; me: { x: number; y: number } };
    /** Gyro-stabilised optic: the view ignores the ship's and the mast's motion (heave stays). */
    stabilize?: boolean;
    /** Hand-held binoculars: tremor amplitude (degrees), grows with magnification. */
    shake?: number;
  }): void {
    if (o.own) this.ownPos = o.own;
    this.terrain.update(o.seabed, this.ownPos);
    this.t = o.t;
    this.sea = o.sea;
    const w = this.canvas.clientWidth || 400;
    const h = this.canvas.clientHeight || 400;
    // Full retina resolution costs four times the fill rate for little gain behind scanlines
    const dpr = dprGl();
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(w, h, false);
    }
    const aspect = w / h;
    this.camera.aspect = aspect;
    const hf = (o.fovDeg * Math.PI) / 180;
    this.camera.fov = (2 * Math.atan(Math.tan(hf / 2) / aspect) * 180) / Math.PI;
    this.camera.updateProjectionMatrix();
    // The sea, fixed to the map: wind from the weather, phases from the own position
    const sw = (this.waves = seaWaves(o.sea, o.met?.wind, this.ownPos, o.t));
    const amp = sw.amp;
    const listRad = ((o.ownWreck?.list ?? 0) * Math.PI) / 180;
    const look = (o.bearing * Math.PI) / 180;
    this.camera.rotation.y = -look;
    let camPitch = ((o.pitchDeg ?? 0) * Math.PI) / 180;
    let camRoll = listRad;
    if (this.own) {
      // Bridge: the ship rides the waves; the eye moves with her bridge, the view tilts with her
      const hdg = o.ownHeading ?? 0;
      const m = this.ownMotion(hdg);
      const rel = look - (hdg * Math.PI) / 180;
      // The eye is a point of the ship: it rides her heave, pitch and roll (her lookout platform stays underfoot)
      this.placeOwn(hdg, m, listRad);
      this.camera.position.set(0, this.eye, this.own.bridgeZ).applyMatrix4(this.own.g.matrixWorld);
      if (!o.stabilize) {
        camPitch += m.pitch * Math.cos(rel) - m.roll * Math.sin(rel);
        camRoll += -m.roll * Math.cos(rel) - m.pitch * Math.sin(rel);
      } else camRoll = 0;
    } else {
      // Periscope: the head stands on the mast, the boat below barely feels the sea; spray and wash do the rest
      const hEye = waveHeight(sw, 0, 0);
      this.camera.position.set(0, this.eye + hEye * 0.3, 0);
      // A crest that climbs within about three metres of the head washes over it
      this.wash = Math.max(0, Math.min(1, (0.7 * hEye - (this.eye - 3)) / 1.2));
      if (!o.stabilize) {
        camPitch += Math.sin(o.t * 0.31) * 0.002 * (1 + o.sea);
        camRoll += Math.sin(o.t * 0.4) * 0.004 * (1 + o.sea * 0.6);
      }
    }
    // Hands on the glasses: a slow sway and a fine tremor (none when stabilised)
    const hand = handShake(o.t, o.stabilize ? 0 : o.shake ?? 0);
    camPitch += hand.pitch;
    this.camera.rotation.y += hand.yaw;
    this.camera.rotation.x = camPitch;
    this.camera.rotation.z = camRoll;

    const u = this.ocean.material.uniforms;
    u.uTime!.value = o.t;
    applyWaves(u, sw);
    applyWaves(wakeUniforms, sw);
    wakeUniforms.uTime!.value = o.t;
    wakeUniforms.uLight!.value = o.light;
    (wakeUniforms.uCell!.value as THREE.Vector2).copy(this.cell);
    u.uLight!.value = o.light;
    u.uFoam!.value = Math.max(0, Math.min(1, (o.sea - 2) / 4));
    // Inside a fog bank: everything goes white-grey within a few hundred meters
    const inFog = this.wx.update(o.met, o.own, o.t, o.light);
    const sky = this.skyFx.update({
      t: o.t, light: o.light, hour: o.hour ?? 12, sun: store.snap?.env.sun, sea: o.sea, rain: !!o.rain, inFog, met: o.met, own: this.ownPos,
      ownKn: o.ownKn ?? 0, ownHeading: o.ownHeading ?? 0, camera: this.camera,
    });
    u.uFog!.value = sky.haze;
    (u.uSky!.value as THREE.Color).copy(sky.reflect);
    (u.uSkyTop!.value as THREE.Color).copy(sky.reflectTop);
    u.uSun!.value = sky.sunDir;
    u.uMoon!.value = sky.moonDir;
    u.uSunUp!.value = sky.sunUp;
    u.uRain!.value = sky.precip;
    u.uSpin!.value = Math.max(0, Math.min(1, (o.sea - 4) / 2));
    this.sun.position.copy(sky.sunDir).multiplyScalar(10).setY(Math.max(0.3, sky.sunDir.y * 10));
    this.sun.color = sky.sunColor;
    // Overcast: flat, shadowless light; lightning lights everything for a blink
    this.hemi.intensity = (0.2 + 1.0 * o.light) * (1 - 0.3 * sky.overcast) + sky.flash * 1.5;
    this.sun.intensity = 1.2 * o.light * (1 - 0.75 * sky.overcast) * (1 - 0.8 * inFog);
    u.uFogDensity!.value = sky.fogDensity;
    (wakeUniforms.uFog!.value as THREE.Color).copy(sky.haze);
    wakeUniforms.uFogDensity!.value = sky.fogDensity;
    this.sigma = sky.fogDensity;
    this.scene.fog = new THREE.FogExp2(sky.haze, sky.fogDensity);
    this.updateEffects(o.effects ?? [], o.light);
    this.place(o.targets, o.t, o.sea, amp, o.light);
    this.slicks = updateSlicks(this.slicks, this.scene, o.t, this.ownPos.x, this.ownPos.y, o.light);
    this.fire.intensity = this.glow * 4;
    this.missiles.update(o.missiles?.list ?? [], o.missiles?.me ?? { x: 0, y: 0 }, o.t, o.light);
    if (this.own) {
      // The own hull was posed with the eye (above): wake, bow wave, smoke and radar
      const g = this.own.g;
      this.animate(g, o.t, o.ownKn ?? 12, 0.3);
      const bow = g.getObjectByName('bow');
      if (bow) bow.scale.setScalar(Math.max(0.2, (o.ownKn ?? 12) / 12));
      g.getObjectByName('wake')?.scale.set(1, 1, Math.max(0.05, (o.ownKn ?? 12) / 10));
    }
    this.renderer.render(this.scene, this.camera);
    if (this.nearCam) {
      // Nothing of the ship is closer than her own open bridge: draw it over the rest with a fresh depth buffer
      const nc = this.nearCam;
      nc.position.copy(this.camera.position);
      nc.quaternion.copy(this.camera.quaternion);
      nc.fov = this.camera.fov;
      nc.aspect = this.camera.aspect;
      nc.near = 0.05;
      nc.far = 40;
      nc.updateProjectionMatrix();
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.scene, nc);
      this.renderer.autoClear = true;
    }
  }

  /** Set the own ship's pose: bridge point over the origin, heading, motion and list. */
  private placeOwn(heading: number, m: { heave: number; pitch: number; roll: number }, listRad: number): void {
    const c = (heading * Math.PI) / 180;
    const g = this.own!.g;
    g.rotation.order = 'YXZ';
    g.rotation.y = Math.PI - c;
    g.rotation.x = -m.pitch;
    g.rotation.z = m.roll + listRad;
    g.position.set(-this.own!.bridgeZ * Math.sin(c), m.heave, this.own!.bridgeZ * Math.cos(c));
    g.updateMatrixWorld(true);
  }

  /** The own ship on the sea at the eye (bridge view): heave, pitch (bow up) and roll (port up). */
  private ownMotion(heading: number): { heave: number; pitch: number; roll: number } {
    const g = this.own!.g;
    const ud = g.userData as { len?: number; beam?: number };
    if (ud.len === undefined) {
      const size = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
      ud.len = size.z;
      ud.beam = size.x;
    }
    // Midships is bridgeZ aft of the eye
    const c = (heading * Math.PI) / 180;
    const r = hullOnSea(this.waves, -this.own!.bridgeZ * Math.sin(c), this.own!.bridgeZ * Math.cos(c), heading, ud.len, ud.beam ?? 14);
    return { heave: r.heave, pitch: r.pitch * 1.1, roll: r.roll * 0.9 + ownRoll(this.sea, ud.len, ud.beam ?? 14, this.t, 0.7) };
  }

  private place(targets: PeriscopeTarget[], t: number, sea: number, amp: number, light: number): void {
    const seen = new Set<string>();
    const burning = { n: 0 };
    for (const tg of targets) {
      // A sunk ship is only shown going down if it was in the picture
      if (tg.sunk) {
        if (this.ships.has(tg.label)) (this.ships.get(tg.label)!.g.userData as { doomed?: number }).doomed = 0;
        continue;
      }
      seen.add(tg.label);
      const key = `${tg.plane ?? tg.cls}|${tg.sighting ?? ''}`;
      let s = this.ships.get(tg.label);
      if (!s || s.key !== key) {
        if (s) this.scene.remove(s.g);
        s = { g: mergeStatic(tg.plane ? aircraftModel(tg.plane, tg.label) : tg.sighting ? sightingModel(tg.sighting, tg.cls) : shipModel(tg.cls, tg.label)), key, bearing: tg.bearing };
        // A ship seen before (key change, re-acquired) comes back without a fade
        s.born = this.ships.has(tg.label) ? -Infinity : t;
        this.ships.set(tg.label, s);
        this.scene.add(s.g);
      }
      s.bearing = tg.bearing;
      // Newly sighted: it comes out of the haze over a few seconds instead of popping in
      fadeModel(s.g, Math.min(1, (t - (s.born ?? -Infinity)) / FADE_IN_S));
      if (tg.plane) {
        // Aircraft: at its height (earth curvature taken off), nose along the course, rotors turning
        const b = (tg.bearing * Math.PI) / 180;
        const drop = (tg.range * tg.range) / (2 * EARTH_R);
        s.g.position.set(Math.sin(b) * tg.range, (tg.alt ?? 300) - drop, -Math.cos(b) * tg.range);
        s.g.rotation.y = Math.PI - ((tg.course ?? 0) * Math.PI) / 180;
        // Gentle banking with a fixed phase per aircraft (not tied to range, which changes every frame)
        s.g.rotation.z = tg.plane === 'helo' ? 0 : Math.sin(t * 0.2 + phaseOf(tg.label)) * 0.03;
        animateAircraft(s.g, t, light < 0.6);
        const navA = s.g.getObjectByName('navlights');
        if (navA) navA.visible = !!tg.lit && light < 0.6;
        const cabA = s.g.getObjectByName('cabinlights');
        if (cabA) cabA.visible = !!tg.lit && light < 0.6;
        s.g.visible = tg.alpha > 0.05;
        continue;
      }
      // Wake, bow wave and periscope feather follow the speed
      const kn = tg.speedKn ?? DEFAULT_KN[tg.cls] ?? 4;
      const wake = s.g.getObjectByName('wake');
      if (wake) wake.scale.set(1, 1, Math.max(0.05, kn / 10));
      const bow = s.g.getObjectByName('bow');
      if (bow) bow.scale.setScalar(Math.max(0.2, kn / 12));
      const feather = s.g.getObjectByName('feather');
      if (feather) feather.scale.set(Math.max(0.3, kn / 6), 1, Math.max(0.2, kn / 5));
      const seed = (tg.label.charCodeAt(1) || 0) / 10;
      this.animate(s.g, t, kn, seed);
      const b = (tg.bearing * Math.PI) / 180;
      // Earth curvature; the small lift keeps hulls from sinking into the wave crests at periscope height
      const drop = (tg.range * tg.range) / (2 * EARTH_R) - 0.4;
      // Ship motion: fixed phase per ship; roll period and amplitude follow its size and the sea state
      const ph = phaseOf(tg.label);
      const len = (s.g.userData.len as number | undefined) ?? (s.g.userData.len = new THREE.Box3().setFromObject(s.g).getSize(new THREE.Vector3()).z);
      const beam = (s.g.userData.beam as number | undefined) ?? (s.g.userData.beam = new THREE.Box3().setFromObject(s.g).getSize(new THREE.Vector3()).x);
      const course = tg.course ?? tg.bearing + 90;
      const sx = Math.sin(b) * tg.range, sz = -Math.cos(b) * tg.range;
      // Riding the waves where she is: heave, pitch and roll from the sea surface under her hull
      const ride = hullOnSea(this.waves, sx, sz, course, len, beam);
      s.g.position.set(sx, ride.heave - drop, sz);
      // Models are built bow toward +z; turn them so the bow points along the course (north = −z)
      s.g.rotation.y = Math.PI - (course * Math.PI) / 180;
      // Heading first, then pitch about the ship's own beam axis, then roll about its keel;
      // on top of the sea's tilt every hull rolls in her own rhythm (further in a rough sea)
      s.g.rotation.order = 'YXZ';
      s.g.rotation.z = ride.roll * 0.9 + ownRoll(sea, len, beam, t, ph);
      s.g.rotation.x = -ride.pitch * 1.15;
      // Damage: list, trim and settling; fire and smoke on deck (lights the night)
      const fire = applyWreck(s.g, tg.wreck, t, light, seed, burning);
      if (fire > 0 && fire * (1 - light) > this.glow) {
        this.glow = fire * (1 - light);
        this.fire.position.copy(s.g.position).setY(25);
      }
      const ud = s.g.userData as { wreck?: WreckView; wpos?: { x: number; y: number } };
      ud.wreck = tg.wreck;
      ud.wpos = { x: this.ownPos.x + s.g.position.x, y: this.ownPos.y - s.g.position.z };
      s.g.visible = tg.alpha > 0.05;
      const cab = s.g.getObjectByName('cabinlights');
      if (cab) cab.visible = !!tg.lit && light < 0.6;
      const nav = s.g.getObjectByName('navlights');
      if (nav) {
        nav.visible = !!tg.lit && light < 0.6;
        // A lamp is a point of high contrast: it carries about twice as far as the hull, then fades
        const k = Math.exp(-0.5 * this.sigma * tg.range);
        nav.traverse((o) => {
          const m = (o as THREE.Sprite).material as THREE.SpriteMaterial | undefined;
          if (m?.isSpriteMaterial) m.opacity = k;
        });
      }
    }
    for (const [label, s] of this.ships) {
      if (!seen.has(label)) {
        this.ships.delete(label);
        // A ship reported sinking goes down by the bow or stern with a list instead of popping
        // away, and leaves oil and wreckage on the water
        const ud = s.g.userData as { doomed?: number; wreck?: WreckView; wpos?: { x: number; y: number } };
        if (ud.doomed !== undefined && this.sinking.length < 6) {
          const seed = label.charCodeAt(label.length - 1) || 0;
          this.sinking.push(startSinking(s.g, t, ud.wreck, seed));
          const p = ud.wpos;
          const nearBlast = [...this.effects.values()].some((g) => g.position.distanceTo(s.g.position) < 300);
          if (p && !nearBlast) addSlick(this.slicks, this.scene, p.x, p.y, t, seed % 6);
        } else this.fading.push({ g: s.g, at: t });
      }
    }
    // Lost from sight: fade into the haze, then go
    this.fading = this.fading.filter((f) => {
      const k = 1 - (t - f.at) / FADE_OUT_S;
      if (k <= 0) {
        this.scene.remove(f.g);
        return false;
      }
      fadeModel(f.g, k);
      return true;
    });
    this.sinking = this.sinking.filter((k) => {
      const going = stepSinking(k, t);
      if (!going) this.scene.remove(k.g);
      return going;
    });
  }

  /** Free the GPU: geometry, materials and the WebGL context itself (browsers allow only a few). */
  dispose(): void {
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const x of mats) x.dispose();
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
