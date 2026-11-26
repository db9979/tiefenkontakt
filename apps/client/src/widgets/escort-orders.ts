import { gridRef, type EscortCommandView, type Snapshot } from '@tk/shared';
import { gameDeg, trueDeg } from '../north.js';
import { net } from '../net.js';
import { esc, h, setHtml, setText } from './format.js';

/**
 * Escort commander's panel (C15): convoy orders (emergency turn 45°, zigzag, speed ±2 kn, the
 * sideways detour) as segmented buttons, and the side's AI escorts with their current task and a
 * task picker. Tasks at a point (sector, datum, helicopter, station there) come from the plot's
 * right-click menu ("Auftrag an <Schiff>", widgets/actions.ts).
 */

/** Detour steps (m, − = port of the convoy's leg) and their button labels. */
const DETOURS: [number, string][] = [[-3000, '◀ 3 km'], [-1500, '◀ 1,5 km'], [0, 'Route'], [1500, '1,5 km ▶'], [3000, '3 km ▶']];

/** Stations relative to the convoy's course offered in the picker: [relative bearing, range m, label]. */
const STATIONS: [number, number, string][] = [
  [0, 6000, 'Station voraus 6 km'], [90, 6000, 'Station Steuerbord 6 km'], [270, 6000, 'Station Backbord 6 km'],
  [180, 6000, 'Station achteraus 6 km'], [0, 10_000, 'Vorposten voraus 10 km'],
];

const ROLE: Record<string, string> = {
  screen: 'SICHERUNG', hunter: 'VERFOLGT', director: 'HÄLT KONTAKT', attacker: 'GREIFT AN',
  station: 'STATION', sector: 'SEKTOR', datum: 'DATUM', helo: 'HUBSCHRAUBER',
};

type Esc = EscortCommandView['escorts'][number];

function taskText(e: Esc): string {
  const t = e.task;
  if (!t) return ROLE[e.role ?? 'screen'] ?? 'SICHERUNG';
  const min = Math.floor(t.sinceS / 60);
  const where = t.kind === 'station'
    ? `${Math.round(t.rel ?? 0)}° REL · ${((t.range ?? 0) / 1000).toFixed(1).replace('.', ',')} KM`
    : t.x !== undefined && t.y !== undefined ? gridRef(t.x, t.y) : '';
  return `BEFOHLEN: ${ROLE[t.kind]} ${where} · ${min} MIN`;
}

function picker(e: Esc, datum: boolean): string {
  const opts = [
    `<option value="">Auftrag …</option>`,
    `<option value="cancel">Zurück in die Sicherung</option>`,
    ...STATIONS.map(([rel, r, l]) => `<option value="st:${rel}:${r}">${l}</option>`),
    ...(datum ? [`<option value="datum">Team-Datum verfolgen</option>`] : []),
    ...(datum && e.helo ? [`<option value="helo">Hubschrauber zum Team-Datum</option>`] : []),
  ];
  return `<select data-pick="${esc(e.id)}" title="Auftrag an ${esc(e.name)} · Punkte auf der Karte: Rechtsklick">${opts.join('')}</select>`;
}

export function mountEscortOrders(el: HTMLElement): { update(s: Snapshot): void; dispose?(): void } {
  const root = h(`<div class="escort-orders">
    <div data-conv>
      <div class="row"><span class="dim">KONVOI</span><span data-cstate></span></div>
      <div class="row"><span class="dim">KURS BEFEHLEN</span><span class="seg">
        <input data-crs type="number" min="0" max="359" step="5" placeholder="°" title="Neuer Generalkurs des Konvois (rechtweisend); auf der Karte: Rechtsklick → Verband ▸ → Konvoi-Kurs hierher" style="width:64px;text-align:right">
        <button data-crs-go title="Den Konvoi auf diesen Kurs legen (gilt, bis er zurück auf die Route geschickt wird)">BEFEHLEN</button>
        <button data-crs-route title="Konvoi zurück auf die geplante Route">ROUTE</button></span></div>
      <div class="row"><span class="dim">NOTWENDE 45° · 10 MIN</span><span class="seg">
        <button data-turn="-1" title="Notwende 45° nach Backbord, 10 Minuten halten, dann zurück auf die Route">◀ BB</button>
        <button data-turn="0" title="Keine Notwende: auf der Route">KURS</button>
        <button data-turn="1" title="Notwende 45° nach Steuerbord, 10 Minuten halten, dann zurück auf die Route">STB ▶</button></span></div>
      <div class="row"><span class="dim">ZICKZACK</span><span class="seg">
        <button data-zz="1" title="Zickzack fahren (schwerer zu treffen, langsamer voran)">AN</button>
        <button data-zz="0" title="Gerader Kurs auf der Route">AUS</button></span></div>
      <div class="row"><span class="dim">FAHRT</span><span class="seg">
        <button data-spd="-2" title="Konvoi 2 kn langsamer (leiser)">−2 KN</button>
        <button data-spd="0" title="Fahrt laut Route">ROUTE</button>
        <button data-spd="2" title="Konvoi 2 kn schneller (lauter, früher durch)">+2 KN</button></span></div>
      <div class="row"><span class="dim">KONVOI UMLEITEN</span><span data-detour-st class="dim"></span></div>
      <div class="steps">${DETOURS.map(([m, l]) => `<button data-detour="${m}" title="${m ? `Kurs des Konvois ${String(Math.abs(m) / 1000).replace('.', ',')} km nach ${m < 0 ? 'Backbord' : 'Steuerbord'} versetzen (z. B. um eine Minensperre)` : 'Zurück auf die befohlene Route'}">${l}</button>`).join('')}</div>
    </div>
    <div class="dim" data-noconv style="display:none;margin-bottom:4px">KEIN KONVOI · NUR DIE GELEITSCHIFFE</div>
    <div data-esc></div>
    <div class="dim" data-hint style="margin-top:4px">SEKTOR, DATUM, HUBSCHRAUBER, STATION AN EINEM PUNKT: RECHTSKLICK AUF DIE KARTE → VERBAND ▸</div>
  </div>`);
  el.appendChild(root);
  const send = net.send.bind(net);
  root.querySelectorAll<HTMLButtonElement>('[data-turn]').forEach((b) => (b.onclick = () => send({ t: 'convoy_order', order: 'turn', side: Number(b.dataset.turn) as -1 | 0 | 1 })));
  const crsIn = root.querySelector<HTMLInputElement>('[data-crs]')!;
  const orderCourse = () => {
    const v = Number(crsIn.value);
    if (crsIn.value.trim() === '' || !Number.isFinite(v)) {
      // Nothing to order: flash the field red so the click is not silently lost
      crsIn.classList.remove('bad');
      void crsIn.offsetWidth;
      crsIn.classList.add('bad');
      crsIn.focus();
      return;
    }
    send({ t: 'convoy_order', order: 'course', course: gameDeg(((Math.round(v) % 360) + 360) % 360) });
  };
  root.querySelector<HTMLButtonElement>('[data-crs-go]')!.onclick = orderCourse;
  crsIn.onkeydown = (e) => e.key === 'Enter' && orderCourse();
  root.querySelector<HTMLButtonElement>('[data-crs-route]')!.onclick = () => send({ t: 'convoy_order', order: 'course' });
  root.querySelectorAll<HTMLButtonElement>('[data-zz]').forEach((b) => (b.onclick = () => send({ t: 'convoy_order', order: 'zigzag', on: b.dataset.zz === '1' })));
  root.querySelectorAll<HTMLButtonElement>('[data-spd]').forEach((b) => (b.onclick = () => send({ t: 'convoy_order', order: 'speed', adj: Number(b.dataset.spd) })));
  root.querySelectorAll<HTMLButtonElement>('[data-detour]').forEach((b) => (b.onclick = () => send({ t: 'convoy_detour', offset: Number(b.dataset.detour) })));
  let last: Snapshot | undefined;
  const onChange = (e: Event) => {
    // Only the task pickers: the course field also fires change (on blur) and must keep its value
    if (!(e.target as HTMLElement).matches('select[data-pick]')) return;
    const sel = e.target as HTMLSelectElement;
    const id = sel.dataset.pick;
    const v = sel.value;
    sel.value = '';
    if (!id || !v) return;
    const d = last?.hunt?.datum;
    if (v === 'cancel') send({ t: 'escort_task', shipId: id, task: 'cancel' });
    else if (v.startsWith('st:')) {
      const [, rel, r] = v.split(':');
      send({ t: 'escort_task', shipId: id, task: 'station', rel: Number(rel), range: Number(r) });
    } else if ((v === 'datum' || v === 'helo') && d) send({ t: 'escort_task', shipId: id, task: v, x: d.x, y: d.y });
  };
  root.addEventListener('change', onChange);
  const list = root.querySelector<HTMLElement>('[data-esc]')!;
  return {
    update(s: Snapshot) {
      last = s;
      const cmd = s.command;
      const c = cmd?.convoy;
      (root.querySelector('[data-conv]') as HTMLElement).style.display = c ? '' : 'none';
      // No convoy (Meerenge) or nothing to command: say so instead of an empty tab
      const noconv = root.querySelector('[data-noconv]') as HTMLElement;
      noconv.style.display = c ? 'none' : '';
      setText(noconv, cmd ? 'KEIN KONVOI · NUR DIE GELEITSCHIFFE' : 'KEIN KONVOI · KEINE KI-GELEITSCHIFFE IM VERBAND');
      list.style.display = cmd ? '' : 'none';
      if (!cmd) {
        (root.querySelector('[data-hint]') as HTMLElement).style.display = 'none';
        return;
      }
      if (c) {
        root.querySelector('[data-cstate]')!.textContent = `${c.course !== undefined ? `KURS ${String(Math.round(trueDeg(c.course)) % 360).padStart(3, '0')}° · ` : 'AUF ROUTE · '}${c.speedKn.toFixed(0)} KN${c.zigzag ? ' · ZICKZACK' : ''}${c.turn ? ` · NOTWENDE ${c.turn.side < 0 ? 'BB' : 'STB'} NOCH ${Math.ceil(c.turn.leftS / 60)} MIN` : ''}`;
        root.querySelector<HTMLButtonElement>('[data-crs-route]')!.classList.toggle('on', c.course === undefined);
        if (c.course !== undefined && document.activeElement !== crsIn) crsIn.value = String(Math.round(trueDeg(c.course)) % 360);
        const side = c.turn?.side ?? 0;
        root.querySelectorAll<HTMLButtonElement>('[data-turn]').forEach((b) => b.classList.toggle('on', Number(b.dataset.turn) === side));
        root.querySelectorAll<HTMLButtonElement>('[data-zz]').forEach((b) => b.classList.toggle('on', (b.dataset.zz === '1') === c.zigzag));
        root.querySelectorAll<HTMLButtonElement>('[data-spd]').forEach((b) => b.classList.toggle('on', Number(b.dataset.spd) === c.adj));
        const off = c.offset ?? 0;
        root.querySelector('[data-detour-st]')!.textContent = off ? `${(Math.abs(off) / 1000).toFixed(1).replace('.', ',')} KM ${off < 0 ? 'BB' : 'STB'}` : 'AUF ROUTE';
        root.querySelectorAll<HTMLButtonElement>('[data-detour]').forEach((b) => b.classList.toggle('on', Number(b.dataset.detour) === off));
      }
      const datum = !!s.hunt?.datum;
      setHtml(list, cmd.escorts.length
        ? cmd.escorts.map((e) => `<div class="row"><span>${esc(e.name)}<br><span class="${e.task ? 'amber' : 'dim'}">${esc(taskText({ ...e, task: e.task && { ...e.task, sinceS: Math.floor(e.task.sinceS / 60) * 60 } }))}</span></span>${picker(e, datum)}</div>`).join('')
        : '<div class="dim">KEINE KI-GELEITSCHIFFE IM VERBAND</div>');
      (root.querySelector('[data-hint]') as HTMLElement).style.display = cmd.escorts.length ? '' : 'none';
    },
    dispose() {
      root.removeEventListener('change', onChange);
      root.remove();
    },
  };
}
