import { describe, expect, it } from 'vitest';
import { DEFAULT_ENV, createShip, createWorld } from '@tk/shared';
import { applyCommand, parseClientMsg, type GameCommand } from '../src/input.js';

function setup() {
  const sub = createShip({ id: 'p_p', cls: 'ssk', name: 'U', pos: { x: 0, y: 0 }, heading: 0, speedKn: 6, playerId: 'p' });
  const w = createWorld([sub], 1, DEFAULT_ENV);
  const send = (raw: object) => {
    const m = parseClientMsg(JSON.stringify(raw));
    if (!m) return 'invalid';
    return applyCommand(w, sub, m as GameCommand);
  };
  return { sub, send };
}

describe('route message', () => {
  it('plots, turns on, and a helm order by hand turns it off', () => {
    const { sub, send } = setup();
    expect(send({ t: 'route', wps: [{ x: 0, y: 5000, speedKn: 8 }, { x: 4000, y: 5000, depth: 120 }], active: true })).toBeUndefined();
    expect(sub.route?.active).toBe(true);
    expect(sub.route?.wps).toHaveLength(2);
    // Speed and depth by hand leave the route on
    expect(send({ t: 'order', speedKn: 4, depth: 80 })).toBeUndefined();
    expect(sub.route?.active).toBe(true);
    // A course by hand takes the boat off the route; the waypoints stay
    expect(send({ t: 'order', heading: 270 })).toBeUndefined();
    expect(sub.route?.active).toBe(false);
    expect(sub.order.heading).toBe(270);
    expect(sub.route?.wps).toHaveLength(2);
  });

  it('rejects bad waypoints', () => {
    const { send } = setup();
    expect(send({ t: 'route', wps: [{ x: Number.MAX_VALUE, y: 0 }] })).toBe('invalid');
    expect(send({ t: 'route', wps: [{ x: 0, y: 0, speedKn: -3 }] })).toBe('invalid');
    expect(send({ t: 'route', wps: Array.from({ length: 21 }, () => ({ x: 0, y: 0 })) })).toBe('invalid');
    expect(send({ t: 'route', idx: 1.5 })).toBe('invalid');
  });

  it('turning on without waypoints is refused', () => {
    const { send } = setup();
    expect(send({ t: 'route', active: true })).toBe('Keine Wegpunkte geplottet');
  });
});
