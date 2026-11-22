/**
 * Builds the player handbook: HTML from the chapters and the game's own class tables, then a
 * printer-friendly A4 PDF via headless Chrome into apps/client/public/handbuch.pdf.
 *
 * Usage: npx tsx scripts/handbook/build.ts   (model pictures: docs/handbuch/img, made with apps/client/dev/shots.html)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chapterIntro, chapterSea, chapterStart, chapterSymbols } from './chapters-a.js';
import { chapterClassify, chapterEscort, chapterSub } from './chapters-b.js';
import { chapterMissions, chapterReference, chapterTactics, chapterWorld } from './chapters-c.js';
import { bioTable, unitCards, unitTable } from './units.js';
import { figBio } from './figures.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(root, 'docs', 'handbuch');
const html = join(outDir, 'handbuch.html');
const pdf = join(root, 'apps', 'client', 'public', 'handbuch.pdf');

const TOC: [string, string][] = [
  ['k1', 'Das Spiel'], ['k2', 'Erste Schritte'], ['k3', 'Das Meer und der Schall'], ['k4', 'Lagebild und Symbole'],
  ['k5', 'Als U-Boot-Kommandant'], ['k6', 'Als Kommandant der Eskorte'], ['k7', 'Klassifizieren'], ['k8', 'Einheitenreferenz'],
  ['k9', 'Missionen'], ['k10', 'Umwelt und Zwischenfälle'], ['k11', 'Taktik'], ['k12', 'Tastatur und Glossar'],
];

const CSS = `
@page { size: A4; margin: 16mm 15mm 18mm 15mm;
  @bottom-center { content: counter(page); font: 9pt Helvetica, Arial, sans-serif; color: #666; } }
@page :first { @bottom-center { content: none; } }
* { box-sizing: border-box; }
body { font: 10pt/1.45 Helvetica, Arial, sans-serif; color: #1b1f22; margin: 0; }
h1 { font-size: 20pt; margin: 0 0 4mm; padding-bottom: 2mm; border-bottom: 1.5pt solid #1b1f22; break-before: page; letter-spacing: 0.02em; }
h2 { font-size: 12.5pt; margin: 6mm 0 2mm; color: #1f6f8b; break-after: avoid; }
h3 { font-size: 12pt; margin: 0 0 2mm; break-after: avoid; }
h4 { margin: 0 0 1.5mm; font-size: 10.5pt; }
p { margin: 0 0 2.5mm; } .lead { font-size: 11pt; }
ul, ol { margin: 0 0 3mm; padding-left: 5mm; } li { margin-bottom: 1mm; }
figure { margin: 3mm 0 5mm; break-inside: avoid; text-align: center; }
figure svg { width: 100%; max-height: 80mm; }
figcaption { font-size: 8.5pt; color: #555; margin-top: 1mm; }
/* Screenshots: the dark console inverted to a light picture so it prints with little ink */
.ui img { width: 100%; filter: invert(1) hue-rotate(180deg) saturate(0.6) contrast(0.95); border: 0.5pt solid #999; }
.shots { gap: 4mm; margin-bottom: 0; } .shots figure { margin: 0 0 3mm; }
table { border-collapse: collapse; width: 100%; margin: 0 0 4mm; break-inside: auto; }
tr { break-inside: avoid; }
.grid th, .grid td { border: 0.5pt solid #b9c0c4; padding: 1.3mm 2mm; text-align: left; vertical-align: top; }
.grid th { background: #eef1f2; font-weight: bold; }
.cols2 { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; margin-bottom: 4mm; }
.box { border: 0.75pt solid #b9c0c4; border-left: 2.5pt solid #1f6f8b; padding: 3mm 4mm; break-inside: avoid; }
.small { font-size: 8.5pt; color: #555; }
kbd { font: 9pt Menlo, Consolas, monospace; border: 0.5pt solid #888; border-radius: 1mm; padding: 0 1.5mm; }
.keys td:first-child { width: 35mm; } .gloss td:first-child { width: 30mm; } .gloss td { padding: 0.9mm 2mm; font-size: 9pt; }
.unit { break-inside: avoid; border-top: 1pt solid #1b1f22; padding-top: 2.5mm; margin-bottom: 5mm; font-size: 9pt; line-height: 1.35; }
.unit p, .unit li { margin-bottom: 1mm; }
.unit h3 .role { font-weight: normal; color: #555; font-size: 10pt; margin-left: 3mm; }
.unit img { width: 100%; height: 30mm; object-fit: contain; display: block; margin: 1mm 0 2mm; }
.unit-body { display: grid; grid-template-columns: 1.15fr 1fr; gap: 5mm; }
.data th { text-align: left; font-weight: normal; color: #555; width: 27mm; padding: 0.6mm 2mm 0.6mm 0; vertical-align: top; }
.data td { padding: 0.6mm 0; border-bottom: 0.5pt solid #e2e6e8; }
.cover { height: 255mm; display: flex; flex-direction: column; justify-content: space-between; }
.cover .t { font-size: 40pt; letter-spacing: 0.08em; font-weight: bold; margin-top: 30mm; }
.cover .s { font-size: 15pt; color: #1f6f8b; margin-top: 2mm; }
.cover img { width: 100%; margin: 10mm 0; }
.cover .f { font-size: 9pt; color: #555; }
.toc { break-before: page; } .toc h1 { break-before: avoid; }
.toc a { color: inherit; text-decoration: none; display: flex; border-bottom: 0.5pt dotted #999; padding: 1.8mm 0; font-size: 11pt; }
.toc a span { margin-right: 4mm; width: 8mm; color: #1f6f8b; font-weight: bold; }
`;

function page(): string {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Tiefenkontakt · Spielerhandbuch</title><style>${CSS}</style></head><body>
<section class="cover">
  <div><div class="t">TIEFENKONTAKT</div><div class="s">Spielerhandbuch · U-Boot-Jagd im Kalten Krieg</div></div>
  <div><img src="img/ssk.png" alt=""><img src="img/ffg.png" alt=""></div>
  <div class="f">Alle Staaten, Schiffsklassen und Namen sind erfunden. Werte entsprechen dem Spielstand vom ${new Date().toLocaleDateString('de-DE')}.<br>
  Druckfreundlich: weißer Hintergrund, Graustufen-tauglich, A4.</div>
</section>
<nav class="toc"><h1>Inhalt</h1>${TOC.map(([id, t], i) => `<a href="#${id}"><span>${i + 1}</span>${t}</a>`).join('')}</nav>
${chapterIntro}${chapterStart}${chapterSea}${chapterSymbols}${chapterSub}${chapterEscort}${chapterClassify}
<h1 id="k8">8 · Einheitenreferenz</h1>
<p>Alle Werte stammen direkt aus der Simulation. Die Bilder zeigen die Modelle, wie sie im Sehrohr und auf der Brücke erscheinen.</p>
${unitTable()}
${unitCards()}
<h2>Biologische Kontakte</h2>
<p>Wale, Delfine und Knallkrebse erscheinen im Sonar als Kontakte ohne Schraube. Sie zu erkennen spart Torpedos und Nerven –
ein Pottwal in 400 m Tiefe sieht im Wasserfall aus wie ein tief fahrendes U-Boot.</p>
<figure>${figBio()}<figcaption>Abb. · Biologische Kontakte im Größenvergleich.</figcaption></figure>
${bioTable()}
${chapterMissions}${chapterWorld}${chapterTactics}${chapterReference}
</body></html>`;
}

writeFileSync(html, page());
console.log('HTML', html);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(chrome)) throw new Error('Google Chrome not found for PDF printing');
execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${pdf}`, `file://${html}`], { stdio: 'ignore' });
console.log('PDF', pdf);
