import { SIGNATURES, type SigKey } from '@tk/shared';

/**
 * Handbook: the sonar signature reference, straight from the simulation's catalogue: per class
 * the screw (blades, revolutions per knot, hence the DEMON shaft and blade rates at a typical
 * speed), the LOFAR lines, the snorkel lines, the best analysis bands and how it sounds.
 */

const GROUPS: [string, SigKey[]][] = [
  ['Kriegsschiffe (Westbund)', ['ffg', 'ffv', 'kor']],
  ['U-Boote (Ostpakt)', ['ssn', 'ssk', 'ssc', 'ssa']],
  ['Handel und Neutrale', ['merchant', 'tanker', 'container', 'faehre', 'fischer', 'schlepper', 'yacht']],
  ['Waffen', ['torpedo']],
];

/** A typical speed for reading the DEMON rates (kn). */
const TYPICAL: Partial<Record<SigKey, number>> = { ssn: 6, ssk: 4, ssc: 4, ssa: 4, torpedo: 40, yacht: 6, fischer: 8, schlepper: 10, merchant: 12 };

const EAR: Partial<Record<SigKey, string>> = {
  ffg: 'Gleichmäßiges Rauschen, Turbinenpfeifen; 5 Flügel, mittlere Drehzahl.',
  ffv: 'Dampfturbine: weiches Rauschen, 3 große Flügel, Linien 190/285 Hz.',
  kor: 'Diesel-Schlag im 75-Hz-Raster, 4 Flügel, wendig und leise.',
  ssn: 'Kaum Schraube, dafür Pumpen- und Turbinenton bei 25/60/120 Hz; viele Flügel.',
  ssk: 'Auf Batterie fast nur eine schwache 50-Hz-Linie; schnorchelnd laute Diesel bei 24/48/72 Hz.',
  ssc: 'Klein und schnell drehend, 60-Hz-Linie; schnorchelnd 30/60/90 Hz.',
  ssa: 'Leise, aber der 400-Hz-Ton der Stromrichter verrät es; 7 Flügel.',
  merchant: 'Dumpfes Stampfen, laute Linien 50/100/150 Hz, 4–5 Flügel.',
  tanker: 'Sehr langsames Stampfen, Diesel-Zündfolge um 9 Hz; Blattrate nur wenige Hertz.',
  container: 'Schnell bei niedriger Drehzahl, 6 Flügel, Linien 12/60/120 Hz.',
  faehre: 'Zwei Wellen, viele Linien zwischen 30 und 70 Hz.',
  fischer: 'Hohe Drehzahl bei kleiner Fahrt, kräftige 30-Hz-Linie.',
  schlepper: 'Düsenpropeller, 40-Hz-Linie, hohe Drehzahl je Knoten.',
  yacht: 'Sehr leise, 25-Hz-Linie, sehr hohe Drehzahl des Hilfsdiesels.',
  torpedo: 'Hohes, sirrendes Heulen, schnell lauter werdend; 9–11 Flügel, sehr hohe Drehzahl.',
};

function band(sig: (typeof SIGNATURES)[SigKey]): string {
  const top = Math.max(0, ...sig.tonals.map((t) => t.hz), ...(sig.snorkelTonals ?? []).map((t) => t.hz));
  const low = Math.min(999, ...sig.tonals.map((t) => t.hz));
  if (top > 300) return 'HOCH (200–500)';
  if (top <= 55 && low >= 8) return 'WELLE (8–55)';
  if (top <= 80) return 'TIEF (4–80)';
  if (low >= 20 && top <= 120) return 'MITTEL (20–120)';
  return 'VOLL (0–300)';
}

/** Table of every signature in the game, grouped, with the DEMON rates at a typical speed. */
export function signatureTable(): string {
  const rows = GROUPS.map(([title, keys]) => `<tr><th colspan="6" style="background:#dfe6e9">${title}</th></tr>` + keys.map((k) => {
    const s = SIGNATURES[k];
    const kn = TYPICAL[k] ?? 15;
    const shaft = (s.rpmPerKn * kn) / 60;
    const blades = s.blades.join('/');
    const demon = shaft > 0 ? `Welle ${shaft.toFixed(1).replace('.', ',')} Hz · Blatt ${(shaft * s.blades[0]!).toFixed(1).replace('.', ',')} Hz bei ${kn} kn` : '—';
    const lines = s.tonals.map((t) => `${String(t.hz).replace('.', ',')}`).join(' / ') || '—';
    const snort = s.snorkelTonals ? `<br><span class="small">Schnorchel: ${s.snorkelTonals.map((t) => t.hz).join(' / ')} Hz</span>` : '';
    return `<tr><td><b>${s.name}</b></td><td>${blades}</td><td>${String(s.rpmPerKn).replace('.', ',')}</td><td>${demon}</td><td>${lines}${snort}</td><td>${band(s)}<br><span class="small">${EAR[k] ?? ''}</span></td></tr>`;
  }).join('')).join('');
  return `<h2>Signaturtabelle</h2>
<p>Jede Klasse klingt anders: eigene Maschinenlinien (LOFAR), eigene Flügelzahl und Drehzahl der Schraube (DEMON). Die Werte
kommen direkt aus der Simulation. Gemessene Linien streuen um etwa ±0,3 Hz, Welle und Blatt um wenige Hundertstel Hertz.</p>
<table class="grid" style="font-size:8.5pt"><tr><th>Klasse</th><th>Flügel</th><th>U/min je kn</th><th>DEMON (Beispiel)</th><th>LOFAR-Linien (Hz)</th><th>Analyseband · so klingt es</th></tr>${rows}</table>
<div class="box"><h4>Erhorchen und messen</h4><ol>
<li><b>Hören:</b> Im Horchraum „Mithören“ wählen. <i>Breitband</i> gibt das Meer und den Kontakt wieder: der Schraubentakt (Blattrate),
Knistern bei Kavitation, dumpf in der Ferne, hell und rau nahe, aus der Richtung der Peilung. Ein schwacher Kontakt geht im
Rauschen von Seegang, Regen und eigener Fahrt unter – zum Horchen langsam fahren.</li>
<li><b>Linien finden:</b> <i>Gefiltert</i> hört nur das gewählte LOFAR-Band. Tiefe Linien (unter 100 Hz) sind auf kleinen
Lautsprechern kaum zu hören: <i>Überlagerung</i> schiebt sie um 700 Hz nach oben, die Abstände bleiben gleich.</li>
<li><b>Messen:</b> Im LOFAR den Grundton markieren, im DEMON die tiefe Linie als Welle und die stärkere als Blatt.
Blatt ÷ Welle = Flügelzahl, Welle × 60 ÷ Fahrt = U/min je kn. Beides mit der Tabelle vergleichen, die Bibliothek tut es mit.</li>
<li><b>Doppler:</b> Nähert sich ein Kontakt, liegen seine Linien leicht höher (1 kn ≈ 0,03 %), entfernt er sich, tiefer –
am deutlichsten bei hohen Linien wie dem 400-Hz-Ton.</li>
</ol></div>`;
}
