import { bearing, distance, targetPosAt, type Vec2 } from '@tk/shared';
import { net } from '../net.js';
import { store } from '../store.js';
import { btnState } from './btn-state.js';
import { lastFix } from './contact-pos.js';
import { guardFire, targetCheck } from './fire-guard.js';
import { h, km, setHtml } from './format.js';

/**
 * Helicopter tab of the OPZ (placeholder until the task-queue panel lands; it carries what the
 * old Flug station did): helicopter state and stock, tasks aimed at the selected contact
 * (dipping sonar, buoy, MAD, attack), the patrol aircraft's buoy barrier and the buoys in the
 * water. The chart keeps the same tasks on right-click / long press for any point.
 */

const KIND = { buoy: 'BOJEN LEGEN', dip: 'TAUCHSONAR', torpedo: 'TORPEDOANGRIFF', mpa: 'SEEFERNAUFKLÄRER', mad: 'MAD-SUCHE' } as const;

/** Where the selected contact probably is: a fresh fix, else the TMA solution. */
function targetPoint(): Vec2 | undefined {
  const s = store.snap;
  const c = store.selectedContact();
  if (!s || !c) return undefined;
  const fix = lastFix(c, s, 120);
  if (fix) return fix.pos;
  const sol = store.solutions.get(c.label);
  return sol ? targetPosAt(sol, s.time + 60) : undefined;
}

export function mountHeloPanel(host: HTMLElement): { update(): void; dispose(): void } {
  const el = h(`<div class="helo-panel">
    <div class="row"><span class="dim">BORDHUBSCHRAUBER</span><span id="fl-st"></span></div>
    <div id="fl-rows"></div>
    <div class="subhd"><span>Auftrag zum gewählten Kontakt</span><span id="fl-tgt" class="amber"></span></div>
    <div class="grid2">
      <button data-task="dip" title="Hubschrauber schwebt dort und senkt das Tauchsonar ab (Tiefe nach der gemessenen Schicht)">Tauchsonar</button>
      <button data-task="buoy" title="Eine passive Sonarboje dort abwerfen (Tiefe nach der gemessenen Schicht)">Boje</button>
      <button data-task="mad" title="Magnetsonde: Kleeblatt über dem Punkt, findet getauchte Boote nur sehr nah">MAD</button>
      <button id="fl-torp" class="fire" title="Hubschrauber wirft einen Leichttorpedo über dem Ziel">Angriff</button>
    </div>
    <div class="subhd"><span>Seefernaufklärer</span><span id="fl-mpa" class="dim"></span></div>
    <button id="fl-barrier" title="Der Seefernaufklärer legt 6 Bojen quer zur Peilung über dem Ziel">Bojensperre über dem Ziel</button>
    <div class="subhd"><span>Bojen im Wasser</span></div><div id="fl-buoys"></div>
  </div>`);
  host.appendChild(el);
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const at = (): { b: number; d: number } | undefined => {
    const s = store.snap;
    const p = targetPoint();
    return s && p ? { b: bearing(s.own, p), d: distance(s.own, p) } : undefined;
  };
  const ready = () => {
    const a = store.snap?.air;
    if (!a) return 'KEIN HUBSCHRAUBER';
    if (a.heloReadyInS > 0) return `BEREIT IN ${Math.ceil(a.heloReadyInS / 60)} MIN`;
    return undefined;
  };
  // Below the layer once it is measured: that is where a careful boat hides
  const deep = () => store.snap?.env.layerDepth !== undefined;
  el.querySelectorAll<HTMLButtonElement>('[data-task]').forEach((b) => guardFire(b, () => {
    const t = at();
    return !store.selectedContact() ? { block: 'KONTAKT WÄHLEN' } : !t ? { block: 'KEINE POSITION' } : ready() ? { block: ready() } : t.d > 30_000 ? { block: 'ZU WEIT' } : {};
  }, () => {
    const t = at();
    if (!t) return;
    const task = b.dataset.task!;
    if (task === 'dip') net.send({ t: 'dip', bearing: t.b, range: t.d, deep: deep() });
    else if (task === 'buoy') net.send({ t: 'buoy', bearing: t.b, range: t.d, deep: deep() });
    else net.send({ t: 'mad', bearing: t.b, range: t.d });
  }));
  guardFire(q<HTMLButtonElement>('#fl-torp'), () => {
    const t = at();
    if (!t) return { block: store.selectedContact() ? 'KEINE POSITION' : 'KONTAKT WÄHLEN' };
    if (ready()) return { block: ready() };
    if (!store.snap?.air?.heloTorps) return { block: 'KEIN TORPEDO' };
    return targetCheck(targetPoint());
  }, () => {
    const t = at();
    if (t) net.send({ t: 'helotorp', bearing: t.b, range: t.d });
  });
  guardFire(q<HTMLButtonElement>('#fl-barrier'), () => {
    const a = store.snap?.air;
    if (!at()) return { block: store.selectedContact() ? 'KEINE POSITION' : 'KONTAKT WÄHLEN' };
    if (!a || a.mpaReadyInS > 0) return { block: a ? `BEREIT IN ${Math.ceil(a.mpaReadyInS / 60)} MIN` : 'NICHT VERFÜGBAR' };
    if (a.mpaBuoys < 6) return { block: 'KEINE BOJEN MEHR' };
    return {};
  }, () => {
    const t = at();
    if (t) net.send({ t: 'mpa', bearing: t.b, range: t.d });
  });

  return {
    update() {
      const s = store.snap;
      if (!s) return;
      const a = s.air;
      const helo = a?.helos.find((x) => x.kind !== 'mpa');
      q('#fl-st').className = !a ? 'dim' : a.heloReadyInS > 0 ? 'amber' : '';
      q('#fl-st').textContent = !a ? '—' : helo ? `IN DER LUFT · ${KIND[helo.kind]}${helo.hovering ? ' · SCHWEBT' : ''}` : a.heloReadyInS > 0 ? `WARTUNG · BEREIT IN ${Math.ceil(a.heloReadyInS / 60)} MIN` : 'AN DECK · BEREIT';
      setHtml(q('#fl-rows'), a ? `
        <div class="row"><span class="dim">SONARBOJEN AN BORD</span><span>${a.stock}</span></div>
        <div class="row"><span class="dim">LEICHTTORPEDOS</span><span>${a.heloTorps}</span></div>` : '<div class="dim">KEIN HUBSCHRAUBER AN BORD</div>');
      const c = store.selectedContact();
      const t = at();
      q('#fl-tgt').textContent = c ? `${c.label}${t ? ` · ${km(t.d)}` : ' · KEINE POSITION'}` : 'KEINER';
      q('#fl-mpa').textContent = !a ? '—' : a.mpaReadyInS > 0 ? `BEREIT IN ${Math.ceil(a.mpaReadyInS / 60)} MIN` : `BEREIT · ${a.mpaBuoys} BOJEN`;
      btnState(q('#fl-torp'), a ? { label: String(a.heloTorps), tone: a.heloTorps ? undefined : 'empty' } : {});
      setHtml(q('#fl-buoys'), a?.buoys.length ? a.buoys.map((b) => `<div class="row"><span>${b.id}${b.active ? ' · AKTIV' : ''}</span><span>${km(distance(s.own, b))} · ${b.depth} M</span><span class="dim">NOCH ${Math.ceil(b.leftS / 60)} MIN</span></div>`).join('') : '<div class="dim">KEINE BOJE IM WASSER</div>');
    },
    dispose() {
      el.remove();
    },
  };
}
