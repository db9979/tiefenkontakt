import type { Environment } from './acoustics.js';
import type { Rng } from './rng.js';

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
  wx.clock = (wx.clock + dt / 3600) % 24;
  env.light = daylight(wx.clock);
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
