import { CLASSES, PERISCOPE_DEPTH, type Snapshot } from '@tk/shared';
import { announce } from '../a11y.js';
import { audio } from '../audio.js';
import { t } from '../i18n/index.js';
import { btnState } from './btn-state.js';
import { callouts } from './callouts.js';
import { h } from './format.js';
import {
  activeAlarms, alarmLabel, initialAlarmState, loadAlarmCfg, sanitizeCfg, saveAlarmCfg, stepAlarms, worstLevel,
  type AlarmKind, type AlarmLevel, type AlarmState, type DepthAlarmCfg,
} from './depth-alarm.js';

/**
 * Runs the depth alarms for the own submarine: fed from the helm (which updates on every
 * station), it sounds, announces and logs an alarm once when a band is entered and keeps a
 * small callout under the top bar while any band is active. The dive station shows the
 * settings block (alarmPanel).
 */
class DepthAlarms {
  cfg?: DepthAlarmCfg;
  state: AlarmState = initialAlarmState();
  clearance?: number;
  private cls?: string;
  private callout?: HTMLElement;
  private panels = new Set<() => void>();

  update(s: Snapshot): void {
    const o = s.own;
    const spec = CLASSES[o.cls];
    if (!spec.submarine || !o.alive) {
      this.state = initialAlarmState();
      this.render();
      return;
    }
    if (this.cls !== o.cls) {
      this.cls = o.cls;
      this.cfg = loadAlarmCfg(o.cls, spec.maxDepth);
      this.state = initialAlarmState();
    }
    const bottom = s.env.bottom;
    this.clearance = bottom !== undefined ? bottom - o.depth : undefined;
    const { state, raised } = stepAlarms(this.state, this.cfg!, { depth: o.depth, orderDepth: o.order.depth, bottom, periscopeDepth: PERISCOPE_DEPTH });
    this.state = state;
    for (const r of raised) {
      const text = `${t(alarmLabel(r.kind, r.level))} · ${this.figure(r.kind)}`;
      audio.depthAlarm(r.level === 2);
      announce(text, r.level === 2 ? 'alarm' : 'warn');
      callouts.log.push({ time: s.time, text, level: r.level === 2 ? 'alarm' : 'warn', station: 'zentrale' });
      if (callouts.log.length > 80) callouts.log.shift();
    }
    this.render();
  }

  /** The number beside a band's label: the limit, or the water under the keel. */
  figure(kind: AlarmKind): string {
    const c = this.cfg!;
    if (kind === 'upper') return `${c.upper} M`;
    if (kind === 'lower') return `${c.lower} M`;
    return `${Math.max(0, Math.round(this.clearance ?? 0))} M`;
  }

  level(): AlarmLevel {
    return worstLevel(this.state);
  }

  /** One-line summary for the helm's depth line (empty when quiet). */
  helmTag(): string {
    const a = activeAlarms(this.state)[0];
    if (!a) return '';
    const short = a.kind === 'ground' ? 'GRUND' : a.kind === 'upper' ? 'ZU FLACH' : 'TIEFENGRENZE';
    return `<span class="${a.level === 2 ? 'red blink' : 'amber'}" title="Tiefenalarm">⚠ <span>${short}</span></span>`;
  }

  set(c: Partial<DepthAlarmCfg>): void {
    if (!this.cfg || !this.cls) return;
    this.cfg = sanitizeCfg({ ...this.cfg, ...c }, CLASSES[this.cls as keyof typeof CLASSES].maxDepth);
    saveAlarmCfg(this.cls, this.cfg);
    for (const p of this.panels) p();
  }

  private render(): void {
    const act = activeAlarms(this.state);
    if (!act.length) {
      this.callout?.remove();
    } else {
      this.callout ??= h('<div class="depth-callout" aria-hidden="true"></div>');
      const worst = act[0]!.level;
      this.callout.className = `depth-callout ${worst === 2 ? 'danger blink' : 'warning'}`;
      const html = act.map((a) => `<span>${alarmLabel(a.kind, a.level)}</span> <span>${this.figure(a.kind)}</span>`).join('<br>');
      if (this.callout.innerHTML !== html) this.callout.innerHTML = html;
      if (!this.callout.isConnected) document.body.appendChild(this.callout);
    }
    for (const p of this.panels) p();
  }

  /** Settings and state block for the dive station: one 26 px row per band (on/off chip, label, − value +). */
  panel(): HTMLElement {
    const el = h(`<div class="depth-alarms">
      <div id="da-now" class="da-now"></div>
      ${row('upperOn', 'upper', 'OBERGRENZE', 'Warnt, wenn das Boot flacher steigt (außer bei befohlener Sehrohrtiefe)')}
      ${row('lowerOn', 'lower', 'UNTERGRENZE', 'Warnt, wenn das Boot tiefer sinkt')}
      ${row('groundOn', 'groundWarn', 'GRUND · WARNUNG', 'Warnt bei weniger Wasser unter dem Kiel')}
      ${row(undefined, 'groundDanger', 'GRUND · GEFAHR', 'Alarm bei weniger Wasser unter dem Kiel')}
    </div>`);
    el.querySelectorAll<HTMLButtonElement>('[data-on]').forEach((b) => {
      b.onclick = () => {
        const k = b.dataset.on as 'upperOn' | 'lowerOn' | 'groundOn';
        if (this.cfg) this.set({ [k]: !this.cfg[k] });
      };
    });
    el.querySelectorAll<HTMLInputElement>('[data-v]').forEach((inp) => {
      inp.onchange = () => this.set({ [inp.dataset.v!]: Number(inp.value) });
    });
    el.querySelectorAll<HTMLButtonElement>('[data-dastep]').forEach((b) => {
      b.onclick = () => {
        const [k, d] = b.dataset.dastep!.split(':') as [keyof DepthAlarmCfg, string];
        if (this.cfg) this.set({ [k]: (this.cfg[k] as number) + Number(d) });
      };
    });
    const draw = () => {
      const c = this.cfg;
      if (!c) return;
      for (const k of ['upperOn', 'lowerOn', 'groundOn'] as const) btnState(el.querySelector<HTMLElement>(`[data-on="${k}"]`), { on: c[k] });
      for (const inp of el.querySelectorAll<HTMLInputElement>('[data-v]')) {
        const k = inp.dataset.v as keyof DepthAlarmCfg;
        if (document.activeElement !== inp) inp.value = String(c[k]);
        inp.disabled = !c[k === 'groundDanger' || k === 'groundWarn' ? 'groundOn' : k === 'upper' ? 'upperOn' : 'lowerOn'];
      }
      const lv: Record<string, AlarmLevel> = { upper: this.state.upper, lower: this.state.lower, groundWarn: this.state.ground === 1 ? 1 : 0, groundDanger: this.state.ground === 2 ? 2 : 0 };
      for (const r of el.querySelectorAll<HTMLElement>('[data-row]')) {
        const l = lv[r.dataset.row!] ?? 0;
        r.classList.toggle('amber', l === 1);
        r.classList.toggle('red', l === 2);
        r.classList.toggle('blink', l === 2);
      }
      const act = activeAlarms(this.state);
      const now = el.querySelector<HTMLElement>('#da-now')!;
      const html = act.length
        ? act.map((a) => `<div class="${a.level === 2 ? 'red blink' : 'amber'}"><span>${alarmLabel(a.kind, a.level)}</span> <span>${this.figure(a.kind)}</span></div>`).join('')
        // The water under the keel is in the tab header already
        : '<div class="dim"><span>KEIN ALARM</span></div>';
      if (now.innerHTML !== html) now.innerHTML = html;
    };
    this.panels.add(draw);
    draw();
    return el;
  }

  dispose(): void {
    this.callout?.remove();
    this.state = initialAlarmState();
    this.cls = undefined;
    this.panels.clear();
  }
}

function row(onKey: string | undefined, key: string, label: string, title: string): string {
  return `<div class="row da-row" data-row="${key}" title="${title}">
    ${onKey ? `<button data-on="${onKey}" class="da-on" aria-label="${label}"></button>` : '<span class="da-on da-pad"></span>'}<span class="da-lbl">${label}</span>
    <span class="da-set"><button data-dastep="${key}:-5" title="5 m weniger">−</button><input data-v="${key}" type="number" step="5" min="0" aria-label="${label} in Metern"><span class="dim">M</span><button data-dastep="${key}:5" title="5 m mehr">+</button></span>
  </div>`;
}

export const depthAlarms = new DepthAlarms();
