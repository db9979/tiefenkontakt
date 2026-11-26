import { AI_LEVEL_LABEL, type AiLevel, type Debrief } from '@tk/shared';
import { CLASS_LABEL, esc, h } from '../widgets/format.js';
import { post } from './account.js';
import { debriefOverlay } from './debrief.js';

interface Game { seed: number; winner: 'west' | 'east'; reason: string; minutes: number; sunkTons: number; subsLost: number; escortsLost: number }
interface Stats { games: number; westWins: number; eastWins: number; avgSunkTons: number; avgSubLosses: number; avgEscortLosses: number; avgMinutes: number; avgDetectWest?: number; avgDetectEast?: number }
interface Status { state: 'idle' | 'running' | 'done'; total: number; done: number; by?: string; games: Game[]; stats?: Stats; admin?: boolean; setup?: { mission: string } }

const W = ['ffg', 'ffv', 'kor'] as const;
const E = ['ssk', 'ssn', 'ssa', 'ssc'] as const;
const km = (m?: number) => (m === undefined ? '—' : `${(m / 1000).toFixed(1).replace('.', ',')} KM`);

/**
 * Replay series: the server plays N bot matches of one setup and shows the statistics; every
 * match can be watched as a replay with all true positions (the debrief viewer).
 */
export function seriesPanel(): HTMLElement {
  const el = h(`<div class="panel" style="margin-top:10px"></div>`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let err = '';
  const opt = (vals: readonly string[], labels?: (v: string) => string) => vals.map((v) => `<option value="${v}">${esc(labels ? labels(v) : v)}</option>`).join('');
  const clsSel = (id: string, list: readonly string[], none: boolean) =>
    `<select id="${id}">${none ? '<option value="">—</option>' : ''}${opt(list, (v) => CLASS_LABEL[v as keyof typeof CLASS_LABEL])}</select>`;

  el.innerHTML = `<div class="hd"><span>Wiederholungsserie</span><span class="dim">KI GEGEN KI · AUF DEM SERVER</span></div>
    <div class="grid2">
      <div>
        <div class="row"><span class="dim">MISSION</span><select id="se-m">${opt(['groenland', 'schelf', 'fjord', 'hafen', 'meerenge', 'duell'], (v) => ({ groenland: 'Grönland-Lücke', schelf: 'Schelfmeer', fjord: 'Fjordausfahrt', hafen: 'Hafenangriff', meerenge: 'Meerenge', duell: 'U-Boot-Duell' })[v]!)}</select></div>
        <div class="row"><span class="dim">TAGESZEIT</span><select id="se-tod">${opt(['tag', 'daemmerung', 'nacht'], (v) => ({ tag: 'Tag', daemmerung: 'Dämmerung', nacht: 'Nacht' })[v]!)}</select></div>
        <div class="row"><span class="dim">KI-STUFE</span><select id="se-skill">${opt(['leicht', 'normal', 'schwer'], (v) => AI_LEVEL_LABEL[v as AiLevel])}</select></div>
        <div class="row"><span class="dim">ZEITLIMIT</span><select id="se-time">${opt(['20', '30', '40'], (v) => `${v} MIN`)}</select></div>
      </div>
      <div>
        <div class="row"><span class="dim">WESTBUND</span><span>${clsSel('se-w1', W, false)} ${clsSel('se-w2', W, true)}</span></div>
        <div class="row"><span class="dim">OSTPAKT</span><span>${clsSel('se-e1', E, false)} ${clsSel('se-e2', E, true)}</span></div>
        <div class="row"><span class="dim">PARTIEN</span><select id="se-n">${opt(['1', '2', '3', '5', '10', '20'])}</select></div>
        <div class="steps"><button id="se-go" class="on">Serie starten</button></div>
      </div>
    </div>
    <div id="se-out"></div>`;
  const sel = (id: string) => el.querySelector<HTMLSelectElement>(id)!;
  sel('#se-time').value = '30';
  sel('#se-skill').value = 'normal';
  sel('#se-w2').value = 'ffg';
  sel('#se-e2').value = 'ssn';
  const out = el.querySelector<HTMLElement>('#se-out')!;

  const render = (s: Status) => {
    const st = s.stats;
    const p = (a: number) => (st?.games ? Math.round((100 * a) / st.games) : 0);
    out.innerHTML = `${s.admin ? '' : '<div class="dim">OHNE MODERATORRECHTE HÖCHSTENS 3 PARTIEN JE SERIE.</div>'}
      ${s.state === 'idle' ? '<div class="dim">NOCH KEINE SERIE GELAUFEN</div>' : `
      <div class="row"><span>${s.state === 'running' ? `<span class="amber">LÄUFT ${s.done}/${s.total}</span>` : `FERTIG ${s.done}/${s.total}`}</span><span class="dim">${esc(s.by ?? '')}</span></div>
      ${st && st.games ? `
      <div class="row"><span class="dim">SIEGE WESTBUND · OSTPAKT</span><span>${p(st.westWins)} % · ${p(st.eastWins)} %</span></div>
      <div class="row"><span class="dim">Ø VERSENKT</span><span>${Math.round(st.avgSunkTons / 1000)}K BRT</span></div>
      <div class="row"><span class="dim">Ø U-BOOT-VERLUSTE · ESKORTVERLUSTE</span><span>${st.avgSubLosses} · ${st.avgEscortLosses}</span></div>
      <div class="row"><span class="dim">Ø ERSTORTUNG WEST · OST</span><span>${km(st.avgDetectWest)} · ${km(st.avgDetectEast)}</span></div>
      <div class="row"><span class="dim">Ø DAUER</span><span>${st.avgMinutes} MIN</span></div>` : ''}
      ${s.games.map((g, i) => `<div class="row"><span>${i + 1} · ${g.winner === 'west' ? 'WESTBUND' : 'OSTPAKT'} · ${g.minutes} MIN · ${esc(g.reason)}</span>
        <button data-rp="${i}" title="Aufzeichnung mit allen wahren Positionen">Wiedergabe</button></div>`).join('')}`}
      <div class="err">${esc(err)}</div>`;
    out.querySelectorAll<HTMLButtonElement>('[data-rp]').forEach((b) => (b.onclick = async () => {
      const r = await fetch(`/api/series/replay/${b.dataset.rp}`);
      if (r.ok) debriefOverlay((await r.json()) as Debrief, () => undefined);
    }));
    clearTimeout(timer);
    if (s.state === 'running' && el.isConnected) timer = setTimeout(() => void load(), 2000);
  };

  const load = async () => {
    const r = await fetch('/api/series');
    if (!r.ok) {
      el.style.display = 'none';
      return;
    }
    render((await r.json()) as Status);
  };

  el.querySelector<HTMLButtonElement>('#se-go')!.onclick = async () => {
    const two = (a: string, b: string) => [sel(a).value, sel(b).value].filter(Boolean);
    const r = await post('/api/series', {
      games: Number(sel('#se-n').value),
      setup: {
        mission: sel('#se-m').value, timeOfDay: sel('#se-tod').value, botSkill: sel('#se-skill').value, timeLimitMin: Number(sel('#se-time').value),
        west: sel('#se-m').value === 'duell' ? two('#se-e1', '#se-e2') : two('#se-w1', '#se-w2'), east: two('#se-e1', '#se-e2'),
      },
    });
    err = r.ok ? '' : r.data.error ?? 'Fehler';
    void load();
  };
  void load().catch(() => undefined);
  return el;
}
