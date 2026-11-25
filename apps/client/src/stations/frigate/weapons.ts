import { bearing, distance, headingVec, targetPosAt } from '@tk/shared';
import { net } from '../../net.js';
import { btnState, tubeTag } from '../../widgets/btn-state.js';
import { guardFire, targetCheck } from '../../widgets/fire-guard.js';
import { store } from '../../store.js';
import type { Station } from '../../screens/game.js';
import { renderContactList } from '../../widgets/contact-list.js';
import { h, km, setHtml, tdeg1 } from '../../widgets/format.js';
import { lastFix } from '../../widgets/contact-pos.js';
import { Plot } from '../../widgets/plot.js';
import { airDefPanel, samAction } from '../../widgets/airdef-panel.js';
import { buoyAction, courseAction, mpaAction, rocketAction, ssmAction } from '../../widgets/actions.js';

/** Best current aim point for the selected contact: fresh range, else TMA solution. */
function aim(): { bearing: number; range: number; source: string } | undefined {
  const s = store.snap;
  const c = store.selectedContact();
  if (!s || !c) return undefined;
  const fix = lastFix(c, s, 45);
  if (fix) return { bearing: bearing(s.own, fix.pos), range: distance(s.own, fix.pos), source: 'ORTUNG' };
  const sol = store.solutions.get(c.label);
  if (sol) {
    const p = targetPosAt(sol, s.time + 40);
    return { bearing: bearing(s.own, p), range: distance(s.own, p), source: 'TMA-LÖSUNG' };
  }
  return undefined;
}

export function weaponsStation(): Station {
  const el = h(`<div class="cols">
    <div style="display:flex;flex-direction:column;gap:8px">
      <div class="panel"><div class="hd"><span>Waffenleitstand · Ziel</span><span id="src" class="dim"></span></div><div id="target"></div></div>
      <div class="panel"><div class="hd"><span>U-Jagd-Rakete</span><span id="rk"></span></div>
        <div class="dim">TRÄGT EINEN LEICHTGEWICHTSTORPEDO BIS 18 KM, FLUGZEIT CA. 40 S. DER TORPEDO SUCHT AKTIV IM KREIS.</div>
        <div style="display:flex;gap:4px;margin-top:6px"><button id="rocket" class="fire" style="flex:1">Rakete auf Ziel</button></div>
      </div>
      <div class="panel"><div class="hd"><span>Torpedorohre</span><span id="tb"></span></div>
        <div class="row"><span class="dim">SUCHTIEFE</span><span><input id="tdep" type="number" value="100" step="10" style="width:80px"> M</span></div>
        <button id="tube" class="fire" style="width:100%;margin-top:6px">Torpedo auf Zielpeilung</button>
      </div>
      <div class="panel"><div class="hd"><span>Wasserbomben</span><span id="dcn"></span></div>
        <div style="display:flex;gap:4px">${[50, 100, 150, 200].map((d) => `<button data-dc="${d}">${d} m</button>`).join('')}</div>
      </div>
      <div class="panel"><div class="hd"><span>Torpedoabwehr</span></div>
        <button id="decoy" class="warn">Täuschkörper-Schleppe</button>
      </div>
      <div id="ssmp" class="panel" style="display:none"><div class="hd"><span>Seezielflugkörper</span><span id="ssmn"></span></div>
        <div class="dim">SEA-SKIMMER 6–40 KM, CA. 290 M/S. SUCHKOPF ÖFFNET 9 KM VOR DEM ZIELPUNKT UND NIMMT DAS GRÖSSTE ECHO IM KEGEL · AUCH NEUTRALE.</div>
        <div style="display:flex;gap:4px;margin-top:6px"><button id="ssm" class="fire" style="flex:1">FK auf Ziel</button></div>
      </div>
      <div id="airdef"></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <div class="panel"><div class="hd"><span>Zielkarte</span><span class="dim">RECHTSKLICK = RAKETE HIERHER</span></div><canvas id="plot"></canvas></div>
      <div class="panel"><div class="hd"><span>Kontakte</span></div><div id="list"></div></div>
    </div>
  </div>`);
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  // Every weapon asks twice when the target is our own or friends are near where it lands
  const aimPoint = () => {
    const s = store.snap;
    const a = aim();
    if (!s || !a) return undefined;
    const v = headingVec(a.bearing);
    return { x: s.own.x + v.x * a.range, y: s.own.y + v.y * a.range };
  };
  const needsFix = () => (aim() ? {} : { block: 'KEINE ENTFERNUNG' });
  guardFire(q<HTMLButtonElement>('#rocket'), () => ({ ...needsFix(), ...targetCheck(aimPoint()) }), () => {
    const a = aim();
    if (a) net.send({ t: 'rocket', bearing: a.bearing, range: Math.min(20_000, Math.max(1000, a.range)) });
  });
  guardFire(q<HTMLButtonElement>('#ssm'), () => ({ ...needsFix(), ...targetCheck(aimPoint()) }), () => {
    const a = aim();
    if (a) net.send({ t: 'ssm', bearing: a.bearing, range: Math.min(60_000, Math.max(1000, a.range)) });
  });
  guardFire(q<HTMLButtonElement>('#tube'), () => targetCheck(aimPoint()), () => {
    const a = aim();
    const c = store.selectedContact();
    const b = a?.bearing ?? c?.bearing;
    if (b === undefined) return;
    net.send({ t: 'fire', heading: b, enableAfter: 500, mode: 'active', searchDepth: Number(q<HTMLInputElement>('#tdep').value) || 100, speedKn: 45 });
  });
  el.querySelectorAll<HTMLButtonElement>('[data-dc]').forEach((b) => (b.onclick = () => net.send({ t: 'dc', depth: Number(b.dataset.dc) })));
  q<HTMLButtonElement>('#decoy').onclick = () => net.send({ t: 'toggle', what: 'decoy', on: !store.snap?.own.loadout.towedDecoy });
  q<HTMLInputElement>('#tdep').onkeydown = (e) => e.stopPropagation();
  const plot: Plot = new Plot(q<HTMLCanvasElement>('#plot'), {
    bearingLines: true, showConvoy: true, esmLines: true, actions: (p) => [...samAction(p, plot.scale * 14), ...ssmAction(p), ...rocketAction(p), ...buoyAction(p), ...mpaAction(p), ...courseAction(p)],
  });
  const ad = airDefPanel();
  q('#airdef').replaceWith(ad.el);
  plot.scale = 30;

  return {
    title: 'Waffen',
    el,
    snap() {
      const s = store.snap!;
      const l = s.own.loadout;
      const c = store.selectedContact();
      const a = aim();
      q('#src').textContent = a ? a.source : c ? 'NUR PEILUNG' : '';
      setHtml(q('#target'), c
        ? `<div class="row"><span class="dim">KONTAKT</span><span class="amber">${c.label}</span></div>
           <div class="row"><span class="dim">PEILUNG</span><span>${tdeg1(a?.bearing ?? c.bearing)}°</span></div>
           <div class="row"><span class="dim">ENTFERNUNG</span><span>${a ? km(a.range) : 'UNBEKANNT · PINGEN ODER TMA'}</span></div>`
        : '<div class="dim">KONTAKT IN DER LISTE WÄHLEN</div>');
      const fk = s.ssm?.left !== undefined ? s.ssm : undefined;
      q('#ssmp').style.display = fk ? '' : 'none';
      if (fk) q('#ssmn').textContent = `${fk.left} AN BORD${fk.readyInS ? ` · LÄDT ${fk.readyInS} S` : ''}`;
      q('#rk').textContent = `${l.rockets} VERFÜGBAR`;
      q('#tb').textContent = l.tubes.map((t, i) => `R${i + 1}${t.loaded ? '' : ` ${Math.ceil(t.reloadLeft)}S`}`).join(' ') + ` · VORRAT ${l.light}`;
      q('#dcn').textContent = `${l.depthCharges} VERFÜGBAR`;
      btnState(q('#decoy'), { on: l.towedDecoy });
      btnState(q('#rocket'), l.rockets ? { label: String(l.rockets) } : { label: 'LEER', tone: 'empty' });
      btnState(q('#tube'), tubeTag(l.tubes));
      if (fk) btnState(q('#ssm'), !fk.left ? { label: 'LEER', tone: 'empty' } : fk.readyInS ? { label: `LÄDT ${fk.readyInS} S`, tone: 'busy' } : { label: `${fk.left} BEREIT` });
      el.querySelectorAll<HTMLButtonElement>('[data-dc]').forEach((b) => btnState(b, { tone: l.depthCharges ? undefined : 'empty' }));
      renderContactList(q('#list'));
      ad.update();
    },
    frame() {
      plot.draw(Math.max(260, window.innerHeight - 380));
    },
  };
}
