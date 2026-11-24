/** GLSL for the 3D sea view: a multi-wave ocean with whitecaps, spindrift, rain-pocked surface and glitter (sky in sky.ts). */

import { WAVES_GLSL } from './waves.js';

/** The wave field (uniforms from waves.ts: waveUniforms/applyWaves). */
export const WAVES = WAVES_GLSL;

/** Ocean grid: displaced by the waves the grid cell can carry (cell ≈ uCell.x · d^uCell.y). */
export const OCEAN_VERT = `${WAVES}
uniform vec2 uCell;
varying vec3 vPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float d = max(max(abs(wp.x), abs(wp.z)), 1.0);
  float cell = uCell.x * pow(d, uCell.y);
  wp.y += heightLod(wp.xz, cell);
  // Sharpen the crests: the vertex slides toward the nearest crest (vPos keeps the sea point)
  vPos = wp.xyz;
  wp.xz += chopShift(wp.xz, cell);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

export const NOISE = `
float hash(vec2 p) { p = mod(p, 1024.0); return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; } return v; }`;

export const OCEAN_FRAG = `${NOISE}${WAVES}
uniform float uTime; uniform vec2 uWind; uniform vec2 uOffR; uniform vec2 uOffW;
uniform vec3 uDeep; uniform vec3 uSky; uniform vec3 uSkyTop; uniform vec3 uSun; uniform vec3 uMoon; uniform vec3 uFog;
uniform float uFogDensity; uniform float uLight; uniform float uFoam; uniform float uSunUp; uniform float uRain; uniform float uSpin;
uniform vec4 uIce[4];
varying vec3 vPos;
void main() {
  vec3 view = normalize(cameraPosition - vPos);
  // Per-pixel wave normal; trains shorter than the pixel footprint are left out (no shimmer far off)
  vec2 fw = fwidth(vPos.xz);
  // Geometric mean of the footprint: at grazing angles the long axis alone would flatten the near sea
  float foot = max(sqrt(fw.x * fw.y) * 4.0, 0.05);
  vec2 sl = slopeLod(vPos.xz, foot);
  // Slopes a touch steeper than linear theory: the sharpened crests are steeper than the sines
  vec3 n = normalize(vec3(-sl.x * 1.2, 1.0, -sl.y * 1.2));
  float vH = heightLod(vPos.xz, foot) / max(uAmp, 0.01);
  // Capillary ripples: high-frequency normal detail, fading with distance (gives the eye a sense of scale)
  float dist = length(cameraPosition - vPos);
  float near = 1.0 - smoothstep(60.0, 900.0, dist);
  if (near > 0.0) {
    // Fixed to the sea (own position added), drifting downwind
    vec2 q = vPos.xz + uOffR + uWind * uTime * 0.7;
    vec2 rip = vec2(noise(q) - 0.5, noise(q * 2.0 + 4.0) - 0.5);
    n = normalize(n + vec3(rip.x, 0.0, rip.y) * 0.12 * near);
  }
  // Rain pocks the surface close by: fine, fast-changing roughness that dulls the mirror
  float pock = uRain * (1.0 - smoothstep(0.1, 0.75, foot)) * (1.0 - smoothstep(80.0, 450.0, dist));
  if (pock > 0.0) {
    vec2 rq = (vPos.xz + uOffR) * 3.0;
    vec2 sp = vec2(noise(rq + uTime * 11.0), noise(rq * 1.7 - uTime * 9.0)) - 0.5;
    n = normalize(n + vec3(sp.x, 0.0, sp.y) * 0.8 * pock);
  }
  float fres = pow(1.0 - max(dot(n, view), 0.0), 4.0);
  // Mirror of the sky: a face tilted toward the eye reflects the darker sky overhead, one tilted
  // away the bright horizon; that light-dark pattern is what makes the swell read
  vec3 rv = reflect(-view, n);
  vec3 skyR = mix(uSky, uSkyTop, smoothstep(0.0, 0.7, rv.y));
  vec3 col = mix(uDeep, skyR, clamp(0.08 + fres * 0.85, 0.0, 1.0));
  // Subsurface green on wave flanks facing the light
  col += vec3(0.02, 0.07, 0.06) * max(0.0, vH) * uLight;
  vec3 r = reflect(-view, n);
  // Sun glitter: a sharp core and a broad sheen, a long path when the sun is low
  float sd = max(dot(r, normalize(uSun)), 0.0);
  col += vec3(1.0, 0.92, 0.8) * (pow(sd, 400.0) * 1.4 + pow(sd, 30.0) * 0.12) * uSunUp;
  // Moonlight path at night
  float md = max(dot(r, normalize(uMoon)), 0.0);
  col += vec3(0.75, 0.8, 0.9) * pow(md, 160.0) * (1.0 - uSunUp) * 0.9;
  col *= 0.12 + 0.88 * uLight * uLight;
  // Whitecaps: small breaking patches on the steep short crests, scattered by a patch field and
  // drawn out downwind; far off they blend into a faint mean brightening (no shimmer)
  if (uFoam > 0.0) {
    vec2 wq = vec2(dot(vPos.xz, uWind), dot(vPos.xz, vec2(-uWind.y, uWind.x))) + uOffW;
    float chop = chopLod(vPos.xz, foot);
    float pf = fbm(wq * vec2(0.0625, 0.125) + vec2(uTime * 0.03, 0.0));
    float fine = noise((vPos.xz + uOffR) * 0.5 + uWind * uTime * 0.4);
    float m = 0.42 * chop + 0.12 * vH + 0.9 * pf - 1.0 + 0.3 * uFoam;
    float foam = smoothstep(0.0, 0.12, m) * smoothstep(0.25, 0.7, fine);
    float farF = 1.0 - smoothstep(400.0, 2500.0, dist);
    foam = mix(0.05 * uFoam, foam, farF) * uFoam;
    // Gale: spindrift, long foam streaks blown out along the wind
    if (uSpin > 0.0) {
      // Wavy lanes a few metres apart, broken into patches; left out where a pixel spans a lane
      vec2 sq = wq + vec2(0.0, (noise(wq * 0.05) - 0.5) * 14.0);
      float lane = noise(sq * vec2(0.03, 0.45) + vec2(uTime * 0.05, 0.0));
      float patchy = smoothstep(0.4, 0.75, noise(wq * vec2(0.012, 0.05) + 9.0));
      float sharp = 1.0 - smoothstep(0.6, 2.5, foot);
      foam += uSpin * mix(0.08, smoothstep(0.6, 0.82, lane) * patchy * 0.45, sharp) * farF;
    }
    col = mix(col, vec3(0.86, 0.9, 0.92) * (0.1 + 0.9 * uLight), clamp(foam, 0.0, 1.0) * 0.85);
  }
  // Pack ice beyond the modelled floes: a floe pattern drifting with its field (x, z, radius, cover)
  float icec = 0.0; vec2 iceL = vec2(0.0);
  for (int i = 0; i < 4; i++) {
    vec4 f = uIce[i];
    if (f.w <= 0.0) continue;
    float k = clamp((f.z - length(vPos.xz - f.xy)) / 2000.0 + 0.5, 0.0, 1.0) * f.w;
    if (k > icec) { icec = k; iceL = vPos.xz - f.xy; }
  }
  if (icec > 0.0) {
    float pat = noise(iceL * 0.045) * 0.65 + noise(iceL * 0.13) * 0.35;
    float floe = smoothstep(1.0 - icec - 0.05, 1.0 - icec + 0.05, pat);
    // Far off the pattern would only flicker: blend to the mean cover
    floe = mix(floe, icec * 0.85, smoothstep(3500.0, 8000.0, dist)) * smoothstep(1700.0, 2600.0, dist);
    col = mix(col, vec3(0.84, 0.9, 0.94) * (0.12 + 0.88 * uLight * uLight), floe);
  }
  float d = length(cameraPosition - vPos);
  float fog = 1.0 - exp(-d * uFogDensity);
  gl_FragColor = vec4(mix(col, uFog, fog), 1.0);
  #include <colorspace_fragment>
}`;
