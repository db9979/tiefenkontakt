import { CLASSES, CONFUSION, RECOG, THREAT_HINT, acousticSheet, kmText, recogDraught, threatSheet, type ClassId, type ThreatLine } from '@tk/shared';
import { CLASS_LABEL, esc } from './format.js';
import { bowSvg, lofarChart, sideSvg, topSvg, type Pics } from './recog-draw.js';
import { BOW_ZOOM, bowWidthShare, scaleCat, scaleFrame } from './recog-scale.js';

/**
 * The three tabs of a class page in the recognition book: SICHT (silhouettes to scale, data,
 * lookalikes), AKUSTIK (screw, lines, sound) and BEDROHUNG (weapons, sensors, ranges, hint).
 * Every number comes from the simulation's tables.
 */

export type RecogTab = 'sicht' | 'akustik' | 'bedrohung';
export const TAB_TITLE: Record<RecogTab, string> = { sicht: 'Sicht', akustik: 'Akustik', bedrohung: 'Bedrohung' };

const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString('de-DE');
const row = (k: string, v: string) => `<div class="row"><span class="dim">${k}</span><span>${v}</span></div>`;
const head = (s: string) => `<div class="dim" style="margin-top:8px">${s}</div>`;
const NO_DATA = '<span class="dim">keine Angaben</span>';

/** Classes offered as a ghost outline: same category, the current one excluded. */
export function ghostChoices(cls: ClassId, order: readonly ClassId[]): ClassId[] {
  return order.filter((c) => c !== cls && scaleCat(c) === scaleCat(cls));
}

/** The default ghost: the first lookalike drawn at the same scale. */
export function defaultGhost(cls: ClassId): ClassId | undefined {
  return CONFUSION[cls].map(([c]) => c).find((c) => scaleCat(c) === scaleCat(cls));
}

export function sichtTab(pics: Pics, cls: ClassId, ghost: ClassId | undefined, order: readonly ClassId[], extra: string): string {
  const r = RECOG[cls];
  const spec = CLASSES[cls];
  const f = scaleFrame(scaleCat(cls));
  const options = ghostChoices(cls, order).map((c) => `<option value="${c}"${c === ghost ? ' selected' : ''}>${CLASS_LABEL[c]}</option>`).join('');
  const confusion = CONFUSION[cls].map(([c, cue]) => {
    const thumb = pics.image(c, 'side');
    return `<div class="clickable" data-go="${c}" style="display:flex;gap:6px;align-items:center;padding:3px;border:1px solid var(--line);margin-top:3px;cursor:pointer">
      ${thumb ? `<img src="${thumb}" alt="" style="height:20px;width:56px;object-fit:contain;flex:none">` : ''}
      <div style="min-width:0"><div style="font-size:0.9167rem">${CLASS_LABEL[c]}</div><div class="dim" style="line-height:1.4">${esc(cue)}</div></div></div>`;
  }).join('');
  return `
    <div style="background:var(--well);border:1px solid var(--line);padding:4px;margin:4px 0">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap">
        <span class="dim" style="font-size:0.8333rem">SEITE · MASSSTAB ${f.cat === 'sub' ? 'ALLER U-BOOTE' : 'ALLER SCHIFFE'} · GITTER ${f.grid} M</span>
        <label class="dim" style="font-size:0.8333rem;display:flex;gap:4px;align-items:center">VERGLEICH <select id="rb-ghost" style="font-size:0.8333rem;max-width:130px"><option value="">—</option>${options}</select></label>
      </div>
      ${sideSvg(pics, cls, ghost)}
      <div class="dim" style="font-size:0.8333rem;margin-top:4px">DRAUFSICHT</div>
      ${topSvg(pics, cls)}
      <div style="display:flex;gap:8px;align-items:flex-start;margin-top:4px">
        <div style="flex:none;width:${(bowWidthShare(f) * 100).toFixed(2)}%"><div class="dim" style="font-size:0.8333rem">BUG ×${BOW_ZOOM}</div>${bowSvg(pics, cls)}</div>
        <div style="flex:1;min-width:0">
          ${row('LÄNGE', `${n1(r.length)} M`)}${row('BREITE', `${n1(r.beam)} M`)}
          ${row('MASTHÖHE (STADIMETER)', `${n1(r.mast)} M`)}${row('TIEFGANG', `${n1(recogDraught(cls))} M`)}
          ${row('HÖCHSTFAHRT', `${spec.maxSpeedKn} KN`)}${row('VERDRÄNGUNG', `${spec.tonnage.toLocaleString('de-DE')} T`)}
        </div>
      </div>
    </div>
    ${head('MERKMALE')}<div style="line-height:1.45">${esc(r.cues)}</div>
    ${head('VERWECHSLUNGSGEFAHR')}${confusion}
    ${extra}
    <div class="dim" style="margin-top:6px;line-height:1.45">Lage: Bug voraus wirkt der Rumpf kurz und hoch, querab zeigt er die volle Länge. Das Stadimeter rechnet mit der Masthöhe der zugewiesenen Klasse.</div>`;
}

export function akustikTab(cls: ClassId): string {
  const a = acousticSheet(cls);
  if (!a) return `<div style="margin-top:8px">${NO_DATA}</div>`;
  const lines = (hz: number[]) => (hz.length ? `${hz.map(n1).join(' · ')} Hz` : NO_DATA);
  return `
    ${head('SIGNATUR')}<div>${esc(a.name)}</div>
    ${row('FLÜGEL', a.blades.length ? a.blades.join(' / ') : NO_DATA)}
    ${row('U/MIN JE KN', a.rpmPerKn ? n1(a.rpmPerKn) : NO_DATA)}
    ${row('TYPISCHE FAHRT', `${a.typicalKn} KN`)}
    ${row('WELLE · BLATT (DEMON)', a.shaftHz ? `${n1(a.shaftHz)} · ${n1(a.bladeHz)} HZ` : NO_DATA)}
    ${row('HÖCHSTFAHRT', `${a.maxKn} KN`)}
    ${a.cavKn ? row('KAVITATION AB (OBERFLÄCHE)', `${a.cavKn} KN`) : ''}
    ${a.aipKn ? row('AIP BIS', `${a.aipKn} KN`) : ''}
    ${head('SCHMALBAND (LOFAR) 0–500 HZ')}
    ${lofarChart(a)}
    ${row('LINIEN', lines(a.tonals.map((t) => t.hz)))}
    ${a.snorkel.length ? row('SCHNORCHEL (DIESEL)', `<span style="color:var(--amber)">${lines(a.snorkel.map((t) => t.hz))}</span>`) : ''}
    ${head('SO KLINGT ES')}<div style="line-height:1.45">${a.desc ? esc(a.desc) : NO_DATA}</div>
    <div class="dim" style="margin-top:6px;line-height:1.45">Welle und Blatt bei typischer Fahrt; Blatt ÷ Welle = Flügelzahl. Die Balkenhöhe zeigt, wie stark eine Linie ist; gelb nur beim Schnorcheln.</div>`;
}

const KIND_TITLE: Record<ThreatLine['kind'], string> = { waffe: 'WAFFEN', abwehr: 'ABWEHR', sensor: 'SENSOREN' };

export function bedrohungTab(cls: ClassId): string {
  const lines = threatSheet(cls);
  const hint = `${head('TAKTIK')}<div style="line-height:1.45;color:var(--amber)">${esc(THREAT_HINT[cls])}</div>`;
  if (!lines.length) return `${head('BEWAFFNUNG')}<div>Unbewaffnet</div>${hint}`;
  const maxR = Math.max(...lines.map((l) => l.rangeM ?? 0));
  let html = '';
  for (const kind of ['waffe', 'abwehr', 'sensor'] as const) {
    const ls = lines.filter((l) => l.kind === kind);
    if (!ls.length) continue;
    html += head(KIND_TITLE[kind]);
    html += ls.map((l) => `<div style="border-bottom:1px solid var(--line);padding:3px 0">
      <div class="row"><span><span>${esc(l.name)}</span>${l.count ? ` ×${l.count}` : ''}</span>${l.rangeM ? `<span style="color:var(--amber)">${kmText(l.rangeM)}</span>` : ''}</div>
      ${l.rangeM ? `<div style="height:3px;background:var(--track);margin:2px 0"><div style="height:100%;width:${((l.rangeM / maxR) * 100).toFixed(1)}%;background:var(--amber-line)"></div></div>` : ''}
      <div class="dim" style="font-size:0.8333rem;line-height:1.4">${l.details.map((d) => `<span>${esc(d)}</span>`).join(' · ')}</div></div>`).join('');
  }
  return `${html}${hint}
    <div class="dim" style="margin-top:6px;line-height:1.45">Reichweite: wie weit die Waffe oder der Sensor in der Simulation reicht. Die Balken vergleichen nur innerhalb dieser Klasse.</div>`;
}
