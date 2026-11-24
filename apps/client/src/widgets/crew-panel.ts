import { BAD_CO2, BAD_O2, CLASSES, NM, type Snapshot } from '@tk/shared';
import { net } from '../net.js';
import { clock, h, setHtml, setText } from './format.js';
import { onTap } from './touch.js';

/**
 * Crew and boat: performance, fatigue, morale and wounded with the battle-stations and
 * silent-running switches; on boats also air, trim, high-pressure air with the emergency
 * blow, the trailing buoy antenna, the fleet-command broadcast schedule and the
 * dead-reckoning uncertainty. Built once, then only values change (buttons stay tappable).
 */
const dec = (v: number) => v.toFixed(1).replace('.', ',');

export function crewPanel(): { el: HTMLElement; update(s: Snapshot): void } {
  const el = h(`<div class="panel crew-panel">
    <div class="hd"><span>Besatzung &amp; Boot</span><span id="cp-perf" class="dim"></span></div>
    <div class="row"><span class="dim">ERMÜDUNG</span><span class="bar"><i id="cp-fat"></i></span></div>
    <div class="row"><span class="dim">MORAL</span><span class="bar"><i id="cp-mor"></i></span></div>
    <div class="row" id="cp-wnd-row"><span class="dim">VERWUNDETE</span><span id="cp-wnd"></span></div>
    <div class="row" id="cp-xp-row" title="Erfahrung aus dem Feldzug: etwas besseres Gehör, schnellere Reparaturen, weniger Störungen"><span class="dim">ERFAHRUNG</span><span class="bar"><i id="cp-xp"></i></span></div>
    <div class="steps" style="margin:4px 0">
      <button data-cp="battle" title="+10 % Leistung, ermüdet die Crew in etwa 90 Minuten">Gefechtsstationen</button>
      <button data-cp="silent" title="−3 dB, weniger Missgeschicke; Reparaturen und Nachladen halb so schnell">Ruhe im Boot</button>
    </div>
    <div id="cp-sub">
      <div class="row"><span class="dim">LUFT</span><span id="cp-air"></span></div>
      <div class="row"><span class="dim">TRIMM · PRESSLUFT</span><span id="cp-trim"></span></div>
      <div class="row"><span class="dim">FÜHRUNG (VLF)</span><span id="cp-cmd"></span></div>
      <div class="row"><span class="dim">KOPPELORT</span><span id="cp-nav"></span></div>
      <div class="steps" style="margin-top:4px">
        <button data-cp="buoyant" title="Schleppantenne: Empfang der Führung bis 60 m bei höchstens 6 kn, nur Empfang">Schleppantenne</button>
        <button data-cp="blow" class="fire" title="Alle Tauchzellen anblasen: schnell nach oben, sehr laut, kostet eine Pressluftflasche">Notanblasen</button>
      </div>
    </div>
    <div id="cp-note" class="amber"></div>
  </div>`);
  const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  let last: Snapshot | undefined;
  let blowArmed = 0;
  onTap(el, '[data-cp]', (b) => {
    const o = last?.own;
    if (!o) return;
    const k = b.dataset.cp!;
    if (k === 'battle') net.send({ t: 'toggle', what: 'battle', on: !o.crew?.battle });
    else if (k === 'silent') net.send({ t: 'toggle', what: 'silent', on: !o.crew?.silent });
    else if (k === 'buoyant') net.send({ t: 'toggle', what: 'buoyant', on: !o.buoyAntenna });
    else if (k === 'blow') {
      // Two taps within 3 s: an emergency blow is loud and irreversible
      if (performance.now() - blowArmed < 3000) {
        net.send({ t: 'blow' });
        blowArmed = 0;
        b.textContent = 'Notanblasen';
      } else {
        blowArmed = performance.now();
        b.textContent = 'Wirklich anblasen?';
        setTimeout(() => (b.textContent = 'Notanblasen'), 3000);
      }
    }
  });

  return {
    el,
    update(s) {
      last = s;
      const o = s.own;
      const c = o.crew;
      const sub = CLASSES[o.cls].submarine;
      setText(q('#cp-perf'), c ? `LEISTUNG ${Math.round(c.performance * 100)} %` : '');
      q('#cp-perf').className = c && c.performance < 0.85 ? 'amber' : 'dim';
      const fat = c?.fatigue ?? 0;
      q<HTMLElement>('#cp-fat').style.cssText = `width:${Math.round(fat * 100)}%;background:${fat > 0.7 ? 'var(--red)' : fat > 0.4 ? 'var(--amber)' : 'var(--g)'}`;
      const mor = c?.morale ?? 0.7;
      q<HTMLElement>('#cp-mor').style.cssText = `width:${Math.round(mor * 100)}%;background:${mor < 0.35 ? 'var(--red)' : mor < 0.55 ? 'var(--amber)' : 'var(--g)'}`;
      q('#cp-wnd-row').style.display = c?.wounded ? '' : 'none';
      q('#cp-xp-row').style.display = c?.xp ? '' : 'none';
      q<HTMLElement>('#cp-xp').style.cssText = `width:${Math.round((c?.xp ?? 0) * 100)}%;background:var(--amber)`;
      setText(q('#cp-wnd'), c?.wounded ? `${c.wounded} · SANITÄTER` : '');
      el.querySelector('[data-cp="battle"]')!.classList.toggle('on', !!c?.battle);
      el.querySelector('[data-cp="silent"]')!.classList.toggle('on', !!c?.silent);
      q('#cp-sub').style.display = sub ? '' : 'none';
      if (sub) {
        const a = o.air;
        const bad = a && (a.co2 > BAD_CO2 || a.o2 < BAD_O2);
        setHtml(q('#cp-air'), a
          ? `<span class="${bad ? 'red' : a.co2 > 2 ? 'amber' : ''}">CO₂ ${dec(a.co2)} % · O₂ ${dec(a.o2)} %</span> <span class="dim">· ${a.scrubbers}/${a.candles}</span>`
          : '<span class="dim">REAKTOR · UNBEGRENZT</span>');
        const trim = o.trim ?? 0;
        setHtml(q('#cp-trim'), `<span class="${Math.abs(trim) > 0.2 ? 'amber' : ''}">${Math.abs(trim) < 0.05 ? 'AUSGETRIMMT' : `${trim > 0 ? '+' : '−'}${dec(Math.abs(trim))} T`}</span> · ${'●'.repeat(o.hpAir ?? 3)}${'○'.repeat(Math.max(0, 3 - (o.hpAir ?? 3)))}${o.blowing ? ' <span class="red blink">ANBLASEN</span>' : ''}`);
        const cmd = o.command;
        setHtml(q('#cp-cmd'), !cmd ? '—'
          : cmd.done ? '<span>EMPFANGEN</span>'
          : cmd.nextS > 0 ? `<span class="dim">IN ${clock(cmd.nextS)}</span>`
          : `<span class="${cmd.via ? 'amber' : 'red blink'}">${cmd.via ? `EMPFANG ${Math.round(cmd.progress * 100)} % · ${cmd.via === 'vlf' ? 'VLF' : 'BOJE'}` : 'SENDET · ZU TIEF ODER ZU SCHNELL'}</span>`);
        setHtml(q('#cp-nav'), o.navUncertainty !== undefined
          ? `<span class="${o.navUncertainty > 2 * NM ? 'amber' : ''}">± ${(o.navUncertainty / NM).toFixed(1).replace('.', ',')} SM</span> <span class="dim">· ${o.nav?.lastFix ? `FIX: ${({ land: 'LAND', sat: 'SATELLIT', stars: 'STERNE', sounding: 'ECHOLOT' } as const)[o.nav.lastFix]}` : 'KOPPELORT'}</span>`
          : '<span>FIX</span>');
        el.querySelector('[data-cp="buoyant"]')!.classList.toggle('on', !!o.buoyAntenna);
      }
      const notes = [o.rudderJam ? 'RUDER KLEMMT' : '', o.towedLost ? 'SCHLEPPSONAR VERLOREN' : '',
        sub && o.depth > CLASSES[o.cls].maxDepth ? `UNTER TESTTIEFE (${CLASSES[o.cls].maxDepth} M)` : ''].filter(Boolean);
      setText(q('#cp-note'), notes.join(' · '));
    },
  };
}
