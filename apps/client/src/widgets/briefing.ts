import { SEA_TIME_FACTOR, type Briefing } from '@tk/shared';

/** "40 MIN · ECHTZEIT" or "120 MIN AUF SEE · ZEITRAFFER 3×, 40 MIN ECHT" (old briefings: 3 sea minutes per lobby minute). */
export function duration(b: Pick<Briefing, 'timeLimitMin' | 'timeScale' | 'seaMin'>): string {
  const sea = b.seaMin ?? b.timeLimitMin * SEA_TIME_FACTOR;
  const scale = b.timeScale ?? 1;
  return scale === 1 ? `${sea} MIN · ECHTZEIT` : `${sea} MIN AUF SEE · ZEITRAFFER ${scale}×, ${Math.round(sea / scale)} MIN ECHT`;
}
import { store } from '../store.js';
import { esc, h } from './format.js';

const TOD: Record<string, string> = { tag: 'Tag', daemmerung: 'Dämmerung', nacht: 'Nacht' };

/** Mission briefing overlay: once per match automatically, again via the menu. */
export function showBriefing(b: Briefing, force = false): void {
  const key = `tk_brief_${store.matchId ?? ''}`;
  if (!force && sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, '1');
  document.querySelector('.overlay.briefing')?.remove();
  const ov = h(`<div class="overlay briefing"><div class="panel brief-panel">
    <div class="brief-head"><div class="dim">LAGEBESPRECHUNG</div><div class="title">${esc(b.title)}</div>
      <div class="dim">${esc(b.info)}</div></div>
    <div class="brief-grid">
      <div><div class="brief-k">AUFTRAG</div><div class="brief-goal">${esc(b.goal)}</div></div>
      <div><div class="brief-k">EIGENES SCHIFF</div><div>${esc(b.ship)}</div>
        <div class="dim">${esc(TOD[b.timeOfDay] ?? b.timeOfDay)} · ${duration(b)}</div></div>
    </div>
    <div class="brief-k">LAGE</div>
    ${b.intel.map((i) => `<div class="brief-line">▸ ${esc(i)}</div>`).join('')}
    <div class="brief-k">ERSTE SCHRITTE</div>
    ${b.steps.map((s, i) => `<div class="brief-line"><span class="amber">${i + 1}</span> ${esc(s)}</div>`).join('')}
    <button id="brief-go" class="on" style="width:100%;margin-top:14px">Auf Station</button>
  </div></div>`);
  const close = () => {
    ov.remove();
    window.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' || e.key === 'Enter') {
      e.stopPropagation();
      close();
    }
  };
  window.addEventListener('keydown', onKey, true);
  ov.querySelector<HTMLButtonElement>('#brief-go')!.onclick = close;
  ov.addEventListener('pointerdown', (e) => e.target === ov && close());
  document.body.appendChild(ov);
}
