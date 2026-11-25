/**
 * A WebGL scene that is built on first use and given back when it is no longer needed.
 * Browsers allow only a handful of live WebGL contexts per page: a station that leaves its
 * scene alive after the player switched away (or after the match ended) eventually starves
 * the next one. Shared by the periscope and the frigate bridge.
 */
export interface GlScene {
  dispose(): void;
}

export class LazyGl<T extends GlScene> {
  scene: T | undefined;
  /** Set when 3D is switched off or unsupported: the station draws its 2D picture only. */
  off: boolean;
  private loading = false;
  private dead = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    /** The canvas the scene draws into; replaced by a fresh one after each free (see free()). */
    public canvas: HTMLCanvasElement,
    /** Loads three.js and builds the scene, or resolves undefined without WebGL2. */
    private create: (canvas: HTMLCanvasElement) => Promise<T | undefined>,
  ) {
    this.off = localStorage.getItem('tk_3d') === '0';
  }

  /** Build the scene if there is none yet (and cancel a pending free). */
  ensure(): void {
    clearTimeout(this.timer);
    if (this.scene || this.loading || this.off || this.dead) return;
    this.loading = true;
    this.create(this.canvas)
      .then((g) => {
        this.loading = false;
        if (!g) return void (this.off = true);
        // The station was disposed while three.js was still loading: give the context straight back
        if (this.dead) return g.dispose();
        this.scene = g;
      })
      .catch(() => {
        this.loading = false;
        this.off = true;
      });
  }

  /** Free the scene after a while: switching back within that time costs nothing. */
  freeLater(ms = 20_000): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.free(), ms);
  }

  /** Free the scene now. A context that was given up cannot be reused: the next scene gets a fresh canvas. */
  free(): void {
    clearTimeout(this.timer);
    if (!this.scene) return;
    this.scene.dispose();
    this.scene = undefined;
    const fresh = this.canvas.cloneNode() as HTMLCanvasElement;
    this.canvas.replaceWith(fresh);
    this.canvas = fresh;
  }

  /** Free for good (leaving the match): nothing is built any more, not even by a load still in flight. */
  dispose(): void {
    this.dead = true;
    this.free();
  }
}
