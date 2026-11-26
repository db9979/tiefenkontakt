import { lang } from '../i18n/index.js';
import { net } from '../net.js';
import { CLASS_NAME, esc, h } from '../widgets/format.js';
import { post } from './account.js';

type Cls = keyof typeof CLASS_NAME;
interface Stock { torpedoes: number; rockets: number; depthCharges: number; noisemakers: number; mines?: number; wake?: number }
interface LogEntry { n: number; day: number; title: string; cls: Cls; won: boolean; lost: boolean; reason: string; kills: number; tonnage: number; hullAfter: number; points: number }
interface Run {
  status: 'dock' | 'ready' | 'sea' | 'complete' | 'lost';
  side: 'west' | 'east';
  ship: { cls: Cls; hull: number; damage: Record<string, number>; crewLost: number; stock: Stock };
  crew: { xp: number; missions: number; kills: number; survivedAttacks: number };
  stage: number; day: number; dockDays: number; points: number; replacements: number;
  history: LogEntry[];
}
interface View {
  run: Run | null;
  past: { startedAt: number; cls: Cls; missions: number; points: number; status: string }[];
  crewLevel?: string;
  full?: Stock;
  missions?: string[];
  next?: { title: string; brief: string; enemy: string; lines: string[] } | null;
  dockCost?: Record<'keine' | 'notdienst' | 'voll', number>;
}

const STATUS: Record<Run['status'], string> = { dock: 'IN DER WERFT', ready: 'AUSLAUFBEREIT', sea: 'AUF SEE', complete: 'FELDZUG GEWONNEN', lost: 'SCHIFF VERLOREN · FELDZUG VORBEI' };
const SYS: Record<string, string> = { antrieb: 'ANTRIEB', sonar: 'SONAR', waffen: 'WAFFEN', leck: 'LECK' };
const pct = (x: number) => `${Math.round(x * 100)} %`;
const bar = (x: number, color: string) => `<span class="cbar"><i style="width:${Math.round(Math.max(0, Math.min(1, x)) * 100)}%;background:${color}"></i></span>`;

/**
 * Campaign with consequences: one ship per account. Ship state, crew level, mission history,
 * next briefing and the dockyard decision between missions.
 */
export function campaignPanel(): HTMLElement {
  const el = h(`<div class="panel campaign" style="margin-top:10px"></div>`);
  let err = '';
  const draw = (v: View) => {
    const r = v.run;
    const head = `<div class="hd"><span>Feldzug · Eigenes Schiff</span><span class="dim">SCHADEN, VERLUSTE UND MUNITION BLEIBEN</span></div>`;
    const pick = (label: string) => `<div class="dim" style="margin:6px 0">${label}</div><div class="grid2">${(['ssk', 'ssn', 'ssa', 'ssc', 'ffg', 'ffv', 'kor'] as Cls[]).map((c) =>
      `<button data-new="${c}" style="text-align:left;text-transform:none"><div>${CLASS_NAME[c].title}</div><div class="dim">${c.startsWith('ss') ? 'Ostpakt' : 'Westbund'}</div></button>`).join('')}</div>`;
    if (!r) {
      el.innerHTML = head + `<div>Ein Schiff, eine Besatzung, sechs Einsätze. Was nicht repariert wird, fährt mit. Geht das Schiff verloren, gibt es Ersatz einer kleineren Klasse – zweimal.</div>` +
        pick('SCHIFF WÄHLEN UND FELDZUG BEGINNEN') + pastRuns(v) + `<div class="err">${esc(err)}</div>`;
      bind();
      return;
    }
    const s = r.ship;
    const full = v.full!;
    const over = r.status === 'complete' || r.status === 'lost';
    el.innerHTML = head + `
      <div class="grid2">
        <div>
          <div class="row"><span>${esc(CLASS_NAME[s.cls].title)}</span><span class="${over ? (r.status === 'lost' ? 'red' : '') : 'amber'}">${STATUS[r.status]}</span></div>
          <div class="row"><span class="dim">RUMPF</span><span>${pct(s.hull)} ${bar(s.hull, s.hull < 0.5 ? 'var(--red)' : 'var(--g)')}</span></div>
          ${Object.keys(SYS).map((k) => `<div class="row"><span class="dim">${SYS[k]}</span><span>${(s.damage[k] ?? 0) > 0 ? `<span class="amber">${pct(s.damage[k]!)} <span>BESCHÄDIGT</span></span>` : 'KLAR'}</span></div>`).join('')}
          <div class="row"><span class="dim">UNBESETZTE POSTEN</span><span class="${s.crewLost ? 'amber' : ''}">${s.crewLost}</span></div>
          <div class="row"><span class="dim">TORPEDOS</span><span>${s.stock.torpedoes} / ${full.torpedoes}</span></div>
          ${full.rockets ? `<div class="row"><span class="dim">RAKETEN · WABOS</span><span>${s.stock.rockets} / ${full.rockets} · ${s.stock.depthCharges} / ${full.depthCharges}</span></div>` : ''}
          ${full.noisemakers ? `<div class="row"><span class="dim">TÄUSCHKÖRPER</span><span>${s.stock.noisemakers} / ${full.noisemakers}</span></div>` : ''}
          ${full.mines ? `<div class="row"><span class="dim">MINEN</span><span>${s.stock.mines ?? full.mines} / ${full.mines}</span></div>` : ''}
          ${full.wake ? `<div class="row"><span class="dim">KIELWASSERTORPEDOS</span><span>${s.stock.wake ?? full.wake} / ${full.wake}</span></div>` : ''}
        </div>
        <div>
          <div class="row"><span class="dim">BESATZUNG</span><span><span>${esc((v.crewLevel ?? '').toUpperCase())}</span> ${bar(r.crew.xp, 'var(--amber)')}</span></div>
          <div class="row"><span class="dim">EINSÄTZE · VERSENKT · ANGRIFFE ÜBERLEBT</span><span>${r.crew.missions} · ${r.crew.kills} · ${r.crew.survivedAttacks}</span></div>
          <div class="row"><span class="dim">TAG · PUNKTE · ERSATZSCHIFFE</span><span>${r.day} · ${r.points} · ${r.replacements}</span></div>
          <div class="dim" style="margin-top:6px">EINSÄTZE</div>
          ${(v.missions ?? []).map((m, i) => `<div class="row ${i < r.stage ? 'dim' : ''}"><span>${i < r.stage ? '✓' : i === r.stage && !over ? '▸' : '·'} ${esc(m)}</span></div>`).join('')}
        </div>
      </div>
      ${v.next && !over ? `<div class="panel" style="margin-top:8px"><div class="hd"><span>Nächster Einsatz · ${esc(v.next.title)}</span><span class="dim">KI ${esc(v.next.enemy.toUpperCase())}</span></div>
        ${v.next.lines.map((l, i) => `<div class="${i === 0 ? '' : 'amber'}">${esc(l)}</div>`).join('')}</div>` : ''}
      ${r.status === 'dock' ? dockForm(v) : ''}
      ${r.status === 'ready' || r.status === 'sea' ? `<div class="steps" style="margin-top:8px"><button id="cp-go" class="on">${r.status === 'sea' ? 'Einsatz fortsetzen' : 'Auslaufen · Einsatz starten'}</button></div>` : ''}
      ${over ? pick('NEUEN FELDZUG BEGINNEN') : ''}
      <div class="dim" style="margin-top:8px">LOGBUCH</div>
      ${r.history.length ? r.history.slice().reverse().map((e) => `<div class="row"><span>${e.n} · TAG ${e.day} · ${esc(e.title)}</span>
        <span class="${e.lost ? 'red' : e.won ? '' : 'amber'}">${e.lost ? 'VERLOREN' : e.won ? 'SIEG' : e.reason === 'Einsatz abgebrochen' ? 'ABGEBROCHEN' : 'NIEDERLAGE'} · ${e.kills} VERS. · RUMPF ${pct(e.hullAfter)} · ${e.points > 0 ? '+' : ''}${e.points} PKT</span></div>`).join('') : '<div class="dim">NOCH KEINE EINSÄTZE</div>'}
      ${pastRuns(v)}
      ${!over && r.status !== 'sea' ? '<div class="steps" style="margin-top:8px"><button id="cp-quit" class="warn" title="Feldzug beenden (nicht rückgängig)">Feldzug aufgeben</button></div>' : ''}
      <div class="err">${esc(err)}</div>`;
    bind();
  };

  const dockForm = (v: View) => {
    const c = v.dockCost!;
    return `<div class="panel" style="margin-top:8px"><div class="hd"><span>Werft</span><span class="dim">JEDER TAG GIBT DEM GEGNER ZEIT</span></div>
      <div class="steps" id="cp-repair">
        <button data-rep="keine" title="Sofort auslaufen, Schäden bleiben">Keine Reparatur · ${c.keine} T.</button>
        <button data-rep="notdienst" class="on" title="Lecks dichten, Schäden halbieren, Rumpf +20 %">Notdienst · ${c.notdienst} T.</button>
        <button data-rep="voll" title="Alles instand, neue Leute für leere Posten">Vollreparatur · ${c.voll} T.</button>
      </div>
      <label class="dim"><input type="checkbox" id="cp-sup" checked> MUNITION ERGÄNZEN (1 TAG, PARALLEL)</label>
      <div class="steps"><button id="cp-dock" class="on">Werftzeit festlegen</button></div></div>`;
  };

  const pastRuns = (v: View) => v.past.length
    ? `<div class="dim" style="margin-top:8px">FRÜHERE FELDZÜGE</div>${v.past.map((p) => `<div class="row dim"><span>${new Date(p.startedAt).toLocaleDateString(lang === 'en' ? 'en-GB' : 'de-DE')} · ${esc(CLASS_NAME[p.cls]?.title ?? p.cls)}</span><span>${p.missions} EINSÄTZE · ${p.points} PKT · ${esc(STATUS[p.status as Run['status']] ?? p.status)}</span></div>`).join('')}`
    : '';

  const act = async (url: string, body: unknown) => {
    const r = await post(url, body);
    err = r.ok ? '' : r.data.error ?? 'Fehler';
    if (r.ok) draw(r.data as unknown as View);
    else void load();
  };

  const bind = () => {
    el.querySelectorAll<HTMLButtonElement>('[data-new]').forEach((b) => (b.onclick = () => void act('/api/campaign/new', { cls: b.dataset.new })));
    let repair = 'notdienst';
    el.querySelectorAll<HTMLButtonElement>('[data-rep]').forEach((b) => (b.onclick = () => {
      repair = b.dataset.rep!;
      el.querySelectorAll('[data-rep]').forEach((x) => x.classList.toggle('on', x === b));
    }));
    el.querySelector<HTMLButtonElement>('#cp-dock')?.addEventListener('click', () => void act('/api/campaign/dock', { repair, resupply: el.querySelector<HTMLInputElement>('#cp-sup')!.checked }));
    el.querySelector<HTMLButtonElement>('#cp-go')?.addEventListener('click', () => net.send({ t: 'campaign_start' }));
    const quit = el.querySelector<HTMLButtonElement>('#cp-quit');
    if (quit) {
      let armed = false;
      quit.onclick = () => {
        if (!armed) {
          armed = true;
          quit.textContent = 'Wirklich aufgeben?';
          return;
        }
        void act('/api/campaign/abandon', {});
      };
    }
  };

  const load = async () => {
    const r = await fetch('/api/campaign');
    if (!r.ok) {
      el.innerHTML = `<div class="hd"><span>Feldzug · Eigenes Schiff</span></div><div class="dim">MIT KONTO: EIN EIGENES SCHIFF ÜBER MEHRERE EINSÄTZE, MIT SCHÄDEN, VERLUSTEN UND ERFAHRUNG.</div>`;
      return;
    }
    draw((await r.json()) as View);
  };
  void load().catch(() => undefined);
  return el;
}
