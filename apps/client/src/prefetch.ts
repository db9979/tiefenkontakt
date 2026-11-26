/**
 * Code split for a fast first start: the login carries only the core; the lobby and the game
 * screen (stations, plots, sonar) are chunks of their own. The lobby is fetched as soon as the
 * login is on screen, the game screen first thing in the lobby.
 */
let lobby: Promise<typeof import('./screens/lobby.js')> | undefined;
let game: Promise<typeof import('./screens/game.js')> | undefined;
// A failed fetch (offline for a moment) is tried again on the next call
export const loadLobby = () => (lobby ??= import('./screens/lobby.js').catch((e: unknown) => {
  lobby = undefined;
  throw e;
}));
export const loadGame = () => (game ??= import('./screens/game.js').catch((e: unknown) => {
  game = undefined;
  throw e;
}));

/**
 * Background warm-up while the player is in the lobby or reading the briefing: the game
 * screen first, then the lazy chunks (3D view and models, recognition renderer, voice server
 * client) one after another when the browser is idle, and the 3D shaders are compiled once in a small
 * throwaway scene (the GPU driver keeps the compiled programs, so the first periscope or
 * bridge view no longer stalls). Nothing here blocks the UI; failures are ignored.
 */

let started: Promise<void> | undefined;

const idle = (): Promise<void> =>
  new Promise((r) => ('requestIdleCallback' in window ? (window as Window & { requestIdleCallback(cb: () => void, o?: { timeout: number }): void }).requestIdleCallback(() => r(), { timeout: 3000 }) : setTimeout(r, 400)));

async function warmShaders(): Promise<void> {
  const { Periscope3D } = await import('./widgets/periscope3d.js');
  if (!Periscope3D.supported()) return;
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 64;
  canvas.style.cssText = 'position:fixed;left:-200px;top:-200px;width:96px;height:64px;pointer-events:none';
  document.body.appendChild(canvas);
  const p = new Periscope3D(canvas, { eye: 20 });
  try {
    // One of each material family: warship, merchant with smoke, boat, neutral, aircraft
    const targets = [
      { label: 'w1', cls: 'ffg' as const, bearing: -6, range: 1200, alpha: 1, course: 90, lit: true },
      { label: 'w2', cls: 'merchant' as const, bearing: 0, range: 1500, alpha: 1, course: 90, lit: true },
      { label: 'w3', cls: 'ssk' as const, bearing: 6, range: 900, alpha: 1, course: 90 },
      { label: 'w4', cls: 'tanker' as const, bearing: 12, range: 2500, alpha: 1, course: 90, lit: true },
      { label: 'w5', cls: 'merchant' as const, plane: 'helo' as const, alt: 120, bearing: 0, range: 900, alpha: 1, course: 0, lit: true },
    ];
    for (const light of [1, 0.1]) p.render({ bearing: 0, fovDeg: 40, t: 1, sea: 3, light, targets, rain: light < 0.5 });
  } finally {
    p.dispose();
    canvas.remove();
  }
}

/** The login is on screen: fetch the lobby while the player types. */
export function preloadLobby(): void {
  void idle().then(loadLobby).catch(() => undefined);
}

/** Start once per page load; runs step by step in idle time. */
export function warmUp(): void {
  if (started) return;
  started = (async () => {
    try {
      // The game screen is needed the moment a match starts: right after the lobby (which
      // must not share a slow line with it), no waiting for idle time
      await loadLobby();
      await loadGame();
      await idle();
      await warmShaders();
      await idle();
      const book = await import('./widgets/recog-render.js');
      await idle();
      await book.prerender?.();
      await idle();
      await import('./voice/sfu.js');
    } catch {
      /* best effort only */
    }
  })();
}

/** Settles once the warm-up has finished (undefined if it never started): tests wait for it. */
export const warmUpDone = (): Promise<void> | undefined => started;
