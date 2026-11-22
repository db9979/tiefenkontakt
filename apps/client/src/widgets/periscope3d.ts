import * as THREE from 'three';
import type { ClassId, Sighting } from '@tk/shared';
import { shipModel, sightingModel } from './sea3d/models.js';
import { OCEAN_FRAG, OCEAN_VERT, SKY_FRAG, SKY_VERT } from './sea3d/shaders.js';
import { createAftermath, updateAftermath } from './sea3d/aftermath.js';
import { dprGl, oceanSegments } from './perf.js';

/**
 * 3D sea view used by the periscope (eye 4 m) and the escorts' bridge (eye 20 m):
 * multi-wave ocean with whitecaps and glitter, sky with clouds, sun and moon,
 * ship models placed from (filtered) bearing/range and sunk by earth curvature.
 * The 2D reticle or binocular mask is drawn on top by the station.
 */

const EARTH_R = 6_371_000;

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
}

/** A detonation seen through the optic (from a hit/sunk report): water column, smoke, fire. */
export interface PeriscopeEffect {
  id: string;
  bearing: number;
  range: number;
  age: number;
}

const DEFAULT_KN: Partial<Record<ClassId, number>> = { merchant: 9, ffg: 14, kor: 14 };

interface Placed { g: THREE.Group; key: string; bearing: number }

export class Periscope3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 1, 60_000);
  private ocean: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private hemi = new THREE.HemisphereLight(0xb8c8d0, 0x1a2a30, 1.2);
  private sun = new THREE.DirectionalLight(0xffffff, 1.2);
  private ships = new Map<string, Placed>();
  private sinking: { g: THREE.Group; since: number; y0: number }[] = [];
  private effects = new Map<string, THREE.Group>();
  private stars: THREE.Points;
  private rain: THREE.LineSegments;
  private fire = new THREE.PointLight(0xff7a30, 0, 6000, 1.2);
  /** Eye height above the water (m): 4 for a periscope, about 20 on a frigate's bridge. */
  private eye: number;
  /** Own ship around the camera (bridge view): model and how far forward of midships the bridge is. */
  private own?: { g: THREE.Group; bridgeZ: number };

  constructor(private canvas: HTMLCanvasElement, opts: { eye?: number; own?: ClassId } = {}) {
    this.eye = opts.eye ?? 4;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x24343b);
    this.camera.rotation.order = 'YXZ';
    this.ocean = new THREE.Mesh(
      new THREE.PlaneGeometry(40_000, 40_000, oceanSegments(), oceanSegments()),
      new THREE.ShaderMaterial({
        vertexShader: OCEAN_VERT, fragmentShader: OCEAN_FRAG,
        uniforms: {
          uTime: { value: 0 }, uAmp: { value: 1 }, uDeep: { value: new THREE.Color(0x10303a) }, uSky: { value: new THREE.Color(0x5a7078) },
          uSun: { value: new THREE.Vector3(0.3, 0.5, -0.8) }, uMoon: { value: new THREE.Vector3(-0.3, 0.4, 0.8) }, uFog: { value: new THREE.Color(0x4b5f67) },
          uFogDensity: { value: 0.00006 }, uLight: { value: 1 }, uFoam: { value: 0 }, uSunUp: { value: 1 },
        },
      }),
    );
    this.ocean.rotation.x = -Math.PI / 2;
    this.scene.add(this.ocean);
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(50_000, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false,
        uniforms: {
          uTop: { value: new THREE.Color(0x24343b) }, uHorizon: { value: new THREE.Color(0x56707a) }, uSun: { value: new THREE.Vector3(0, 1, 0) },
          uMoon: { value: new THREE.Vector3(0, 1, 0) }, uLight: { value: 1 }, uCloud: { value: 0.4 }, uTime: { value: 0 }, uSunUp: { value: 1 },
        },
      }),
    );
    this.scene.add(this.sky);
    this.scene.add(this.hemi, this.sun, this.fire);
    // Stars on the upper sky dome (visible only at night)
    const sp: number[] = [];
    for (let i = 0; i < 900; i++) {
      const az = Math.random() * Math.PI * 2;
      const el = Math.asin(Math.random() * 0.95 + 0.02);
      sp.push(Math.cos(el) * Math.sin(az) * 45_000, Math.sin(el) * 45_000, -Math.cos(el) * Math.cos(az) * 45_000);
    }
    this.stars = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)),
      new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false }));
    this.scene.add(this.stars);
    // Rain: short streaks in a box around the optic, moved every frame
    const rp: number[] = [];
    for (let i = 0; i < 1400; i++) {
      const x = (Math.random() - 0.5) * 120;
      const y = Math.random() * 40;
      const z = -Math.random() * 120;
      rp.push(x, y, z, x + 0.15, y - 2.2, z);
    }
    this.rain = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)),
      new THREE.LineBasicMaterial({ color: 0xb8c8cc, transparent: true, opacity: 0.35, fog: false }));
    this.rain.visible = false;
    this.camera.add(this.rain);
    this.scene.add(this.camera);
    if (opts.own) {
      // Foredeck, gun and bridge front in the lower part of the picture: the eye sits on the bridge roof
      const g = shipModel(opts.own);
      for (const n of ['wake']) g.getObjectByName(n)?.removeFromParent();
      this.own = { g, bridgeZ: opts.own === 'kor' ? 23 : 31 };
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
        g = this.effectGroup();
        this.effects.set(e.id, g);
        this.scene.add(g);
        // The ship nearest to the blast in bearing starts to sink once it drops out of the picture
        for (const s of this.ships.values()) if (Math.abs(((s.bearing - e.bearing + 540) % 360) - 180) < 4) (s.g.userData as { doomed?: number }).doomed = e.age;
      }
      const b = (e.bearing * Math.PI) / 180;
      const drop = (e.range * e.range) / (2 * EARTH_R);
      g.position.set(Math.sin(b) * e.range, -drop, -Math.cos(b) * e.range);
      const water = g.getObjectByName('water') as THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>;
      const rise = Math.min(1, e.age / 2.5);
      const fall = Math.max(0, 1 - Math.max(0, e.age - 4) / 6);
      water.scale.set(1 + e.age * 0.25, Math.max(0.01, rise * fall), 1 + e.age * 0.25);
      water.position.y = 45 * rise * fall;
      water.material.opacity = 0.9 * fall;
      for (let i = 0; i < 7; i++) {
        const puff = g.getObjectByName(`smoke${i}`) as THREE.Mesh<THREE.SphereGeometry, THREE.MeshLambertMaterial>;
        const a = Math.max(0, e.age - 2 - i * 1.5);
        puff.visible = a > 0;
        puff.scale.setScalar(8 + a * 2.5 + i * 2);
        puff.position.set(a * 3 + i * 2, 15 + a * 6 + i * 10, Math.sin(i) * 6);
        puff.material.opacity = Math.max(0, 0.75 - a / 120);
      }
      const am = g.getObjectByName('aftermath') as THREE.Group;
      updateAftermath(am, e.age, performance.now() / 1000, light, (e.bearing * 7) % 6);
      // Burning oil keeps lighting the scene at night for a few minutes
      if (e.age < 240) glow = Math.max(glow, (1 - light) * (1 - e.age / 240));
      if (glow > 0) this.fire.position.copy(g.position).setY(20);
    }
    this.fire.intensity = glow * 4;
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
  }): void {
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
    // Swell: the boat (and the optic) heave, pitch and roll; a high bridge moves less but sways more
    // Wave amplitude (m) by sea state: SS3 ≈ 1.4 m significant wave height
    const amp = 0.12 + o.sea * 0.2;
    const high = this.eye > 10;
    this.camera.position.set(0, this.eye + Math.sin(o.t * 0.55) * amp * (high ? 0.25 : 0.4), 0);
    this.camera.rotation.y = (-o.bearing * Math.PI) / 180;
    this.camera.rotation.x = ((o.pitchDeg ?? 0) * Math.PI) / 180 + Math.sin(o.t * 0.31) * 0.002 * (1 + o.sea);
    this.camera.rotation.z = Math.sin(o.t * 0.4) * (high ? 0.007 : 0.004) * (1 + o.sea * 0.6);

    const u = this.ocean.material.uniforms;
    u.uTime!.value = o.t;
    u.uAmp!.value = amp;
    u.uLight!.value = o.light;
    u.uFoam!.value = Math.max(0, Math.min(1, (o.sea - 2) / 4));
    const haze = new THREE.Color(0x7f939b).multiplyScalar(0.06 + 0.94 * o.light * o.light);
    u.uFog!.value = haze;
    // Dusk and dawn tint the horizon orange; the sun stands low in the west or east
    const dusk = o.light > 0.15 && o.light < 0.9 ? 1 - Math.abs(o.light - 0.5) * 2 : 0;
    // Night: a dark sky with only a faint glow at the horizon
    const horizon = new THREE.Color(0x8fa3ab).lerp(new THREE.Color(0xd08a5a), dusk * 0.7).multiplyScalar(0.06 + 0.94 * o.light * o.light);
    const su = this.sky.material.uniforms;
    su.uHorizon!.value = o.rain ? horizon.clone().lerp(new THREE.Color(0x5c666a), 0.6) : horizon;
    su.uTop!.value = new THREE.Color(0x3d5560).multiplyScalar((0.05 + 0.95 * o.light * o.light) * (o.rain ? 0.7 : 1));
    const hour = o.hour ?? 12;
    const sunAz = ((hour - 6) / 12) * Math.PI; // east at 6 h, south at noon, west at 18 h
    const sunEl = Math.sin(((hour - 6) / 12) * Math.PI) * 0.8;
    this.sun.position.set(Math.cos(sunAz) * 10, Math.max(0.03, sunEl) * 10, Math.sin(sunAz) * 10);
    const sunDir = new THREE.Vector3(Math.cos(sunAz), sunEl, Math.sin(sunAz)).normalize();
    const moonDir = new THREE.Vector3(-Math.cos(sunAz), 0.35, -Math.sin(sunAz)).normalize();
    const sunUp = Math.max(0, Math.min(1, sunEl * 6 + 0.2)) * (o.rain ? 0.2 : 1);
    u.uSun!.value = sunDir;
    u.uMoon!.value = moonDir;
    u.uSunUp!.value = sunUp;
    su.uSun!.value = sunDir;
    su.uMoon!.value = moonDir;
    su.uSunUp!.value = sunUp;
    su.uLight!.value = o.light;
    su.uTime!.value = o.t;
    su.uCloud!.value = o.rain ? 0.85 : 0.3 + o.sea * 0.06;
    this.sun.color = new THREE.Color(0xffffff).lerp(new THREE.Color(0xffb070), dusk);
    this.hemi.intensity = 0.2 + 1.0 * o.light;
    this.sun.intensity = 1.2 * o.light * (o.rain ? 0.4 : 1);
    (this.stars.material as THREE.PointsMaterial).opacity = o.rain ? 0 : Math.max(0, 1 - o.light * 3) * 0.9;
    const fogDensity = 0.000022 * (1 + o.sea * 0.2) * (o.rain ? 2.2 : 1);
    u.uFogDensity!.value = fogDensity;
    this.scene.fog = new THREE.FogExp2(haze, fogDensity);
    this.rain.visible = !!o.rain;
    if (o.rain) this.rain.position.y = -((o.t * 22) % 30);
    this.updateEffects(o.effects ?? [], o.light);
    this.place(o.targets, o.t, o.sea, amp, o.light);
    if (this.own) {
      // Keep the own hull under the camera: the bridge point sits below the eye, the ship heaves and rolls with it
      const c = ((o.ownHeading ?? 0) * Math.PI) / 180;
      const g = this.own.g;
      g.rotation.y = Math.PI - c;
      g.position.set(-this.own.bridgeZ * Math.sin(c), this.camera.position.y - this.eye, this.own.bridgeZ * Math.cos(c));
      g.rotation.z = this.camera.rotation.z;
      this.animate(g, o.t, o.ownKn ?? 12, 0.3);
      const bow = g.getObjectByName('bow');
      if (bow) bow.scale.setScalar(Math.max(0.2, (o.ownKn ?? 12) / 12));
    }
    this.renderer.render(this.scene, this.camera);
  }

  private place(targets: PeriscopeTarget[], t: number, sea: number, amp: number, light: number): void {
    const seen = new Set<string>();
    for (const tg of targets) {
      seen.add(tg.label);
      const key = `${tg.cls}|${tg.sighting ?? ''}`;
      let s = this.ships.get(tg.label);
      if (!s || s.key !== key) {
        if (s) this.scene.remove(s.g);
        s = { g: tg.sighting ? sightingModel(tg.sighting, tg.cls) : shipModel(tg.cls), key, bearing: tg.bearing };
        this.ships.set(tg.label, s);
        this.scene.add(s.g);
      }
      s.bearing = tg.bearing;
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
      const drop = (tg.range * tg.range) / (2 * EARTH_R) - 2;
      const bob = Math.sin(t * 0.5 + tg.label.length) * amp * 0.4;
      s.g.position.set(Math.sin(b) * tg.range, bob - drop, -Math.cos(b) * tg.range);
      // Models are built bow toward +z; turn them so the bow points along the course (north = −z)
      s.g.rotation.y = Math.PI - ((tg.course ?? tg.bearing + 90) * Math.PI) / 180;
      s.g.rotation.z = Math.sin(t * 0.45 + tg.range) * 0.02 * (1 + sea * 0.5);
      s.g.visible = tg.alpha > 0.05;
      const nav = s.g.getObjectByName('navlights');
      if (nav) nav.visible = !!tg.lit && light < 0.6;
    }
    for (const [label, s] of this.ships) {
      if (!seen.has(label)) {
        this.ships.delete(label);
        // A ship hit shortly before it vanished goes down by the bow instead of popping away
        if ((s.g.userData as { doomed?: number }).doomed !== undefined) this.sinking.push({ g: s.g, since: t, y0: s.g.position.y });
        else this.scene.remove(s.g);
      }
    }
    this.sinking = this.sinking.filter((k) => {
      const a = t - k.since;
      k.g.rotation.x = Math.min(0.35, a * 0.01);
      k.g.position.y = k.y0 - a * 0.35;
      if (a > 90) this.scene.remove(k.g);
      return a <= 90;
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
