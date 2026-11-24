/** GLSL for the 3D sea view: a multi-wave ocean with whitecaps and glitter, and a sky with clouds, sun and moon. */

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
  wp.y += heightLod(wp.xz, uCell.x * pow(d, uCell.y));
  vPos = wp.xyz;
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
uniform vec3 uDeep; uniform vec3 uSky; uniform vec3 uSun; uniform vec3 uMoon; uniform vec3 uFog;
uniform float uFogDensity; uniform float uLight; uniform float uFoam; uniform float uSunUp;
uniform vec4 uIce[4];
varying vec3 vPos;
void main() {
  vec3 view = normalize(cameraPosition - vPos);
  // Per-pixel wave normal; trains shorter than the pixel footprint are left out (no shimmer far off)
  vec2 fw = fwidth(vPos.xz);
  // Geometric mean of the footprint: at grazing angles the long axis alone would flatten the near sea
  float foot = max(sqrt(fw.x * fw.y) * 1.6, 0.02);
  vec2 sl = slopeLod(vPos.xz, foot);
  vec3 n = normalize(vec3(-sl.x, 1.0, -sl.y));
  float vH = heightLod(vPos.xz, foot) / max(uAmp, 0.01);
  // Capillary ripples: high-frequency normal detail, fading with distance (gives the eye a sense of scale)
  float dist = length(cameraPosition - vPos);
  float near = 1.0 - smoothstep(60.0, 900.0, dist);
  if (near > 0.0) {
    // Fixed to the sea (own position added), drifting downwind
    vec2 q = vPos.xz + uOffR + uWind * uTime * 0.7;
    vec2 rip = vec2(noise(q) - 0.5, noise(q * 2.0 + 4.0) - 0.5);
    n = normalize(n + vec3(rip.x, 0.0, rip.y) * 0.35 * near);
  }
  float fres = pow(1.0 - max(dot(n, view), 0.0), 4.0);
  vec3 col = mix(uDeep, uSky, clamp(fres * 0.65, 0.0, 1.0));
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
    float m = 0.42 * chop + 0.18 * vH + 0.9 * pf - 0.9 + 0.3 * uFoam;
    float foam = smoothstep(0.0, 0.12, m) * smoothstep(0.25, 0.7, fine);
    float farF = 1.0 - smoothstep(400.0, 2500.0, dist);
    foam = mix(0.05 * uFoam, foam, farF) * uFoam;
    col = mix(col, vec3(0.86, 0.9, 0.92) * (0.25 + 0.75 * uLight), clamp(foam, 0.0, 1.0) * 0.85);
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
  float fog = 1.0 - exp(-pow(d * uFogDensity, 2.0));
  gl_FragColor = vec4(mix(col, uFog, fog), 1.0);
  #include <colorspace_fragment>
}`;

export const SKY_VERT = `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`;

export const SKY_FRAG = `${NOISE}
uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSun; uniform vec3 uMoon;
uniform float uLight; uniform float uCloud; uniform float uTime; uniform float uSunUp;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y * 3.5, 0.0, 1.0);
  vec3 col = mix(uHorizon, uTop, pow(h, 0.7));
  // Sun disc and glow, moon disc
  float s = max(dot(d, normalize(uSun)), 0.0);
  col += vec3(1.0, 0.85, 0.6) * (pow(s, 900.0) * 3.0 + pow(s, 12.0) * 0.25) * uSunUp;
  float m = max(dot(d, normalize(uMoon)), 0.0);
  col += vec3(0.85, 0.88, 0.95) * smoothstep(0.9993, 0.9996, m) * (1.0 - uSunUp);
  // Clouds: drifting fbm on a plane above, thinning toward the horizon
  if (d.y > 0.0) {
    vec2 uv = d.xz / (d.y + 0.08) * 1.6 + vec2(uTime * 0.004, uTime * 0.002);
    float c = smoothstep(1.0 - uCloud, 1.15 - uCloud * 0.6, fbm(uv));
    vec3 cloud = mix(vec3(0.55, 0.6, 0.63), vec3(0.92, 0.93, 0.94), fbm(uv * 1.7 + 3.0)) * (0.12 + 0.88 * uLight);
    col = mix(col, cloud, c * smoothstep(0.0, 0.18, d.y) * 0.9);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;
