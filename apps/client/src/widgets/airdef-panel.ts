import { distance, hitChance, type PlaneView, type SamSpec, type Snapshot, type Vec2 } from '@tk/shared';
import { net } from '../net.js';
import { store } from '../store.js';
import { esc, h, km, setHtml, tdeg3 } from './format.js';
import type { MenuItem } from './menu.js';

/**
 * Air defence at the escort's weapons station ("Flugabwehr"): air tracks with range, height
 * and whether they are inside the launcher's envelope, the estimated kill chance, fire on the
 * selected track, missiles in flight, and the request for interceptors from land.
 */

const NAME: Record<PlaneView['kind'], string> = { airliner: 'VERKEHR', light: 'KLEINFLZ', recon: 'AUFKL', mpa: 'SEEAUFKL', helo: 'HUBSCHR' };
/** Selected air track (shared by the panel and the right-click menus). */
export const airSel: { id?: string } = {};

function spec(s: Snapshot): SamSpec | undefined {
  const a = s.airdef?.sam;
  return a && { ...a, magazine: a.left, cycleS: 0 };
}

const altText = (alt?: number) => (alt === undefined ? '—' : alt >= 1000 ? `${(alt / 1000).toFixed(1).replace('.', ',')} KM` : `${Math.round(alt / 10) * 10} M`);

/** Can the own launcher engage this track now? Text and whether to allow firing. */
export function samStatus(s: Snapshot, p: PlaneView): { ok: boolean; text: string; pk?: number; range?: number } {
  const sp = spec(s);
  if (!sp) return { ok: false, text: 'KEIN STARTER' };
  if (p.side === 'friend' || p.side === 'neutral') return { ok: false, text: p.side === 'friend' ? 'EIGENES LFZ' : 'ZIVIL' };
  if (!p.via.includes('radar') || p.x === undefined || p.y === undefined) return { ok: false, text: s.own.radarOn ? 'KEINE RADARSPUR' : 'NUR ESM · RADAR EIN' };
  const r = distance(s.own, { x: p.x, y: p.y });
  const alt = p.alt ?? 0;
  if (r > sp.maxRange) return { ok: false, text: 'ZU WEIT', range: r };
  if (r < sp.minRange) return { ok: false, text: 'ZU NAH', range: r };
  if (alt > sp.maxAlt) return { ok: false, text: 'ZU HOCH', range: r };
  if (alt < sp.minAlt) return { ok: false, text: 'ZU TIEF', range: r };
  return { ok: true, text: 'IM BEREICH', pk: hitChance(sp, r, alt, false), range: r };
}

/** Right-click on an air track (plot, radar): fire, or why not; and interceptors. tol = pick radius in m. */
export function samAction(p: Vec2, tol: number): MenuItem[] {
  const s = store.snap;
  if (!s?.airdef) return [];
  const hit = (s.planes ?? [])
    .filter((x) => x.x !== undefined && x.y !== undefined && x.side !== 'friend')
    .map((x) => ({ x, d: distance(p, { x: x.x!, y: x.y! }) }))
    .filter((c) => c.d < tol)
    .sort((a, b) => a.d - b.d)[0]?.x;
  if (!hit) return [];
  const st = samStatus(s, hit);
  const items: MenuItem[] = [{ label: `Luftziel ${NAME[hit.kind]} ${hit.id} wählen`, run: () => (airSel.id = hit.id) }];
  if (s.airdef.sam && hit.side !== 'neutral') {
    items.push(st.ok
      ? { label: `Flugabwehr: Feuer auf ${NAME[hit.kind]} (${km(st.range!)} · TREFFER CA. ${Math.round((st.pk ?? 0) * 100)} %)`, danger: true, run: () => { airSel.id = hit.id; net.send({ t: 'sam', planeId: hit.id }); } }
      : { label: `Flugabwehr: ${st.text}`, run: () => undefined });
  }
  if (hit.side === 'hostile' && s.airdef.fighter) items.push(...fighterAction(s));
  return items;
}

function fighterAction(s: Snapshot): MenuItem[] {
  const f = s.airdef?.fighter;
  if (!f) return [];
  if (f.arriveInS !== undefined || f.onStation) return [{ label: f.onStation ? 'Abfangjäger im Einsatzraum' : `Abfangjäger unterwegs · ${Math.ceil(f.arriveInS! / 60)} min`, run: () => undefined }];
  if (f.left <= 0) return [{ label: 'Keine Abfangjäger mehr', run: () => undefined }];
  if (f.readyInS > 0) return [{ label: `Abfangjäger bereit in ${Math.ceil(f.readyInS / 60)} min`, run: () => undefined }];
  return [{ label: `Abfangjäger anfordern (${f.left} Einsätze)`, run: () => net.send({ t: 'fighter' }) }];
}

export function airDefPanel(): { el: HTMLElement; update(): void } {
  const el = h(`<div class="panel"><div class="hd"><span>Flugabwehr</span><span id="ad-mag"></span></div>
    <div id="ad-list"></div>
    <div class="row"><span class="dim">ZIEL</span><span id="ad-sel" class="amber">—</span></div>
    <div style="display:flex;gap:4px;margin-top:6px"><button id="ad-fire" class="fire" style="flex:1">Feuer</button><button id="ad-ftr" style="flex:1">Abfangjäger anfordern</button></div>
    <div id="ad-fk" style="margin-top:4px"></div>
  </div>`);
  const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  q('#ad-list').addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-air]');
    if (row) airSel.id = row.dataset.air;
  });
  q<HTMLButtonElement>('#ad-fire').onclick = () => airSel.id && net.send({ t: 'sam', planeId: airSel.id });
  q<HTMLButtonElement>('#ad-ftr').onclick = () => net.send({ t: 'fighter' });
  return {
    el,
    update() {
      const s = store.snap;
      const a = s?.airdef;
      el.style.display = a?.sam || a?.fighter ? '' : 'none';
      if (!s || !a) return;
      q('#ad-mag').textContent = a.sam ? `${a.sam.left} FK · ${Math.round(a.sam.maxRange / 1000)} KM / ${(a.sam.maxAlt / 1000).toFixed(0)} KM HÖHE` : '';
      const air = (s.planes ?? []).filter((p) => p.side !== 'friend' && p.side !== 'neutral');
      if (airSel.id && !air.some((p) => p.id === airSel.id)) airSel.id = undefined;
      if (!airSel.id && air.length === 1) airSel.id = air[0]!.id;
      setHtml(q('#ad-list'), air.length ? air.map((p) => {
        const st = samStatus(s, p);
        const sel = p.id === airSel.id;
        return `<div class="row" data-air="${esc(p.id)}" style="cursor:pointer${sel ? ';background:rgba(250,199,117,0.12)' : ''}">
          <span class="${sel ? 'amber' : ''}">${NAME[p.kind]} ${esc(p.id)} · ${tdeg3(p.bearing)}° · ${st.range !== undefined ? km(st.range) : '—'} · ${altText(p.alt)}</span>
          <span class="${st.ok ? '' : 'dim'}">${st.text}${st.pk !== undefined ? ` · ${Math.round(st.pk * 100)} %` : ''}</span></div>`;
      }).join('') : '<div class="dim">KEIN FEINDLICHES LUFTZIEL · ESM UND RADAR BEOBACHTEN</div>');
      const target = air.find((p) => p.id === airSel.id);
      const st = target ? samStatus(s, target) : undefined;
      q('#ad-sel').textContent = target ? `${NAME[target.kind]} ${target.id}${st?.pk !== undefined ? ` · TREFFER CA. ${Math.round(st.pk * 100)} %` : ` · ${st?.text ?? ''}`}` : '—';
      const fire = q<HTMLButtonElement>('#ad-fire');
      fire.disabled = !st?.ok || !a.sam || a.sam.left <= 0 || a.sam.readyInS > 0;
      fire.classList.toggle('armed', !fire.disabled);
      fire.textContent = a.sam && a.sam.readyInS > 0 ? `Starter lädt ${Math.ceil(a.sam.readyInS)} s` : 'Feuer';
      fire.style.display = a.sam ? '' : 'none';
      const f = a.fighter;
      const ftr = q<HTMLButtonElement>('#ad-ftr');
      ftr.disabled = !f || f.left <= 0 || f.readyInS > 0 || f.arriveInS !== undefined || f.onStation || !air.some((p) => p.side === 'hostile');
      ftr.textContent = !f ? 'Abfangjäger anfordern'
        : f.onStation ? 'Jäger im Einsatzraum'
          : f.arriveInS !== undefined ? `Jäger in ${Math.ceil(f.arriveInS / 60)} min`
            : f.left <= 0 ? 'Keine Jäger mehr'
              : f.readyInS > 0 ? `Jäger bereit in ${Math.ceil(f.readyInS / 60)} min` : `Abfangjäger anfordern (${f.left})`;
      const mine = a.missiles.filter((m) => m.own);
      setHtml(q('#ad-fk'), mine.map((m) => {
        const tgt = (s.planes ?? []).find((p) => p.id === m.targetId);
        const left = tgt?.x !== undefined && a.sam ? Math.max(0, Math.round(distance(m, { x: tgt.x, y: tgt.y! }) / a.sam.speedMs)) : undefined;
        return `<div class="row"><span>FK ${esc(m.id)} → ${esc(m.targetId)}</span><span class="${m.done === 'hit' ? 'amber' : m.done ? 'dim' : ''}">${
          m.done === 'hit' ? 'ABSCHUSS' : m.done === 'miss' ? 'VERFEHLT' : `${m.age} S${left !== undefined ? ` · NOCH CA. ${left} S` : ''}`}</span></div>`;
      }).join(''));
    },
  };
}
