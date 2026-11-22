import { depthAt, type Snapshot, type Vec2 } from '@tk/shared';

/** The plot's chart background, rendered coarsely into a cached image and redrawn when the view moves. */
export class DepthChart {
  private cache?: { key: string; img: HTMLCanvasElement; at: number };

  /** Chart shading from the (public) seabed: land, shoals, shelf and deep water. */
  draw(ctx: CanvasRenderingContext2D, spec: Snapshot['env']['seabed'], c: Vec2, scale: number, w: number, hgt: number): void {
    if (!spec) return;
    const cell = 6;
    const cols = Math.ceil(w / cell);
    const rows = Math.ceil(hgt / cell);
    const key = `${Math.round(c.x / (scale * 4))}|${Math.round(c.y / (scale * 4))}|${scale.toFixed(2)}|${cols}|${rows}`;
    const now = performance.now();
    if (!this.cache || (this.cache.key !== key && now - this.cache.at > 120)) {
      const img = this.cache?.img ?? document.createElement('canvas');
      img.width = cols;
      img.height = rows;
      const ic = img.getContext('2d')!;
      const data = ic.createImageData(cols, rows);
      // Depth bands for isobaths (0, 50, 100, 200, 500, 1000, 2000 m)
      const band = (d: number) => [0, 50, 100, 200, 500, 1000, 2000].filter((z) => d >= z).length;
      const depths = new Float32Array(cols * rows);
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) depths[j * cols + i] = depthAt(spec, c.x + (i * cell - w / 2) * scale, c.y - (j * cell - hgt / 2) * scale);
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const d = depths[j * cols + i]!;
          const edge = (i + 1 < cols && band(depths[j * cols + i + 1]!) !== band(d)) || (j + 1 < rows && band(depths[(j + 1) * cols + i]!) !== band(d));
          const [r, g, b] = edge && d >= 0 ? [30, 66, 62] : d < 0 ? [38, 36, 26] : d < 60 ? [52, 64, 50] : d < 300 ? [14, 34, 34] : d < 2000 ? [9, 22, 24] : [6, 14, 16];
          const k = (j * cols + i) * 4;
          data.data[k] = r;
          data.data[k + 1] = g;
          data.data[k + 2] = b;
          data.data[k + 3] = 255;
        }
      }
      ic.putImageData(data, 0, 0);
      this.cache = { key, img, at: now };
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.cache.img, 0, 0, cols * cell, rows * cell);
  }
}
