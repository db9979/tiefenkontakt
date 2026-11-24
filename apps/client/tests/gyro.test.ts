import { describe, expect, it } from 'vitest';
import { lookFromOrientation } from '../src/widgets/gyro.js';

describe('phone orientation', () => {
  it('upright phone looks at the horizon; turning it turns the look; tilting raises it', () => {
    // Upright in portrait (beta 90): the back camera looks horizontally
    const a = lookFromOrientation(0, 90, 0);
    expect(a.elev).toBeCloseTo(0, 5);
    const b = lookFromOrientation(90, 90, 0);
    // Alpha grows counter-clockwise: turning left by 90° moves the look 90° to the left
    expect(((a.yaw - b.yaw + 360) % 360)).toBeCloseTo(90, 5);
    // Tilted back (beta 120): the camera looks up 30°
    expect(lookFromOrientation(0, 120, 0).elev).toBeCloseTo(30, 5);
    // Flat on the table (beta 0): it looks straight down
    expect(lookFromOrientation(0, 0, 0).elev).toBeCloseTo(-90, 5);
  });
});
