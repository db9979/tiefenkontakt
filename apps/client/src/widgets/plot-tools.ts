import type { Tool } from './chart-marks.js';

type LinesMode = 'alle' | 'auswahl' | 'aus';
/** Bearing lines on the plot: all contacts, only the selected one (default), or none. */
export const linesMode = (): LinesMode => {
  const v = localStorage.getItem('tk_lines');
  return v === 'alle' || v === 'aus' ? v : 'auswahl';
};

export interface ToolHost {
  zoom(f: number): void;
  centre(): void;
  /** Pick a plotting tool (the same again puts it down); returns the tool now in hand. */
  toggleTool(t: Tool): Tool | undefined;
  weather: boolean;
  setWeather(on: boolean): void;
}

/**
 * The chart's tool column (top right): zoom, centre, bearing lines, plotting tools, weather.
 * On a narrow chart (class compact, phones) only zoom and ⋯ show; ⋯ folds the rest out (S19).
 */
export function plotTools(canvas: HTMLCanvasElement, host: ToolHost): HTMLElement {
  const tools = document.createElement('div');
  tools.className = 'plot-tools';
  tools.innerHTML = `<button title="Hineinzoomen" class="keep">+</button><button title="Herauszoomen" class="keep">−</button><button class="keep more" title="Weitere Kartenwerkzeuge" aria-expanded="false">⋯</button><button title="Auf eigenes Schiff zentrieren">◎</button><button class="lines-btn" title="Peillinien: alle / nur Auswahl / aus"></button>`;
  const [zin, zout, more, ctr, lines] = [...tools.querySelectorAll('button')];
  more!.onclick = () => {
    const open = tools.classList.toggle('open');
    more!.setAttribute('aria-expanded', String(open));
  };
  const showLines = () => {
    const m = linesMode();
    lines!.textContent = { alle: '╱╱', auswahl: '╱', aus: '·' }[m];
    lines!.title = `Peillinien: ${{ alle: 'ALLE KONTAKTE', auswahl: 'NUR GEWÄHLTER KONTAKT', aus: 'AUS' }[m]} · Klick schaltet weiter`;
    lines!.classList.toggle('warn', m === 'aus');
  };
  lines!.onclick = () => {
    const order: LinesMode[] = ['auswahl', 'alle', 'aus'];
    localStorage.setItem('tk_lines', order[(order.indexOf(linesMode()) + 1) % order.length]!);
    showLines();
  };
  showLines();
  zin!.onclick = () => host.zoom(1 / 1.4);
  zout!.onclick = () => host.zoom(1.4);
  ctr!.onclick = () => host.centre();
  // Plotting tools: mark, line, circle, eraser (click again to put the pencil down)
  for (const [tool, icon, title] of [['mark', '✕', 'Markierung setzen'], ['line', '⟋', 'Linie ziehen (Peilung und Länge)'], ['circle', '◯', 'Kreis ziehen (Radius)'], ['erase', '⌫', 'Zeichnung wegklicken']] as const) {
    const b = document.createElement('button');
    b.textContent = icon;
    b.title = title;
    b.dataset.tool = tool;
    b.onclick = () => {
      const now = host.toggleTool(tool);
      tools.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((x) => x.classList.toggle('on', x.dataset.tool === now));
      canvas.style.cursor = now ? 'cell' : 'crosshair';
    };
    tools.appendChild(b);
  }
  // Weather overlay on/off (the host keeps it per chart kind)
  const wx = document.createElement('button');
  wx.textContent = '☁';
  const showWx = () => {
    wx.classList.toggle('on', host.weather);
    wx.title = `Wetter (Nebel, Eis, Schauer): ${host.weather ? 'AN' : 'AUS'} · Klick schaltet um`;
  };
  wx.onclick = () => {
    host.setWeather(!host.weather);
    showWx();
  };
  showWx();
  tools.appendChild(wx);
  return tools;
}
