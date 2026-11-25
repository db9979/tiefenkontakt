import { MORTAR_MAX, MORTAR_MIN, ROCKET_MIN_RANGE, angleDiff, bearing, distance, headingVec, lightSearchDepths, targetPosAt } from '@tk/shared';
import { net } from '../../net.js';
import { btnState, tubeTag } from '../../widgets/btn-state.js';
import { guardFire, targetCheck } from '../../widgets/fire-guard.js';
import { store } from '../../store.js';
import type { Station } from '../../screens/game.js';
import { renderContactList } from '../../widgets/contact-list.js';
import { h, km, setHtml, tdeg1 } from '../../widgets/format.js';
import { lastFix } from '../../widgets/contact-pos.js';
import { Plot } from '../../widgets/plot.js';
import { fillBox } from '../../widgets/fill.js';
import { tubeBank } from '../../widgets/tube-bank.js';
import { samAction } from '../../widgets/airdef-panel.js';
import { buoyAction, courseAction, mpaAction, rocketAction, ssmAction } from '../../widgets/actions.js';
import { keycap } from '../../widgets/keys.js';

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
  // Left (45 %): the target, the weapons as a 2×2 grid of cards (rocket, tubes, ahead-thrower,
  // torpedo defence; the anti-ship missile as a fifth card where fitted) and the contact list,
  // the one part that scrolls. Right: the target chart at full height.
  const el = h(`<div class="st wpn">
    <div class="st-col">
      <div class="panel"><div class="hd"><span>Waffenleitstand · Ziel</span><span id="src" class="dim"></span></div><div id="target"></div></div>
      <div class="wgrid">
        <div class="panel wcard"><div class="hd"><span>ASW-Rakete</span></div>
          <div class="wbody"><div id="rk" class="wstat"></div><div class="dim">LEICHTGEWICHTSTORPEDO 1,8–18 KM, FLUGZEIT CA. 40 S, STREUUNG ETWA 150&nbsp;M. SUCHT ÜBER UND UNTER DER GEMESSENEN SCHICHT.</div></div>
          <button id="rocket" class="fire">Rakete auf Ziel${keycap('rocket')}</button>
        </div>
        <div class="panel wcard"><div class="hd"><span>Torpedorohre</span></div>
          <div class="wbody"><div id="tb" class="wstat"></div><div id="tubes-slot"></div><div class="row"><span class="dim">SUCHTIEFE</span><span id="tdep"></span></div></div>
          <button id="tube" class="fire">Torpedo auf Zielpeilung</button>
        </div>
        <div class="panel wcard"><div class="hd"><span>Werfer</span></div>
          <div class="wbody"><div id="dcn" class="wstat"></div><div class="dim">ZIEL 400–800 M VORAUS AUF EIGENEM KURS</div><div class="row"><span class="dim">ZIEL</span><span id="dcz"></span></div></div>
          <span class="seg wide">${[50, 100, 150, 200].map((d) => `<button data-dc="${d}" class="fire">${d} m</button>`).join('')}</span>
        </div>
        <div class="panel wcard"><div class="hd"><span>Torpedoabwehr</span></div>
          <div class="wbody"><div id="dec-st" class="wstat"></div><div class="dim">NIXIE-SCHLEPPE: LOCKT ANLAUFENDE TORPEDOS, RAUSCHT ABER IM EIGENEN SONAR. HÖCHSTENS 25 KN.</div></div>
          <button id="decoy" class="warn" title="Nixie-Schleppe ausbringen oder einholen (Taste T)">Täuschkörper${keycap('decoy')}</button>
        </div>
        <div id="ssmp" class="panel wcard span2" style="display:none"><div class="hd"><span>Seezielflugkörper</span></div>
          <div class="wbody"><div id="ssmn" class="wstat"></div><div class="dim">SEA-SKIMMER 6–40 KM, CA. 290 M/S. SUCHKOPF ÖFFNET 9 KM VOR DEM ZIELPUNKT UND NIMMT DAS GRÖSSTE ECHO IM KEGEL · AUCH NEUTRALE.</div></div>
          <button id="ssm" class="fire">FK auf Ziel</button>
        </div>
      </div>
      <div class="panel grow listpanel"><div class="hd"><span>Kontakte</span></div><div id="list" class="scroll"></div></div>
    </div>
    <div class="st-col">
      <div class="panel grow"><div class="hd"><span>Zielkarte</span><span class="dim">RECHTSKLICK = RAKETE HIERHER</span></div>
        <div class="fill" id="plot-box"><canvas id="plot"></canvas></div>
      </div>
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
  const tooClose = () => ((aim()?.range ?? Infinity) < ROCKET_MIN_RANGE ? { block: 'ZU NAH · UNTER 1,8 KM' } : {});
  guardFire(q<HTMLButtonElement>('#rocket'), () => ({ ...needsFix(), ...tooClose(), ...targetCheck(aimPoint()) }), () => {
    const a = aim();
    if (a) net.send({ t: 'rocket', bearing: a.bearing, range: Math.min(20_000, Math.max(ROCKET_MIN_RANGE, a.range)) });
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
    // The search depth comes from the measured layer (weapons.ts); the field is only for the old protocol
    net.send({ t: 'fire', heading: b, enableAfter: 500, mode: 'active', searchDepth: 100, speedKn: 45 });
  });
  el.querySelectorAll<HTMLButtonElement>('[data-dc]').forEach((b) => (b.onclick = () => net.send({ t: 'dc', depth: Number(b.dataset.dc) })));
  q<HTMLButtonElement>('#decoy').onclick = () => net.send({ t: 'toggle', what: 'decoy', on: !store.snap?.own.loadout.towedDecoy });
  const plot: Plot = new Plot(q<HTMLCanvasElement>('#plot'), {
    bearingLines: true, showConvoy: true, esmLines: true, actions: (p) => [...samAction(p, plot.scale * 14), ...ssmAction(p), ...rocketAction(p), ...buoyAction(p), ...mpaAction(p), ...courseAction(p)],
  });
  plot.scale = 30;
  const box = fillBox(q('#plot-box'), 260);
  const bank = tubeBank();
  q('#tubes-slot').replaceWith(bank.el);

  return {
    id: 'waffen',
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
      q('#tb').textContent = `${l.tubes.filter((t) => t.loaded).length}/${l.tubes.length} GELADEN · VORRAT ${l.light}`;
      bank.update(l.tubes);
      q('#dcn').textContent = `NOCH ${l.depthCharges} SALVEN`;
      const [above, below] = lightSearchDepths(s.env.layerDepth);
      // One short line: the depths, and whether the layer behind them is measured (the reason in the tooltip)
      const tdep = q('#tdep');
      setHtml(tdep, s.env.layerDepth ? `${above} / ${below} M` : s.env.noLayer ? `${above} / ${below} M · KEINE SCHICHT` : `${above} / ${below} M · <span class="amber">OHNE BT</span>`);
      tdep.title = s.env.layerDepth ? `Über und unter der gemessenen Schicht (${s.env.layerDepth} m)` : s.env.noLayer ? 'Hier keine Sprungschicht: das Wasser ist bis zum Grund durchmischt'
        : 'Schicht nicht gemessen: Bathythermograph werfen (Sonar · VDS/BT)';
      // Mortar: is the target in the field the salvo covers (400–800 m, within a few degrees of the bow)?
      const rel = a ? Math.abs(angleDiff(s.own.heading, a.bearing)) : undefined;
      const inField = a && rel !== undefined && rel < 8 && a.range >= MORTAR_MIN - 40 && a.range <= MORTAR_MAX + 40;
      setHtml(q('#dcz'), !a ? '<span class="dim">KEINE ENTFERNUNG</span>'
        : inField ? '<span>IM WURFFELD</span>'
        : `<span class="amber">${km(a.range)} · ${tdeg1(a.bearing)}° · BUG AUF DAS ZIEL, 400–800 M</span>`);
      btnState(q('#decoy'), { on: l.towedDecoy });
      q('#dec-st').textContent = l.towedDecoy ? 'AUSGEBRACHT' : 'EINGEHOLT';
      btnState(q('#rocket'), l.rockets ? { label: String(l.rockets) } : { label: 'LEER', tone: 'empty' });
      // The tube bank above shows every tube: the button keeps only its tone (and the guard's warnings)
      btnState(q('#tube'), { ...tubeTag(l.tubes), label: '' });
      if (fk) btnState(q('#ssm'), !fk.left ? { label: 'LEER', tone: 'empty' } : fk.readyInS ? { label: `LÄDT ${fk.readyInS} S`, tone: 'busy' } : { label: `${fk.left} BEREIT` });
      el.querySelectorAll<HTMLButtonElement>('[data-dc]').forEach((b) => btnState(b, { tone: l.depthCharges ? undefined : 'empty' }));
      renderContactList(q('#list'));
    },
    frame() {
      plot.draw(box.h);
    },
    dispose() {
      box.dispose();
    },
  };
}
