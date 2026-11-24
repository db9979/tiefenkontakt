import { PadMapper, type PadAction } from './gamepad-map.js';
import { toast } from './screens/account.js';

/**
 * Gamepad support (browser Gamepad API, standard mapping). A requestAnimationFrame loop
 * polls the first connected pad and runs only while one is connected. Actions go to the
 * target the game screen registers; outside a match the pad does nothing.
 */
export interface PadTarget {
  /** Ordered heading of the own ship, undefined before the first snapshot. */
  orderedHeading(): number | undefined;
  course(heading: number): void;
  nudge(d: { heading?: number; speedKn?: number; depth?: number }): void;
  station(delta: number): void;
  menu(): void;
  help(): void;
}

let target: PadTarget | undefined;

/** Register the receiver of pad actions; returns the unregister function. */
export function setPadTarget(t: PadTarget): () => void {
  target = t;
  return () => {
    if (target === t) target = undefined;
  };
}

function dispatch(t: PadTarget, a: PadAction): void {
  switch (a.kind) {
    case 'course': return t.course(a.heading);
    case 'turn': return t.nudge({ heading: a.delta });
    case 'speed': return t.nudge({ speedKn: a.delta });
    case 'depth': return t.nudge({ depth: a.delta });
    case 'station': return t.station(a.delta);
    case 'menu': return t.menu();
    case 'help': return t.help();
  }
}

const pads = (): Gamepad[] => (navigator.getGamepads?.() ?? []).filter((p): p is Gamepad => !!p && p.connected);

export function installGamepad(): void {
  if (typeof navigator.getGamepads !== 'function') return;
  let raf = 0;
  let mapper = new PadMapper();
  const poll = (now: number) => {
    const pad = pads()[0];
    if (!pad) {
      raf = 0;
      return;
    }
    raf = requestAnimationFrame(poll);
    const actions = mapper.step(pad, now, target?.orderedHeading());
    if (target && !document.hidden) for (const a of actions) dispatch(target, a);
  };
  const start = () => {
    if (!raf) {
      mapper = new PadMapper();
      raf = requestAnimationFrame(poll);
    }
  };
  window.addEventListener('gamepadconnected', () => {
    toast('Gamepad verbunden');
    start();
  });
  window.addEventListener('gamepaddisconnected', () => {
    toast('Gamepad getrennt');
    if (!pads().length && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  });
  // A pad already in use before the page loaded (Chrome reports it after the first button press)
  if (pads().length) start();
}
