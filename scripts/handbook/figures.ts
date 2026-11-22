/**
 * Line-art figures for the player handbook: plain SVG, black and grey on white with a single
 * accent colour, so they print well in greyscale.
 */

const INK = '#1b1f22';
const GREY = '#8a9196';
const LIGHT = '#d9dee1';
const ACC = '#1f6f8b';
const RED = '#b03a2e';

const svg = (w: number, h: number, body: string) =>
  `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" font-family="Helvetica, Arial, sans-serif" font-size="12" fill="none" stroke="${INK}" stroke-width="1.2">${body}</svg>`;
const text = (x: number, y: number, t: string, o: { anchor?: string; size?: number; fill?: string; bold?: boolean } = {}) =>
  `<text x="${x}" y="${y}" text-anchor="${o.anchor ?? 'start'}" font-size="${o.size ?? 12}" fill="${o.fill ?? INK}" stroke="none"${o.bold ? ' font-weight="bold"' : ''}>${t}</text>`;

function subIcon(x: number, y: number, s = 1, fill = INK): string {
  return `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-22" y="-5" width="44" height="10" rx="5" fill="${fill}" stroke="none"/><rect x="-5" y="-11" width="10" height="7" fill="${fill}" stroke="none"/></g>`;
}
function shipIcon(x: number, y: number, s = 1, fill = INK): string {
  return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-26 0 L26 0 L20 8 L-22 8 Z" fill="${fill}" stroke="none"/><rect x="-6" y="-9" width="12" height="9" fill="${fill}" stroke="none"/><line x1="0" y1="-9" x2="0" y2="-18" stroke="${fill}"/></g>`;
}

/** Depth profile: surface duct, layer, a boat above and one below, rays bending away. */
export function figLayer(): string {
  const layerY = 120;
  const rays = [0, 1, 2, 3].map((i) => {
    const a = 6 + i * 4;
    return `<path d="M60 ${70 + i * 6} Q 260 ${70 + i * 6 + a * 2} 430 ${layerY - 6 - i * 2} T 680 ${60 + i * 4}" stroke="${ACC}" stroke-dasharray="${i % 2 ? '4 3' : ''}"/>`;
  }).join('');
  return svg(720, 260, `
    <rect x="0" y="0" width="720" height="260" fill="#fff" stroke="none"/>
    <line x1="20" y1="30" x2="700" y2="30" stroke="${INK}" stroke-width="1.6"/>${text(24, 22, 'Wasseroberfläche')}
    <rect x="20" y="30" width="680" height="28" fill="${LIGHT}" stroke="none" opacity="0.6"/>${text(600, 49, 'Oberflächenkanal', { fill: GREY })}
    <line x1="20" y1="${layerY}" x2="700" y2="${layerY}" stroke="${GREY}" stroke-dasharray="8 5" stroke-width="2"/>
    ${text(24, layerY - 6, 'Sprungschicht (Temperatursprung)', { fill: GREY })}
    ${rays}
    ${shipIcon(60, 30, 0.9)}${subIcon(170, 90, 0.8)}${text(140, 76, 'über der Schicht: hört und wird gehört', { size: 11 })}
    ${subIcon(470, 190, 0.8, GREY)}${text(420, 222, 'unter der Schicht: 10–15 dB leiser für Sensoren oben', { size: 11 })}
    <path d="M470 175 L470 ${layerY + 6}" stroke="${RED}" stroke-dasharray="3 3"/>${text(478, 160, 'Schall wird an der Schicht abgelenkt', { size: 11, fill: RED })}
    <line x1="20" y1="245" x2="700" y2="245" stroke="${INK}" stroke-width="2"/>${text(24, 240, 'Meeresboden', { fill: GREY })}`);
}

/** Convergence zones in deep water: rays dive, turn and come back up ~30 nm away. */
export function figCz(): string {
  const ray = (d: number) => `<path d="M40 40 C 140 ${200 + d} 240 ${200 + d} 330 42 C 420 ${200 + d} 520 ${200 + d} 620 44" stroke="${ACC}" opacity="${0.5 + d / 100}"/>`;
  return svg(680, 230, `
    <line x1="20" y1="40" x2="660" y2="40" stroke-width="1.6"/>
    ${[0, 12, 24].map(ray).join('')}
    ${shipIcon(40, 40, 0.7)}
    <ellipse cx="330" cy="44" rx="26" ry="10" fill="${LIGHT}" stroke="${GREY}"/>${text(330, 72, '1. Konvergenzzone', { anchor: 'middle', size: 11 })}
    <ellipse cx="620" cy="46" rx="26" ry="10" fill="${LIGHT}" stroke="${GREY}"/>${text(620, 74, '2. Zone', { anchor: 'middle', size: 11 })}
    ${text(185, 130, 'Schattenzone: hier hört man nichts', { anchor: 'middle', size: 11, fill: GREY })}
    ${text(330, 222, 'Nur in tiefem Wasser (über 2000 m): Kontakte in ca. 55 km Abstand, dazwischen Stille', { anchor: 'middle', size: 11 })}`);
}

/** Top view: baffles astern, towed array mirror bearing; side view: blind cone below the hull. */
export function figBaffles(): string {
  const cx = 170;
  const cy = 130;
  return svg(720, 270, `
    ${text(cx, 18, 'Draufsicht: toter Winkel achtern', { anchor: 'middle', bold: true })}
    <circle cx="${cx}" cy="${cy}" r="100" stroke="${LIGHT}"/>
    <path d="M${cx} ${cy} L${cx - 58} ${cy + 82} A100 100 0 0 0 ${cx + 58} ${cy + 82} Z" fill="${LIGHT}" stroke="${GREY}"/>
    ${text(cx, cy + 78, 'TOTER WINKEL', { anchor: 'middle', size: 10, fill: GREY })}${text(cx, cy + 92, '± 30° achtern', { anchor: 'middle', size: 10, fill: GREY })}
    <path d="M${cx} ${cy - 22} L${cx + 7} ${cy + 14} L${cx - 7} ${cy + 14} Z" fill="${INK}" stroke="none"/>
    <line x1="${cx}" y1="${cy - 30}" x2="${cx}" y2="${cy - 95}" stroke="${ACC}" marker-end="url(#a)"/>${text(cx + 6, cy - 80, 'Kurs', { size: 10, fill: ACC })}
    <defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="${ACC}" stroke="none"/></marker></defs>
    ${text(540, 18, 'Seitenansicht: blinder Fleck unter dem Rumpf', { anchor: 'middle', bold: true })}
    <line x1="380" y1="60" x2="700" y2="60" stroke-width="1.6"/>
    ${shipIcon(540, 60, 1.1)}
    <path d="M540 68 L430 250 L650 250 Z" fill="none" stroke="${GREY}" stroke-dasharray="5 4"/>
    <path d="M540 68 L460 250 L620 250 Z" fill="${LIGHT}" stroke="none" opacity="0.8"/>
    ${text(540, 200, 'steiler als 30°', { anchor: 'middle', size: 11 })}${text(540, 214, 'unter dem Schiff:', { anchor: 'middle', size: 11 })}${text(540, 228, 'kein Rumpfsonar', { anchor: 'middle', size: 11 })}
    ${subIcon(540, 160, 0.7, RED)}
    ${text(386, 120, 'VDS / Hubschrauber /', { size: 10, fill: ACC })}${text(386, 133, 'Bojen schließen die Lücke', { size: 10, fill: ACC })}`);
}

/** TMA: own ship's two legs, bearings to a moving target; only a turn reveals the range. */
export function figTma(): string {
  const own = [[60, 220], [160, 200], [260, 180], [330, 130], [400, 80]];
  const tgt = [[260, 40], [330, 50], [400, 60], [470, 70], [540, 80]];
  const lines = own.map(([x, y], i) => `<line x1="${x}" y1="${y}" x2="${tgt[i]![0]}" y2="${tgt[i]![1]}" stroke="${GREY}" stroke-dasharray="4 3"/>`).join('');
  return svg(640, 250, `
    <polyline points="${own.map((p) => p.join(',')).join(' ')}" stroke="${INK}" stroke-width="2"/>
    ${own.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.5" fill="${INK}" stroke="none"/>`).join('')}
    <polyline points="${tgt.map((p) => p.join(',')).join(' ')}" stroke="${RED}" stroke-width="2"/>
    ${tgt.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.5" fill="${RED}" stroke="none"/>`).join('')}
    ${lines}
    ${text(70, 240, '1. Schenkel', { size: 11 })}${text(310, 170, 'Kurswechsel', { size: 11 })}${text(410, 100, '2. Schenkel', { size: 11 })}
    ${text(560, 84, 'Ziel (unbekannt)', { size: 11, fill: RED })}
    ${text(320, 22, 'Peilungen allein sagen nichts über die Entfernung. Erst ein Kurswechsel', { anchor: 'middle', size: 11 })}
    ${text(320, 36, 'macht nur noch eine Lösung (Kurs, Fahrt, Entfernung) passend.', { anchor: 'middle', size: 11 })}`);
}

/** Towed array: true contact and its mirror image on the other side. */
export function figTowed(): string {
  return svg(560, 200, `
    <path d="M280 40 L288 70 L272 70 Z" fill="${INK}" stroke="none"/>
    <path d="M280 72 C 282 110 278 140 280 180" stroke="${ACC}" stroke-width="2.4"/>${text(290, 170, 'Schleppsonar', { size: 11, fill: ACC })}
    <line x1="280" y1="130" x2="470" y2="70" stroke="${INK}"/>${subIcon(480, 66, 0.6)}${text(450, 100, 'echter Kontakt', { size: 11 })}
    <line x1="280" y1="130" x2="90" y2="70" stroke="${GREY}" stroke-dasharray="5 4"/>${subIcon(80, 66, 0.6, LIGHT)}${text(40, 100, 'Spiegelbild (Geist)', { size: 11, fill: GREY })}
    ${text(280, 22, 'Eine Linie hört nur den Winkel zu ihrer Achse: links oder rechts? 20° wenden klärt es.', { anchor: 'middle', size: 11 })}`);
}

/** NATO-style symbols used on the plot. */
export function figNato(): string {
  const cell = (x: number, label: string, shape: string) => `<g transform="translate(${x} 0)">${shape}${text(0, 92, label, { anchor: 'middle', size: 11 })}</g>`;
  const friendS = `<circle cx="0" cy="40" r="16"/>`;
  const friendU = `<path d="M-16 34 A16 16 0 0 0 16 34"/>`;
  const hostS = `<path d="M0 20 L20 40 L0 60 L-20 40 Z" stroke="${RED}"/>`;
  const hostU = `<path d="M-20 34 L0 54 L20 34" stroke="${RED}"/>`;
  const neutS = `<rect x="-16" y="24" width="32" height="32"/>`;
  const unkS = [[0, -9], [9, 0], [0, 9], [-9, 0]].map(([dx, dy]) => `<circle cx="${dx}" cy="${40 + dy!}" r="9" stroke="${GREY}"/>`).join('');
  return svg(700, 110, [
    cell(60, 'eigen · Überwasser', friendS), cell(170, 'eigen · U-Boot', friendU), cell(290, 'feindlich · Überwasser', hostS),
    cell(410, 'feindlich · U-Boot', hostU), cell(520, 'neutral', neutS), cell(630, 'unbekannt', unkS),
  ].join(''));
}

/** Sonar equation as a level ladder. */
export function figSonarEq(): string {
  const bar = (x: number, h: number, label: string, sub: string, col: string) =>
    `<rect x="${x}" y="${200 - h}" width="70" height="${h}" fill="${col}" stroke="none"/>${text(x + 35, 218, label, { anchor: 'middle', bold: true })}${text(x + 35, 232, sub, { anchor: 'middle', size: 10, fill: GREY })}`;
  return svg(640, 245, `
    ${bar(30, 170, 'SL', 'Quellpegel', INK)}
    ${bar(130, 95, '− TL', 'Ausbreitung', GREY)}
    ${bar(230, 60, '− (NL − DI)', 'Störung − Bündelung', LIGHT)}
    ${bar(330, 18, '− DT', 'Erkennungsschwelle', LIGHT)}
    <rect x="430" y="${200 - 22}" width="70" height="22" fill="${ACC}" stroke="none"/>${text(465, 218, '= SE', { anchor: 'middle', bold: true, fill: ACC })}
    <line x1="20" y1="200" x2="620" y2="200" stroke="${GREY}"/>
    ${text(515, 160, 'Signalüberschuss', { bold: true, fill: ACC })}${text(515, 176, 'über 0 dB: Kontakt', { size: 11, fill: ACC })}
    ${text(30, 22, 'Wer gehört wird, entscheidet die Summe: laut (Fahrt, Kavitation, Schnorcheln) gegen Entfernung, Schicht und Lärm.', { size: 11 })}`);
}

/** Convoy with escort screen and the danger sector ahead. */
export function figConvoy(): string {
  const merchants = [[-60, 0], [0, 0], [60, 0], [-60, 50], [0, 50], [60, 50]];
  return svg(640, 260, `
    <g transform="translate(320 140)">
      ${merchants.map(([x, y]) => `<rect x="${x! - 12}" y="${y! - 5}" width="24" height="10" fill="${GREY}" stroke="none"/>`).join('')}
      <path d="M-150 -40 A 170 170 0 0 1 150 -40" stroke="${ACC}" stroke-dasharray="6 4"/>
      ${shipIcon(-110, -80, 0.55)}${shipIcon(0, -120, 0.55)}${shipIcon(110, -80, 0.55)}
      <line x1="0" y1="-20" x2="0" y2="-130" stroke="${INK}" marker-end="url(#c)"/>
      <defs><marker id="c" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="${INK}" stroke="none"/></marker></defs>
      ${subIcon(-230, -60, 0.6, RED)}${subIcon(210, 10, 0.6, RED)}
    </g>
    ${text(320, 250, 'Sicherung vorn und an den Flanken; U-Boote greifen meist von vorn-seitlich an, wo der Konvoi auf sie zuläuft.', { anchor: 'middle', size: 11 })}
    ${text(330, 18, 'Konvoikurs', { size: 11 })}`);
}
