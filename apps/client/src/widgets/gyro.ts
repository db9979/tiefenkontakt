/**
 * Phone orientation → where its back camera looks: compass-like yaw (degrees clockwise from the
 * sensor's north) and elevation (degrees above the horizon). W3C DeviceOrientation (alpha about
 * z, beta about x, gamma about y; earth frame x east, y north, z up). The yaw is relative unless
 * the browser gives absolute alpha; the phone view calibrates it against the ship ("Voraus").
 */
export function lookFromOrientation(alpha: number, beta: number, gamma: number): { yaw: number; elev: number } {
  const r = Math.PI / 180;
  const cx = Math.cos(beta * r), sx = Math.sin(beta * r);
  const cy = Math.cos(gamma * r), sy = Math.sin(gamma * r);
  const cz = Math.cos(alpha * r), sz = Math.sin(alpha * r);
  // Third column of the rotation matrix: the device z axis in the earth frame; the camera looks along −z
  const m13 = cy * sz * sx + cz * sy;
  const m23 = sz * sy - cz * cy * sx;
  const m33 = cx * cy;
  const vx = -m13, vy = -m23, vz = -m33;
  const yaw = ((Math.atan2(vx, vy) / r) + 360) % 360;
  const elev = Math.asin(Math.max(-1, Math.min(1, vz))) / r;
  return { yaw, elev };
}

/** Shortest signed difference b − a in degrees (−180..180). */
export const turnFrom = (a: number, b: number) => ((b - a + 540) % 360) - 180;
