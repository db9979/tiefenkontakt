import { h } from '../widgets/format.js';

/** Controls and a short how-to; mouse first, keyboard as shortcut. */
export function helpOverlay(submarine: boolean): void {
  if (document.querySelector('.overlay.help')) return;
  const howto = submarine
    ? `<tr><td>1 · Horchen</td><td>Langsam und tief fahren. Im Horchraum Kontakte im Wasserfall anklicken. Mit „Mithören“ hörst du die Schrauben.</td></tr>
       <tr><td>2 · Peilen</td><td>Im Feuerleitstand den Kontakt wählen und einen Kurswechsel fahren (ein „Schenkel“). Ohne Kurswechsel keine Entfernung.</td></tr>
       <tr><td>3 · Lösen</td><td>„Auto-TMA“ oder den gelben Lösungskreis auf der Karte ziehen. Die Vektorspitze ziehen ändert Kurs und Fahrt. Ziel: Güte über 60 %.</td></tr>
       <tr><td>4 · Schießen</td><td>„Lösung übernehmen“ und „Feuer“, oder Rechtsklick auf die Karte und „Torpedo hierher“. Den Torpedo über den Draht mit ◀ ▶ nachsteuern.</td></tr>
       <tr><td>Überleben</td><td>Funk geht nur mit Mast und wird angepeilt. Bei einem Torpedo: Täuschkörper, volle Fahrt und durch die Sprungschicht.</td></tr>`
    : `<tr><td>1 · Suchen</td><td>Schleppsonar ausbringen (lang = unter der Sprungschicht). Nach jeder Kursänderung 60 s stabilisieren.</td></tr>
       <tr><td>2 · Orten</td><td>Aktivsonar liefert Entfernung, verrät dich aber. Funkpeilungen (rot, gestrichelt) zeigen funkende U-Boote.</td></tr>
       <tr><td>3 · Angreifen</td><td>Kontakt wählen, dann im Waffenleitstand „Rakete auf Ziel“ oder Rechtsklick auf die Karte und „U-Jagd-Rakete hierher“.</td></tr>
       <tr><td>Schützen</td><td>Bleib zwischen U-Boot und Konvoi. Bei einem Torpedo: Täuschkörper-Schleppe und abdrehen.</td></tr>`;
  const ov = h(`<div class="overlay help"><div class="panel" style="padding:18px 22px">
    <div class="hd"><span>Bedienung</span><button id="close">Schließen</button></div>
    <h3>MAUS</h3>
    <table>
      <tr><td>Karte</td><td>Ziehen verschiebt, Rad oder + − zoomt, ◎ zentriert. Linksklick wählt einen Kontakt. Rechtsklick öffnet Aktionen: Kurs, Waffen, TMA.</td></tr>
      <tr><td>Kompass</td><td>Klicken oder ziehen setzt den Kurs. Gelb = befohlen, blau = aktuell.</td></tr>
      <tr><td>Fahrt / Tiefe</td><td>Fahrstufen-Knöpfe oder Schieberegler.</td></tr>
      <tr><td>Wasserfall / Radar</td><td>Klick auf eine Spur oder ein Echo wählt den Kontakt.</td></tr>
      <tr><td>Sehrohr</td><td>Waagrecht ziehen dreht das Sehrohr, Klick auf ein Schiff wählt es.</td></tr>
    </table>
    <h3>KLASSIFIZIEREN (SONAR)</h3>
    <table>
      <tr><td>1 · LOFAR</td><td>Kontakt wählen. Auf eine senkrechte Linie klicken (Cursor) und „Grundton markieren“. Die gestrichelten Linien 2f, 3f zeigen, ob die anderen Linien eine Familie bilden.</td></tr>
      <tr><td>2 · DEMON</td><td>Die tiefe Linie als „Welle“, die stärkere höhere als „Blatt“ markieren. Daraus folgen Blattzahl und Drehzahl.</td></tr>
      <tr><td>3 · Bibliothek</td><td>Sie bewertet deine Marken gegen den Katalog. Die Entscheidung triffst du mit den Klassen-Knöpfen.</td></tr>
      <tr><td>Filter</td><td>Band wählen, Notch blendet die eigene Schraube aus, lange Integration hebt schwache Töne, „Spitze“ hält Maxima.</td></tr>
      <tr><td>Torpedo</td><td>Laut, keine Töne, sehr hohe Drehzahl, schnell wandernde Peilung.</td></tr>
      <tr><td>Stufe</td><td>„Einsteiger“ (oben rechts) beschriftet Linien und bietet Auto-Marken und Auto-TMA. „Profi“ nicht.</td></tr>
    </table>
    <h3>TASTATUR</h3>
    <table>
      <tr><td>1 – 4</td><td>Station wechseln</td></tr>
      <tr><td>← → (⇧ fein)</td><td>Kurs ±5° (±1°)</td></tr>
      <tr><td>↑ ↓</td><td>Fahrt ±1 kn</td></tr>
      <tr><td>Bild ↑ ↓</td><td>Tiefe ±10 m</td></tr>
      <tr><td>A / D</td><td>Sehrohr drehen</td></tr>
      <tr><td>M · H</td><td>Ton an/aus · diese Hilfe</td></tr>
    </table>
    <h3>${submarine ? 'ABLAUF U-BOOT' : 'ABLAUF FREGATTE'}</h3>
    <table>${howto}</table>
    <div class="dim" style="margin-top:10px">Die Simulation läuft mit 3-facher Zeitraffung. Alle Uhren zeigen Simulationszeit.</div>
  </div></div>`);
  const close = () => {
    ov.remove();
    window.removeEventListener('keydown', esc);
  };
  const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
  ov.querySelector<HTMLButtonElement>('#close')!.onclick = close;
  ov.addEventListener('mousedown', (e) => e.target === ov && close());
  window.addEventListener('keydown', esc);
  document.body.appendChild(ov);
}
