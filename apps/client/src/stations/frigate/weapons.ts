import { DC_SINK_RATE, MORTAR_MAX, MORTAR_MIN, ROCKET_MAX_RANGE, ROCKET_MIN_RANGE, rocketFlightS, rocketScatterM, angleDiff, bearing, distance, headingVec, lightSearchDepths, targetPosAt } from '@tk/shared';
import { net } from '../../net.js';
import { btnState, tubeTag } from '../../widgets/btn-state.js';
import { friendNear, guardFire, targetCheck, type GuardCheck } from '../../widgets/fire-guard.js';
import { FIX_AGE_S, LIGHT_TORP_RANGE, reachText, rocketCheck, torpedoCheck } from '../../widgets/weapon-reach.js';
import { store } from '../../store.js';
import type { Station } from '../../screens/game.js';
import { renderContactList } from '../../widgets/contact-list.js';
import { h, km, setHtml, tdeg3 } from '../../widgets/format.js';
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
  const fix = lastFix(c, s, FIX_AGE_S);
  if (fix) return { bearing: bearing(s.own, fix.pos), range: distance(s.own, fix.pos), source: 'ORTUNG' };
  const sol = store.solutions.get(c.label);
  if (sol) {
    const p = targetPosAt(sol, s.time + rocketFlightS(distance(s.own, targetPosAt(sol, s.time))));
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
          <div class="wbody"><div id="rk" class="wstat"></div><div class="row"><span class="dim">REICHWEITE</span><span id="rkr"></span></div><div class="dim" id="rk-note"></div></div>
          <button id="rocket" class="fire">Rakete auf Ziel${keycap('rocket')}</button>
        </div>
        <div class="panel wcard"><div class="hd"><span>Torpedorohre</span></div>
          <div class="wbody"><div id="tb" class="wstat"></div><div id="tubes-slot"></div><div class="row"><span class="dim">SUCHTIEFE</span><span id="tdep"></span></div><div class="row"><span class="dim">REICHWEITE</span><span id="trng"></span></div></div>
          <button id="tube" class="fire" title="Leichttorpedo aus dem Rohr auf die Zielpeilung">Torpedo auf Ziel</button>
        </div>
        <div class="panel wcard"><div class="hd"><span>Werfer</span></div>
          <div class="wbody"><div id="dcn" class="wstat"></div><div class="dim">ZIEL 400–800&nbsp;M VORAUS AUF EIGENEM KURS · SINKT ${DC_SINK_RATE}&nbsp;M/S</div><div class="row"><span class="dim">ZIEL</span><span id="dcz"></span></div><div class="dim wcap">SALVE AUF TIEFE ▸</div></div>
          <span class="seg wide" title="Salve aus dem Werfer: sechs Wasserbomben 400–800 m voraus, auf diese Tiefe eingestellt">${[50, 100, 150, 200].map((d) => `<button data-dc="${d}" class="fire">${d}&nbsp;m</button>`).join('')}</span>
        </div>
        <div class="panel wcard"><div class="hd"><span>Torpedoabwehr</span></div>
          <div class="wbody"><div id="dec-st" class="wstat"></div><div class="dim">NIXIE-SCHLEPPE: LOCKT ANLAUFENDE TORPEDOS, RAUSCHT ABER IM EIGENEN SONAR. HÖCHSTENS 25&nbsp;KN.</div></div>
          <button id="decoy" class="warn" title="Nixie-Schleppe ausbringen oder einholen (Taste T)">Täuschkörper${keycap('decoy')}</button>
        </div>
        <div id="ssmp" class="panel wcard span2" style="display:none"><div class="hd"><span>Seezielflugkörper</span></div>
          <div class="wbody"><div id="ssmn" class="wstat"></div><div class="dim">SEA-SKIMMER 6–40&nbsp;KM, CA. 290&nbsp;M/S. SUCHKOPF ÖFFNET 9 KM VOR DEM ZIELPUNKT UND NIMMT DAS GRÖSSTE ECHO IM KEGEL · AUCH NEUTRALE.</div></div>
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
  // The rocket's envelope first (refuse), then whose the target is (ask twice)
  const first = (...cs: GuardCheck[]): GuardCheck => cs.find((c) => c.block) ?? cs.find((c) => c.warn) ?? {};
  guardFire(q<HTMLButtonElement>('#rocket'), () => first(rocketCheck(aim()?.range), targetCheck(aimPoint())), () => {
    const a = aim();
    if (a) net.send({ t: 'rocket', bearing: a.bearing, range: Math.min(ROCKET_MAX_RANGE, Math.max(ROCKET_MIN_RANGE, a.range)) });
  });
  guardFire(q<HTMLButtonElement>('#ssm'), () => ({ ...needsFix(), ...targetCheck(aimPoint()) }), () => {
    const a = aim();
    if (a) net.send({ t: 'ssm', bearing: a.bearing, range: Math.min(60_000, Math.max(1000, a.range)) });
  });
  guardFire(q<HTMLButtonElement>('#tube'), () => first(targetCheck(aimPoint()), torpedoCheck(aim()?.range)), () => {
    const a = aim();
    const c = store.selectedContact();
    const b = a?.bearing ?? c?.bearing;
    if (b === undefined) return;
    // The search depth comes from the measured layer (weapons.ts); the field is only for the old protocol
    net.send({ t: 'fire', heading: b, enableAfter: 500, mode: 'active', searchDepth: 100, speedKn: 45 });
  });
  // Werfer: the salvo lands 400–800 m ahead; ask twice when friends are near there (no target needed: an urgent attack)
  const mortarPoint = () => {
    const s = store.snap;
    if (!s) return undefined;
    const v = headingVec(s.own.heading);
    const mid = (MORTAR_MIN + MORTAR_MAX) / 2;
    return { x: s.own.x + v.x * mid, y: s.own.y + v.y * mid };
  };
  el.querySelectorAll<HTMLButtonElement>('[data-dc]').forEach((b) => guardFire(b, () => {
    const s = store.snap;
    const p = mortarPoint();
    if (!s || !p) return { block: 'KEIN ZIEL' };
    if (!s.own.loadout.depthCharges) return { block: 'LEER' };
    return friendNear(s, p, 800) ? { warn: 'EIGENE IN DER NÄHE' } : {};
  }, () => net.send({ t: 'dc', depth: Number(b.dataset.dc) })));
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
           <div class="row"><span class="dim">PEILUNG</span><span>${tdeg3(a?.bearing ?? c.bearing)}°</span></div>
           <div class="row"><span class="dim">ENTFERNUNG</span><span>${a ? km(a.range) : 'UNBEKANNT · PINGEN ODER TMA'}</span></div>`
        : '<div class="dim">KONTAKT IN DER LISTE WÄHLEN</div>');
      const fk = s.ssm?.left !== undefined ? s.ssm : undefined;
      q('#ssmp').style.display = fk ? '' : 'none';
      if (fk) q('#ssmn').textContent = `${fk.left} AN BORD${fk.readyInS ? ` · LÄDT ${fk.readyInS} S` : ''}`;
      q('#rk').textContent = `${l.rockets} VERFÜGBAR`;
      // F20: flight time and scatter grow with the range (for the aim, else the span over the envelope)
      const rr0 = a ? Math.min(ROCKET_MAX_RANGE, Math.max(ROCKET_MIN_RANGE, a.range)) : undefined;
      q('#rk-note').textContent = rr0 !== undefined
        ? `LEICHTGEWICHTSTORPEDO, FLUGZEIT CA. ${Math.round(rocketFlightS(rr0))} S, STREUUNG ETWA ${Math.round(rocketScatterM(rr0) / 10) * 10} M. SUCHT ÜBER UND UNTER DER GEMESSENEN SCHICHT.`
        : `LEICHTGEWICHTSTORPEDO, FLUGZEIT ${Math.round(rocketFlightS(ROCKET_MIN_RANGE))}–${Math.round(rocketFlightS(ROCKET_MAX_RANGE))} S JE NACH ENTFERNUNG. SUCHT ÜBER UND UNTER DER GEMESSENEN SCHICHT.`;
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
        : `<span class="amber">${km(a.range)} · ${tdeg3(a.bearing)}° · BUG AUF DAS ZIEL, 400–800&nbsp;M</span>`);
      const rr = reachText(ROCKET_MAX_RANGE, a?.range, ROCKET_MIN_RANGE);
      setHtml(q('#rkr'), `<span class="${rr.ok ? '' : 'amber'}">${rr.text}</span>`);
      const tr = reachText(LIGHT_TORP_RANGE, a?.range);
      setHtml(q('#trng'), `<span class="${tr.ok ? '' : 'amber'}">${tr.text}</span>`);
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
