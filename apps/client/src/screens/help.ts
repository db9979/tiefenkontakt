import { h } from '../widgets/format.js';
import { FRIGATE_STATION_IDS, SUB_STATION_IDS, type FrigateStationId, type SubStationId } from '@tk/shared';
import { stationLabel } from '../stations/titles.js';
import { currentKeys, keyName, keysEditor } from '../widgets/keys.js';

/** What each station is for, in the order of play. The numbered rows come from the station list. */
const SUB_HOWTO: Record<SubStationId, string> = {
  horch: 'Langsam und tief fahren. Kontakte im Wasserfall anklicken und mit LOFAR/DEMON klassifizieren. Reiter „Bedrohung“: wer uns anpingt, mit Ausweichvorschlag; Reiter „Aktiv“: ein Einzelping gibt die Entfernung, verrät das Boot aber weit hinaus.',
  sehrohr: 'Nur auf Sehrohrtiefe und unter 10 kn: Mast ausfahren, Ziele ansehen, Klasse zuweisen, Entfernung mit dem Stadimeter. Der Radarwarner hört nur mit Mast oben. Kurz halten: Radar findet den Mast.',
  feuerleitung: 'Kontakt wählen und einen Kurswechsel fahren, dann „Auto-TMA“ oder den gelben Lösungskreis ziehen, bis die Güte über 60 % liegt. „Lösung übernehmen“ und „Feuer“ (Salve und Fächer wählbar), den Torpedo am Draht mit ◀ ▶ nachsteuern. Die Rohrbank zeigt Ladung und Nachladen, darunter die Täuschkörper.',
  zentrale: 'Der Platz des Kommandanten: Koppeltisch und Tiefenprofil (Klick = Tiefe), Kacheln für Tiefe, Trimm, Batterie und Schnorchel, die häufigsten Befehle (Sehrohrtiefe, unter die Schicht, Alarmtauchen, Ruhe im Boot, Schnorcheln), Navigation mit Echolot, Tiefenalarme und Minen.',
};
const FRIGATE_HOWTO: Record<FrigateStationId, string> = {
  opz: 'Lagekarte mit allen Kontakten, darüber der Stand aller U-Jagd-Mittel. Rechtsklick vor den Konvoi wirft eine Sonarboje. Reiter: Kontakte, Verband (Konvoi umleiten), Hubschrauber (Aufträge zum gewählten Kontakt).',
  sonar: 'Rumpf- und Schleppsonar übereinander. Schleppsonar ausbringen (lang = unter der Sprungschicht), nach jeder Kursänderung stabilisieren. Reiter „Aktiv“: Einzelping, CW/LFM; „VDS/BT“: Sprungschicht messen, Tiefensonar, Minenmeiden.',
  waffen: 'Kontakt wählen, dann „Rakete auf Ziel“ oder Rechtsklick auf die Karte und „U-Jagd-Rakete hierher“. Rohre, Werfer und Täuschkörper-Schleppe als Karten daneben.',
  radar: 'Radar findet aufgetauchte Boote und Masten. ESM-Peilungen erscheinen als rote Striche am Rand des Radarschirms und in der Liste. Daneben die Luftabwehr.',
  bruecke: 'Ausguck und Fernglas: Sehrohr-Fahnen, Schnorchel und Torpedolaufbahnen mit eigenen Augen. Nachts und bei Seegang kaum Sicht.',
};

/** Emergency keys of a side, as "T Täuschkörper · X Alarmtauchen". */
function emergencyKeys(submarine: boolean): string {
  const k = currentKeys();
  const list: [keyof typeof k, string][] = submarine
    ? [['decoy', 'Täuschkörper'], ['crashDive', 'Alarmtauchen'], ['mastDown', 'Mast ein'], ['fire', 'Feuer']]
    : [['ping', 'Einzelping'], ['rocket', 'Rakete'], ['decoy', 'Täuschkörper']];
  return list.map(([a, l]) => `<kbd class="kcap">${keyName(k[a])}</kbd> ${l}`).join(' · ');
}

/** Numbered how-to rows (number = station key), then the emergency keys and the survival rule. */
function howtoRows(submarine: boolean): string {
  const row = (label: string, text: string) => `<tr><td>${label}</td><td>${text}</td></tr>`;
  return (submarine
    ? SUB_STATION_IDS.map((id) => row(stationLabel(id), SUB_HOWTO[id])).join('')
    : FRIGATE_STATION_IDS.map((id) => row(stationLabel(id), FRIGATE_HOWTO[id])).join('')) +
    row('Notfall', `${emergencyKeys(submarine)}. Die Tasten wirken auf jeder Station; Feuer und Rakete gehen über den Sicherheitsknopf ihrer Station.`) +
    (submarine
      ? row('Überleben', 'Funk geht nur mit Mast und wird angepeilt. Bei einem Torpedo: Täuschkörper, volle Fahrt und durch die Sprungschicht.')
      : row('Schützen', 'Bleib zwischen U-Boot und Konvoi. Bei einem Torpedo: Täuschkörper-Schleppe und abdrehen.'));
}

/** Controls and a short how-to; mouse first, keyboard as shortcut. */
export function helpOverlay(submarine: boolean): void {
  if (document.querySelector('.overlay.help')) return;
  const howto = howtoRows(submarine);
  const ov = h(`<div class="overlay help"><div class="panel" style="padding:18px 22px">
    <div class="hd"><span>Bedienung</span><span><a class="btnlink" href="/handbuch.pdf" download="Tiefenkontakt-Handbuch.pdf" title="Ausführliches Spielerhandbuch zum Drucken (A4)">Handbuch (PDF)</a> <a class="btnlink" href="/erkennungsheft.pdf" download="Tiefenkontakt-Erkennungsheft.pdf" title="Alle Klassen zum Ausdrucken: Silhouetten im Maßstab, Akustik, Bedrohung, Radar (A4)">Erkennungsheft (PDF)</a> <button id="close">Schließen</button></span></div>
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
    <h3>WEITERE WERKZEUGE</h3>
    <table>
      <tr><td>TMA-Methoden</td><td>Hypothese (Residuen), Ekelund (Entfernung aus zwei Schlägen mit mind. 30° Kurswechsel) und Dot-Stack (Residuen bei 0,6/1,0/1,6-facher Entfernung: die ruhige Zeile stimmt). Lösungen veralten nach 120 s.</td></tr>
      <tr><td>Schleppsonar</td><td>Peilt links/rechts mehrdeutig. Seite wählen oder 20° wenden; hört das Rumpfsonar den Kontakt, löst es die Seite auf. Weicht es ab: möglicher Geist.</td></tr>
      <tr><td>Aktivsonar</td><td>CW misst die Annäherung (Doppler, ↓ = kommt näher), LFM misst genau und findet auch langsame Ziele.</td></tr>
      <tr><td>Sprungschicht</td><td>Unbekannt, bis gemessen: die Fregatte wirft einen BT, das U-Boot merkt sie beim Durchtauchen.</td></tr>
      <tr><td>Torpedo-Fahrt</td><td>30 kn ist leiser und der Suchkopf hört weiter; 40 kn ist schneller, macht den Suchkopf aber tauber. Torpedos führen das Ziel mit Vorhalt.</td></tr>
      <tr><td>Täuschkörper</td><td>Ein schwerer Torpedo durchläuft ihn, erkennt die Täuschung und sucht neu: abdrehen und Tiefe wechseln. Leichte U-Jagd-Torpedos verbrauchen sich daran.</td></tr>
      <tr><td>Abstrahlung</td><td>Schiffe sind von achtern am lautesten und von vorn am leisesten; querab gibt das stärkste Aktiv-Echo. Torpedos im toten Winkel achtern hört man erst spät.</td></tr>
      <tr><td>Transienten</td><td>Rohrfluten und Abschuss sind weit hörbar und warnen vor einem Schuss.</td></tr>
      <tr><td>Hubschrauber</td><td>Rechtsklick auf die Karte oder Reiter „Hubschrauber“ in der OPZ (Fregatte): Sonarboje, Tauchsonar, MAD, Angriff; die Tiefe folgt der gemessenen Schicht. Bojen peilen von ihrer Position aus.</td></tr>
      <tr><td>Schäden</td><td>Treffer beschädigen Antrieb, Sonar, Waffen und verursachen Wassereinbruch. Klick in der Schadensabwehr legt die Reparatur-Priorität fest.</td></tr>
      <tr><td>Besatzung</td><td>In der Lobby bei einem Teamkameraden „Mitfahren“: ihr bedient gemeinsam ein Schiff.</td></tr>
      <tr><td>KI</td><td>Ein Team ohne Spieler wird von der KI übernommen; du kannst also allein spielen.</td></tr>
    </table>
    <h3>TASTATUR</h3>
    <div class="dim">Aktion anklicken, dann die neue Taste drücken. ⇧ beim Kurs = 1° statt 5°.</div>
    <div id="keys"></div>
    <h3>GAMEPAD</h3>
    <table>
      <tr><td>Linker Stick</td><td>Kurs ändern: je weiter, desto schneller. Steuerkreuz ← → = 1°.</td></tr>
      <tr><td>RT / LT</td><td>Fahrt +1 / −1 kn (halten wiederholt).</td></tr>
      ${submarine ? '<tr><td>Steuerkreuz ↑ ↓</td><td>Tiefe −10 / +10 m.</td></tr>' : ''}
      <tr><td>LB / RB</td><td>Vorige / nächste Station.</td></tr>
      <tr><td>Start · Back</td><td>⚙ Einstellungen · diese Hilfe.</td></tr>
    </table>
    <h3>${submarine ? 'ABLAUF U-BOOT' : 'ABLAUF FREGATTE'}</h3>
    <table>${howto}</table>
    <div class="dim" style="margin-top:10px">Alle Uhren zeigen Simulationszeit. Eine Zeitraffung (Einstellung in der Lobby) steht oben neben der Restzeit.</div>
  </div></div>`);
  const close = () => {
    ov.remove();
    window.removeEventListener('keydown', esc);
  };
  const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
  ov.querySelector('#keys')!.replaceWith(keysEditor());
  ov.querySelector<HTMLButtonElement>('#close')!.onclick = close;
  ov.addEventListener('mousedown', (e) => e.target === ov && close());
  window.addEventListener('keydown', esc);
  document.body.appendChild(ov);
}
