import { t } from '../i18n/index.js';

/**
 * Status on the button itself: every press flashes at once, toggles show AN/AUS, running
 * processes a percentage with a fill bar, weapons their reload or what is left.
 */
export interface BtnState {
  /** Toggle state: the button lights up and shows AN/AUS unless a label is given. */
  on?: boolean;
  /** Short tag at the right edge of the button ('47 %', 'LÄDT 12 S', '✓', '3'). */
  label?: string;
  /** 0..100: fills the button from the left while a process runs. */
  pct?: number;
  /** busy: amber and pulsing (under way); warn: amber; empty: dim (nothing left). */
  tone?: 'busy' | 'warn' | 'empty';
  /** Set by the fire guard: overrides the station's own label while a warning shows. */
  force?: boolean;
}

export function btnState(b: HTMLElement | null | undefined, s: BtnState): void {
  if (!b) return;
  // A guarded fire button showing its warning keeps it until the guard clears it
  if (b.dataset.guard && !s.force) return;
  if (s.on !== undefined) b.classList.toggle('on', s.on);
  const tag = s.label ?? (s.on === undefined ? '' : s.on ? 'AN' : 'AUS');
  const txt = tag ? t(tag) : '';
  if ((b.dataset.bst ?? '') !== txt) {
    if (txt) b.dataset.bst = txt;
    else delete b.dataset.bst;
  }
  b.classList.toggle('st-busy', s.tone === 'busy');
  b.classList.toggle('st-warn', s.tone === 'warn');
  b.classList.toggle('st-empty', s.tone === 'empty');
  if (s.pct !== undefined) {
    b.classList.add('prog');
    b.style.setProperty('--pct', `${Math.max(0, Math.min(100, s.pct)).toFixed(0)}%`);
  } else if (b.classList.contains('prog')) {
    b.classList.remove('prog');
    b.style.removeProperty('--pct');
  }
}

/** Tubes on a fire button: how many are loaded, else the shortest reload. */
export function tubeTag(tubes: { loaded: boolean; reloadLeft: number }[]): BtnState {
  const ready = tubes.filter((x) => x.loaded).length;
  if (ready) return { label: `${ready}/${tubes.length} BEREIT` };
  const next = tubes.map((x) => x.reloadLeft).filter((r) => r > 0);
  return next.length ? { label: `LÄDT ${Math.ceil(Math.min(...next))} S`, tone: 'busy' } : { label: 'LEER', tone: 'empty' };
}

/** Mast button: lit when up, the way up or down as a fill and percentage; below periscope depth it can't go up. */
export function mastBtn(ms: { ext: number; moving?: 'aus' | 'ein' }, up: boolean, tooDeep = false): BtnState {
  if (!up && !ms.moving && tooDeep) return { on: false, label: 'ZU TIEF', tone: 'warn' };
  return ms.moving ? { on: up, label: `${Math.round(ms.ext * 100)} %`, pct: ms.ext * 100, tone: 'busy' } : { on: up, label: up ? 'OBEN' : 'UNTEN' };
}

const depthFrom = new WeakMap<HTMLElement, { order: number; from: number }>();

/**
 * A depth order button: lit while it is the ordered depth, with the way there as a fill
 * ('→ 18 M' and the share of the change done) and a tick once the boat is there.
 */
export function depthBtn(b: HTMLElement | null | undefined, depth: number, order: number, target: number | undefined): void {
  if (!b) return;
  const mine = target !== undefined && Math.abs(order - target) < 1;
  if (!mine) {
    depthFrom.delete(b);
    btnState(b, { on: false, label: '' });
    return;
  }
  let rec = depthFrom.get(b);
  if (!rec || rec.order !== order) depthFrom.set(b, (rec = { order, from: depth }));
  const left = Math.abs(depth - order);
  if (left <= 1.5) {
    btnState(b, { on: true, label: '✓' });
    return;
  }
  const span = Math.max(1, Math.abs(rec.from - order));
  btnState(b, { on: true, label: `${depth.toFixed(0)} M ${depth > order ? '↑' : '↓'}`, pct: 100 * (1 - left / span), tone: 'busy' });
}

/** A short flash on every button press, so each press is answered at once (also before the server's reply). */
export function installButtonAck(): void {
  document.addEventListener('click', (e) => {
    const b = (e.target as Element | null)?.closest?.('button');
    if (!b || b.disabled) return;
    b.classList.remove('ack');
    void b.offsetWidth;
    b.classList.add('ack');
    setTimeout(() => b.classList.remove('ack'), 450);
  }, true);
}
