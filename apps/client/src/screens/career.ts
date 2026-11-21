import { net } from '../net.js';
import { esc, h } from '../widgets/format.js';

interface Step {
  id: string;
  kind: 'lesson' | 'mission';
  title: string;
  lesson?: 'klassifizieren' | 'tma' | 'angriff' | 'ujagd';
  mission?: 'groenland' | 'schelf' | 'fjord';
  timeOfDay?: 'tag' | 'daemmerung' | 'nacht';
  done: boolean;
  unlocked: boolean;
}
interface Summary { callsign: string; points: number; matches: number; wins: number; kills: number; tonnage: number }

/** Service record, campaign and leaderboard below the lobby. Accounts only for record and campaign. */
export function careerPanels(): HTMLElement {
  const el = h(`<div class="grid2" style="margin-top:10px"><div class="panel" id="c-me"></div><div class="panel" id="c-board"></div></div>`);
  const me = el.querySelector<HTMLElement>('#c-me')!;
  const board = el.querySelector<HTMLElement>('#c-board')!;

  fetch('/api/stats').then(async (r) => {
    if (!r.ok) {
      me.innerHTML = '<div class="hd"><span>Dienstbuch und Kampagne</span></div><div class="dim">MIT KONTO WERDEN ERGEBNISSE, PUNKTE UND KAMPAGNE GESPEICHERT.</div>';
      return;
    }
    const d = (await r.json()) as { summary?: Summary; campaign: Step[] };
    const s = d.summary;
    me.innerHTML = `<div class="hd"><span>Dienstbuch · ${esc(s?.callsign ?? '')}</span><span>${s?.points ?? 0} PUNKTE</span></div>
      <div class="row"><span class="dim">PARTIEN / SIEGE</span><span>${s?.matches ?? 0} / ${s?.wins ?? 0}</span></div>
      <div class="row"><span class="dim">VERSENKT</span><span>${s?.kills ?? 0} SCHIFFE · ${Math.round((s?.tonnage ?? 0) / 1000)}K BRT</span></div>
      <div class="hd" style="margin-top:8px"><span>Kampagne</span><span class="dim">${d.campaign.filter((c) => c.done).length}/${d.campaign.length}</span></div>
      ${d.campaign.map((c) => `<div class="row ${c.done ? 'dim' : c.unlocked ? '' : 'dim'}">
        <span>${c.done ? '✓' : c.unlocked ? '▸' : '·'} ${esc(c.title)}</span>
        ${c.unlocked && !c.done ? `<button data-step="${c.id}">Starten</button>` : ''}</div>`).join('')}`;
    me.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b) => {
      b.onclick = () => {
        const c = d.campaign.find((x) => x.id === b.dataset.step)!;
        if (c.kind === 'lesson' && c.lesson) net.send({ t: 'training', lesson: c.lesson });
        else if (c.mission) {
          net.send({ t: 'create_match', name: c.title.replace(/^Einsatz \d+: /, '') });
          // Same socket, processed in order: the settings apply to the match just created
          net.send({ t: 'settings', mission: c.mission, timeOfDay: c.timeOfDay });
        }
      };
    });
  }).catch(() => undefined);

  fetch('/api/leaderboard').then(async (r) => {
    const rows = (await r.json()) as Summary[];
    board.innerHTML = `<div class="hd"><span>Rangliste</span><span class="dim">PUNKTE · SIEGE · VERSENKT</span></div>` +
      (rows.length ? rows.map((x, i) => `<div class="row"><span>${i + 1}. ${esc(x.callsign)}</span><span>${x.points} · ${x.wins} · ${x.kills}</span></div>`).join('')
        : '<div class="dim">NOCH KEINE ERGEBNISSE</div>');
  }).catch(() => undefined);
  return el;
}
