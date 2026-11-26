import { AREA_ACOUSTICS, CURRENTS, LANES, REGIONS, bioluminescence, lightNote, seaLayer, type RegionId } from '@tk/shared';

/**
 * Handbook: the sea areas as the navigator's sailing directions — currents and tides, the
 * layer in winter and summer, polar night and midnight sun, lanes and ferries; then how a
 * boat fixes its position without satellite navigation.
 */

const KIND = { open: 'offen', schelf: 'Schelf', fjord: 'Fjord', hafen: 'Hafen', meerenge: 'Meerenge' } as const;

function layer(id: RegionId, month: number): string {
  const l = seaLayer(id, month, 0.5);
  return l.depth > 0 ? `~${l.depth} m (${l.loss} dB)` : 'keine';
}

/** Deep-water sound of an area: first convergence zone or the Arctic half-channel, and distant shipping. */
function sound(id: RegionId): string {
  const a = AREA_ACOUSTICS[id];
  // Only the open ocean has deep-water paths; shelf, fjords, harbours and narrows are shallow-water multipath
  const path = REGIONS[id].kind !== 'open' ? 'Flachwasser' : a.halfChannel ? 'Halbkanal' : a.czKm ? `KZ ${a.czKm} km` : '—';
  return `${path}<br>Verkehr +${a.shippingDb} dB`;
}

/** Bioluminescence of the season's mean bloom in January and July (stark / mittel / schwach). */
function glow(id: RegionId): string {
  const word = (m: number) => {
    const b = bioluminescence({ lat: REGIONS[id].lat, month: m, seed: undefined });
    return b >= 0.6 ? 'stark' : b >= 0.3 ? 'mittel' : 'schwach';
  };
  return `Jan ${word(1)}<br>Jul ${word(7)}`;
}

export function areaChapter(): string {
  const rows = (Object.keys(REGIONS) as RegionId[]).map((id) => {
    const r = REGIONS[id];
    const light = [lightNote(r.lat, 1) && `Jan: ${lightNote(r.lat, 1)}`, lightNote(r.lat, 6) && `Jun: ${lightNote(r.lat, 6)}`].filter(Boolean).join('<br>');
    const lanes = (LANES[id] ?? []).map((l) => l.name).join(', ');
    return `<tr><td><b>${r.name}</b><br><span class="small">${KIND[r.kind]} · ${r.lat.toFixed(1).replace('.', ',')}° N</span></td>` +
      `<td>${CURRENTS[id]?.note ?? '—'}</td><td>${layer(id, 1)}</td><td>${layer(id, 7)}</td><td>${light || '—'}</td><td class="small">${sound(id)}</td><td class="small">${glow(id)}</td><td class="small">${lanes || '—'}</td></tr>`;
  }).join('');
  return `<h2>Seegebiete: Strom, Schicht, Licht, Verkehr</h2>
<p>Jedes Gebiet ist ein echtes Seegebiet mit seinen Strömungen, seiner Schichtung je Jahreszeit und dem Sonnenstand
seiner Breite. Die Jahreszeit wählt man in der Lobby (oder Zufall). Strom und Kenterzeit stehen in der Zentrale und in der OPZ.
„Schall“ nennt die erste Konvergenzzone über tiefem Wasser (oder den arktischen Halbkanal) und den fernen Schiffslärm (Kapitel 3),
„Meeresleuchten“ die mittlere Stärke im Januar und Juli; jede Partie hat ihre eigene Blüte (Kapitel 10).</p>
<p><b>Genordet:</b> Alle Karten, Radarschirme und Kompasse zeigen Nord oben wie eine Weltkarte. Kurse und Peilungen sind rechtweisend (000 = Nord, 090 = Ost); in der Straße von Gibraltar läuft die Route also nach Osten, in der Grönland-Lücke nach Nordwesten. Relative Angaben (Backbord/Steuerbord, Lagewinkel) bleiben auf den eigenen Bug bezogen.</p>
<table class="grid" style="font-size:8pt"><tr><th>Gebiet</th><th>Strömung</th><th>Schicht Winter</th><th>Schicht Sommer</th><th>Licht</th><th>Schall</th><th>Meeresleuchten</th><th>Verkehrswege</th></tr>${rows}</table>
<div class="box"><h4>Standort ohne GPS</h4><ol>
<li>Getaucht koppelt das Boot nur: Kurs und Fahrt durchs Wasser. Der Strom versetzt es unbemerkt, der Fehlerkreis wächst.</li>
<li><b>Landpeilung</b> (±100 m): Mast oben, Land in Sicht, bei Tageslicht.</li>
<li><b>Satellit</b> (±200 m): etwa alle 90 Minuten ein Durchgang von 15 Minuten; der Mast muss zwei Minuten oben bleiben.</li>
<li><b>Sterne</b> (±1,5 km): nachts bei klarem Himmel, drei Minuten am Sehrohr.</li>
<li><b>Echolot</b>: ein Lotimpuls, mit der Seekarte verglichen. Hilft nur am geneigten Grund und ist auf einige Kilometer zu hören.</li>
</ol></div>`;
}
