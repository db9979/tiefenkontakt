/**
 * Print page for the recognition book (scripts/handbook/recog-pdf.ts prints it to A4 PDF):
 * an overview of every silhouette at one scale, then one page per class with the same three
 * parts the in-game book has (Sicht, Akustik, Bedrohung) plus its ESM radar. Light theme,
 * so it prints without a black background. Not part of the build.
 */
import '../src/style.css';
import '../src/theme-light.css';
import { CLASSES, RECOG, RECOG_ORDER, emitterText, shipEmitter, type ClassId } from '@tk/shared';
import { CLASS_LABEL, esc } from '../src/widgets/format.js';
import type { Pics } from '../src/widgets/recog-draw.js';
import { sideSvg } from '../src/widgets/recog-draw.js';
import { akustikTab, bedrohungTab, defaultGhost, sichtTab } from '../src/widgets/recog-pages.js';
import { recogImage, recogMeta, renderRecog } from '../src/widgets/recog-render.js';
import { scaleCat } from '../src/widgets/recog-scale.js';

const pics: Pics = { image: recogImage, meta: recogMeta };
const order = RECOG_ORDER as readonly ClassId[];
const GROUP = { warship: 'Kriegsschiffe', convoy: 'Geleitzug', submarine: 'U-Boote (aufgetaucht)', neutral: 'Neutrale Schifffahrt' } as const;
const SIDE = (c: ClassId) => (RECOG[c].group === 'neutral' ? 'Neutral' : RECOG[c].group === 'convoy' ? 'Geleitzug (Westbund)' : CLASSES[c].team === 'west' ? 'Westbund' : 'Ostpakt');

const style = document.createElement('style');
style.textContent = `
@page { size: A4; margin: 12mm 12mm 14mm; }
html, body { background: #fff !important; }
body { font-size: 10.5px; color: #10231d; width: 186mm; margin: 0 auto; }
select, label:has(select) { display: none !important; }
.clickable { cursor: default !important; }
.sheet { break-after: page; break-inside: avoid; overflow: hidden; }
.sheet:last-child { break-after: auto; }
.cover h1 { font-size: 26px; letter-spacing: 0.08em; margin: 0 0 4px; }
.cover .sub { font-size: 12px; margin-bottom: 14px; }
.hdr { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #1b7458; padding-bottom: 3px; margin-bottom: 6px; }
.hdr h2 { margin: 0; font-size: 17px; letter-spacing: 0.04em; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.part { break-inside: avoid; }
.part > .ttl { font-weight: 700; letter-spacing: 0.06em; margin: 8px 0 2px; color: #1b7458; }
.ovgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 14px; }
.ov { display: grid; grid-template-columns: 22mm 1fr; gap: 2px 6px; align-items: center; break-inside: avoid; }
.ov .nm { font-size: 10px; }
.sicht { width: 120mm; }
.top { display: grid; grid-template-columns: 120mm 1fr; gap: 10px; }
.foot { margin-top: 10px; font-size: 9px; color: #5f7a72; }
`;
document.head.appendChild(style);

renderRecog([...order]);

const cover = () => {
  const block = (cat: 'ship' | 'sub', title: string) => `<div class="part"><div class="ttl">${title} · GEMEINSAMER MASSSTAB</div>
    <div class="ovgrid">${order.filter((c) => scaleCat(c) === cat).map((c) => `<div class="ov"><div class="nm"><b>${esc(CLASS_LABEL[c])}</b><br><span class="dim">${esc(SIDE(c))}</span></div><div>${sideSvg(pics, c)}</div></div>`).join('')}</div></div>`;
  return `<section class="sheet cover">
    <h1>TIEFENKONTAKT · ERKENNUNGSHEFT</h1>
    <div class="sub dim">Alle Klassen auf einen Blick: Silhouetten im Maßstab, Akustik, Bedrohung und Radar. Alle Werte stammen aus den Tabellen des Spiels.</div>
    ${block('ship', 'ÜBERWASSERSCHIFFE')}${block('sub', 'U-BOOTE')}
    <div class="foot">Schiffe und U-Boote haben je einen eigenen Maßstab. Gitter in Metern, die gestrichelte Linie ist die Masthöhe für das Stadimeter.</div>
  </section>`;
};

const page = (c: ClassId) => {
  const em = shipEmitter(c);
  const radar = `<div class="part"><div class="ttl">RADAR IM ESM</div><div>${em ? esc(emitterText(em)) : '<span class="dim">kein Radar</span>'}</div></div>`;
  return `<section class="sheet">
    <div class="hdr"><h2>${esc(CLASS_LABEL[c])}</h2><span class="dim">${esc(CLASSES[c].name)} · ${esc(SIDE(c))} · ${esc(GROUP[RECOG[c].group])}</span></div>
    <div class="top">
      <div class="part sicht"><div class="ttl">SICHT</div>${sichtTab(pics, c, defaultGhost(c), order, '')}</div>
      <div><div class="part"><div class="ttl">BEDROHUNG</div>${bedrohungTab(c)}</div>${radar}</div>
    </div>
    <div class="part"><div class="ttl">AKUSTIK</div>${akustikTab(c)}</div>
  </section>`;
};

document.body.innerHTML = cover() + order.map(page).join('');
// One A4 page per sheet: a sheet taller than the printable area (297 mm − 26 mm margins) is
// zoomed down to fit instead of spilling onto a second page
const PAGE_PX = ((297 - 26) * 96) / 25.4 - 6;
for (const sec of document.querySelectorAll<HTMLElement>('.sheet')) {
  const hgt = sec.getBoundingClientRect().height;
  if (hgt > PAGE_PX) sec.style.zoom = (PAGE_PX / hgt).toFixed(3);
}
// The PDF script waits for this marker
document.title = 'ERKENNUNGSHEFT FERTIG';
(window as unknown as { __recogReady?: boolean }).__recogReady = true;
