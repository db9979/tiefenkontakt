import type { WeeklyBoard, WeeklyRow } from '@tk/shared';
import { net } from '../net.js';
import { esc, h } from '../widgets/format.js';

const MISSION: Record<string, string> = {
  groenland: 'Grönland-Lücke', schelf: 'Schelfmeer', fjord: 'Fjordausfahrt', hafen: 'Hafenangriff',
  fuehlung: 'Fühlung halten', meerenge: 'Meerengen-Durchbruch', aufklaerung: 'Aufklärung', duell: 'U-Boot-Duell', eigene: 'Eigene Mission',
};
const TOD: Record<string, string> = { tag: 'Tag', daemmerung: 'Dämmerung', nacht: 'Nacht' };
const CLS: Record<string, string> = { ffg: 'F-12', kor: 'K-7', ffv: 'F-30', ffk: 'P-11', ssw: 'S-14', ssk: 'Diesel', ssn: 'Atom', ssc: 'Küste', ssa: 'AIP' };

/** Days and hours until the week turns. */
function left(endsAt: number): string {
  const hrs = Math.max(0, Math.floor((endsAt - Date.now()) / 3_600_000));
  return hrs >= 24 ? `NOCH ${Math.floor(hrs / 24)} T ${hrs % 24} H` : `NOCH ${hrs} H`;
}

function rows(list: WeeklyRow[]): string {
  if (!list.length) return '<div class="dim" style="padding:2px 0">NOCH NIEMAND</div>';
  return list.slice(0, 5).map((r) => `<div class="row"><span>${r.rank}. ${esc(r.callsign)} <span class="dim">${esc(CLS[r.cls] ?? r.cls)}</span></span><span>${r.score}${r.won ? ' ✓' : ''}</span></div>`).join('');
}

/**
 * Straight into a game: against the AI at once (random situation), or this week's situation, the
 * same for everyone, with its own board per side.
 */
export function quickPanel(): HTMLElement {
  const el = h(`<div class="panel" style="margin-top:10px">
    <div class="hd"><span>Gegen KI spielen</span><span class="dim">ALLEIN · OHNE LOBBY · SOFORT LOS</span></div>
    <div class="row" style="gap:6px;flex-wrap:wrap">
      <span class="dim" title="Zufällige Mission, Tageszeit, Wetter und Lage; die Gegner spielt die KI">ZUFÄLLIGE LAGE</span>
      <span style="display:flex;gap:6px"><button data-solo="east" class="on" title="Sofort als U-Boot gegen die KI-Eskorte">Als U-Boot</button><button data-solo="west" class="on" title="Sofort als Fregatte gegen KI-U-Boote">Als Geleitschutz</button></span>
    </div>
    <div id="wk" style="margin-top:8px"><div class="dim">WOCHENLAGE WIRD GELADEN …</div></div>
  </div>`);
  el.querySelectorAll<HTMLButtonElement>('[data-solo]').forEach((b) => {
    b.onclick = () => net.send({ t: 'solo', team: b.dataset.solo as 'west' | 'east' });
  });
  const wk = el.querySelector<HTMLElement>('#wk')!;
  fetch('/api/weekly').then(async (r) => {
    if (!r.ok) throw new Error(String(r.status));
    const b = (await r.json()) as WeeklyBoard;
    const l = b.lage;
    const kw = b.week.split('-W')[1] ?? b.week;
    wk.innerHTML = `
      <div class="row" style="gap:6px;flex-wrap:wrap">
        <span title="Eine Lage pro Woche, für alle gleich: Mission, Wetter, Positionen und Route. Mit Konto kommt dein bestes Ergebnis je Seite auf die Wochenliste."><span class="amber">WOCHENLAGE KW ${esc(kw)}</span>
          ${l ? `<span class="dim"> · ${esc(MISSION[l.mission] ?? l.mission)}${l.area ? ` · ${esc(l.area)}` : ''} · ${esc(TOD[l.timeOfDay] ?? l.timeOfDay)} · SEEGANG ${l.seaState} · ${left(l.endsAt)}</span>` : ''}</span>
        <span style="display:flex;gap:6px"><button data-week="west" class="on">Geleitschutz</button><button data-week="east" class="on">U-Boot</button></span>
      </div>
      <div class="grid2" style="margin-top:4px">
        <div><div class="dim team-w">BESTE GELEITE</div>${rows(b.west)}</div>
        <div><div class="dim team-e">BESTE U-BOOTE</div>${rows(b.east)}</div>
      </div>`;
    wk.querySelectorAll<HTMLButtonElement>('[data-week]').forEach((btn) => {
      btn.onclick = () => net.send({ t: 'solo', team: btn.dataset.week as 'west' | 'east', weekly: true });
    });
  }).catch(() => {
    wk.innerHTML = '<div class="dim">WOCHENLAGE NICHT ERREICHBAR</div>';
  });
  return el;
}
