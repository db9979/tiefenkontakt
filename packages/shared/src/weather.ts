import type { Environment } from './acoustics.js';
import type { Rng } from './rng.js';
import { lightFromSun, sunPosition } from './climate.js';
import { envMoonlight } from './moon.js';

/**
 * Changing weather: the clock runs (daylight follows it), sea state drifts,
 * rain squalls come and go, and the layer moves (afternoon sun makes it shallower,
 * strong wind mixes it deeper). A layer measured an hour ago is no longer exact.
 */

export interface WeatherState {
  /** Hour of day (0..24). */
  clock: number;
  dynamic: boolean;
  rainUntil: number;
  nextChange: number;
  /** Layer depth without the diurnal swing (the swing is added on top). */
  baseLayer: number;
}

const STEP_S = 60;
export const RAIN_NOISE_DB = 6;

/**
 * Meteorological visibility (m): the distance at which a large dark object still stands out
 * from the horizon sky by day (2 % contrast, Koschmieder). Clean polar air at sea reaches
 * about 30 km; spray haze cuts it as the sea builds; in rain it drops to about 6 km.
 * `rain` may be a fraction (0..1) for a picture that fades in and out of a shower.
 * Fog banks come on top (met.ts), and so does darkness.
 */
export const VIS_CLEAR_M = 30_000;
export const VIS_RAIN_M = 6_000;
export function metVisibility(seaState: number, rain: boolean | number): number {
  const clear = VIS_CLEAR_M / (1 + 0.12 * Math.max(0, seaState - 2));
  const r = typeof rain === 'number' ? Math.max(0, Math.min(1, rain)) : rain ? 1 : 0;
  return Math.exp(Math.log(clear) + (Math.log(Math.min(clear, VIS_RAIN_M)) - Math.log(clear)) * r);
}

/** Daylight 0..1 from the hour of day (dawn 5-7, dusk 18-20). */
export function daylight(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 7 && h <= 18) return 1;
  if (h <= 5 || h >= 20) return 0.12;
  return h < 7 ? 0.12 + ((h - 5) / 2) * 0.88 : 0.12 + ((20 - h) / 2) * 0.88;
}

export function initWeather(env: Environment, startHour: number, dynamic: boolean): WeatherState {
  return { clock: startHour, dynamic, rainUntil: 0, nextChange: 1200, baseLayer: env.layerDepth };
}

/** Advance weather by dt seconds of sim time. */
export function stepWeather(env: Environment & { weather?: WeatherState; rain?: boolean }, time: number, dt: number, rng: Rng): void {
  const wx = env.weather;
  if (!wx) return;
  const next = wx.clock + dt / 3600;
  // Past midnight the date rolls on (the moon's age)
  if (next >= 24 && env.day !== undefined) env.day += Math.floor(next / 24);
  wx.clock = next % 24;
  env.light = env.lat !== undefined && env.month ? lightFromSun(sunPosition(env.lat, env.month, wx.clock).el) : daylight(wx.clock);
  // Moonlight changes slowly: every half minute, or at once when it is not set yet
  if (env.day !== undefined && (env.moon === undefined || Math.floor((time - dt) / 30) !== Math.floor(time / 30))) env.moon = envMoonlight(env);
  if (!wx.dynamic || Math.floor((time - dt) / STEP_S) === Math.floor(time / STEP_S)) return;
  env.rain = time < wx.rainUntil;
  if (time >= wx.nextChange) {
    wx.nextChange = time + 1200 + rng.next() * 1800;
    // Sea state drifts by one step, biased toward the middle
    const drift = rng.next() < 0.5 ? -1 : 1;
    env.seaState = Math.max(1, Math.min(6, env.seaState + (env.seaState >= 5 ? -1 : env.seaState <= 1 ? 1 : drift)));
    // With local squalls on the map (met.ts) showers come from those instead of map-wide rain
    if (rng.next() < 0.35 && !env.met) wx.rainUntil = time + 600 + rng.next() * 900;
  }
  // Strong wind mixes the layer deeper; calm lets it rise slowly back
  if (wx.baseLayer > 0) wx.baseLayer = Math.max(40, Math.min(220, wx.baseLayer + (env.seaState >= 5 ? 1 : env.seaState <= 2 ? -0.5 : 0)));
  // Afternoon sun makes the layer shallower by up to ~8 m
  const sun = Math.max(0, Math.sin(((wx.clock - 9) / 12) * Math.PI));
  if (env.layerDepth > 0) env.layerDepth = Math.round(wx.baseLayer - 8 * sun);
}
