import { figTma } from './figures.js';
import { emitterTable } from './units.js';

/** Handbook chapters 5–7: the boat commander, the escort commander, classification. */

const fig = (svg: string, cap: string) => `<figure>${svg}<figcaption>${cap}</figcaption></figure>`;
const shot = (file: string, cap: string) => `<figure class="ui"><img src="img/${file}" alt=""><figcaption>${cap}</figcaption></figure>`;
const pair = (a: string, b: string) => `<div class="cols2 shots">${a}${b}</div>`;

export const chapterSub = `
<h1 id="k5">5 · Als U-Boot-Kommandant</h1>
<p class="lead">Leise sein, zuerst hören, eine Lösung erarbeiten, schießen, verschwinden.</p>
<h2>Die Stationen</h2>
<table class="grid">
<tr><th>Taste</th><th>Station</th><th>Aufgabe</th></tr>
<tr><td>1</td><td>Horchraum</td><td>Breitband-Wasserfall über 360°, Signalanalyse (LOFAR, DEMON), Mithören, Klassifizieren, Aktivsonar, Bedrohungsseite mit Pings, Bojeneinschlägen und Ausweichvorschlag.</td></tr>
<tr><td>2</td><td>Sehrohr</td><td>3D-Sicht über Wasser: Peilung, Lagewinkel, Entfernung über die Masthöhe, Zähler für die Zeit mit Mast oben, Radarwarnung. Der Mast fährt in 8 s aus und 5 s ein. Am Mast sitzt auch ein kleines <b>Radar</b>: Es sendet nur mit ganz ausgefahrenem Mast (auf Sehrohrtiefe oder aufgetaucht) und findet Schiffe bis zum nahen Horizont, etwa 14 sm. Jedes Schiff und Flugzeug mit ESM peilt das Boot dabei an und erkennt ein U-Boot-Radar, also nur für einen kurzen Rundblick einschalten. Beim Einfahren des Masts oder Tauchen schaltet es ab.</td></tr>
<tr><td>3</td><td>Feuerleitung</td><td>TMA-Plot, Lösung erarbeiten, Torpedo programmieren (Fahrt, Suchtiefe, Aktiv/Passiv, Freigabe-Entfernung), Feuer und Drahtlenkung.</td></tr>
<tr><td>4</td><td>Tauchstand</td><td>Tiefenprofil mit Sprungschicht und Grund, Antrieb, Batterie und Restzeit, Schnorchel, Kavitationsgrenze.</td></tr>
</table>
${pair(shot('ui-u-horchraum.jpg', 'Bild 3 · Horchraum: Wasserfall, DEMON-Analyse, Kontaktliste und Bedrohungsseite.'), shot('ui-u-sehrohr.jpg', 'Bild 4 · Sehrohr mit Strichplatte; rechts die Messwerte.'))}
${pair(shot('ui-u-feuer.jpg', 'Bild 5 · Feuerleitung: Lagebild, TMA und Torpedoprogrammierung.'), shot('ui-u-tauch.jpg', 'Bild 6 · Tauchstand: Tiefenprofil, Maschine und Batterie.'))}
<h2>Der Ablauf eines Angriffs</h2>
<ol>
<li><b>Horchen:</b> langsam (3–5 kn) und tief fahren. Im Wasserfall erscheint eine Spur; Klick wählt den Kontakt.</li>
<li><b>Klassifizieren:</b> In der Signalanalyse Linien markieren (Kapitel 7). Erst wenn klar ist, dass es ein Frachter ist, lohnt der Anlauf.</li>
<li><b>Peilen:</b> Einen Schenkel von einigen Minuten fahren, dann 30–60° abdrehen und einen zweiten Schenkel fahren. Ohne Kurswechsel keine Entfernung.</li>
<li><b>Lösen:</b> „Auto-TMA“ oder den gelben Kreis ziehen, bis die Peilungsreste klein sind. Hilfen: Ekelund-Entfernung aus zwei Schenkeln, Dot-Stack. Ziel: Güte über 60 %. Lösungen veralten nach 120 s.</li>
<li><b>Bestätigen:</b> Ein kurzer Blick durchs Sehrohr misst die Entfernung, kostet aber Sichtbarkeit.</li>
<li><b>Schießen:</b> „Lösung übernehmen“ und „Feuer“, oder Rechtsklick auf die Karte und „Torpedo hierher“. Mit 30 kn läuft der Torpedo leiser und hört weiter, mit 40 kn ist er schneller.</li>
<li><b>Lenken:</b> Solange der Draht hält (eigene Fahrt bis 12 kn, bis 18 km), mit ◀ ▶ nachsteuern, bis „ZIEL ERFASST“ erscheint.</li>
<li><b>Absetzen:</b> Rohrfluten und Abschuss sind weit hörbar. Abdrehen, tief gehen, unter die Schicht.</li>
</ol>
${fig(figTma(), 'Abb. 8 · Zielbewegungsanalyse (TMA) mit zwei Schenkeln.')}
<h2>Antrieb, Luft und Boot</h2>
<table class="grid">
<tr><td>Batterie</td><td>Diesel- und AIP-Boote fahren getaucht auf Batterie. Der Verbrauch steigt mit dem Quadrat der Fahrt. Schnorcheln auf Sehrohrtiefe lädt, ist aber laut und zeigt Mast und Abgas. Das AIP-Boot verbraucht bis 5 kn nichts.</td></tr>
<tr><td>Luft</td><td>CO₂ steigt, O₂ fällt. Ab 3 % CO₂ oder unter 18 % O₂ leistet die Besatzung weniger. Abhilfe: Schnorcheln, Auftauchen, CO₂-Absorber und Sauerstoffkerzen.</td></tr>
<tr><td>Trimm</td><td>Fahrt und Tiefenwechsel bringen das Boot aus dem Trimm. Ein schlecht getrimmtes Boot steuert Tiefe träge.</td></tr>
<tr><td>Pressluft</td><td>Drei Flaschen. „Notanblasen“ (zweimal tippen) bringt das Boot schnell nach oben, ist aber sehr laut und kostet eine Flasche.</td></tr>
<tr><td>Testtiefe</td><td>Unter der Tauchtiefe drohen Lecks und Schäden.</td></tr>
<tr><td>Tiefenalarme</td><td>Im Tauchstand unter „Alarme“ einstellbar und einzeln abschaltbar: Obergrenze (meldet, wenn das Boot ungewollt flacher steigt; schweigt bei befohlener Sehrohrtiefe), Untergrenze (Vorgabe 90 % der Testtiefe) und Grundabstand mit WARNUNG (50 m) und GEFAHR (25 m) Wasser unter dem Kiel. Ein Alarm ertönt einmal und erscheint auf jeder Station unter der Kopfleiste und in der Tiefenzeile des Ruderstands; erneut erst, wenn das Boot den Bereich um einige Meter verlassen hat. Die Werte gelten je Bootsklasse und bleiben gespeichert.</td></tr>
<tr><td>Koppelort</td><td>Getaucht wird die eigene Position nur gekoppelt und immer ungenauer (bis 8 sm). Ein Fix am Mast setzt sie zurück.</td></tr>
<tr><td>Besatzung</td><td>Gefechtsstationen geben +10 % Leistung, ermüden aber in etwa 90 Minuten. „Ruhe im Boot“ senkt den Lärm um 3 dB, halbiert aber Reparatur und Nachladen.</td></tr>
</table>
<h2>Funk und Führung</h2>
<p>Funken geht nur mit ausgefahrenem Mast auf Sehrohrtiefe, und jede Sendung erzeugt beim Gegner eine Funkpeilung.
Die Flottenführung sendet etwa alle 20 Minuten für 3 Minuten. Empfangen kann man über VLF bis 25 m Tiefe oder mit der Schleppantenne bis 60 m bei höchstens 6 kn.</p>
<h2>Überleben</h2>
<ul>
<li><b>Ping gehört:</b> Heck zum Pinger, Schleichfahrt, durch die Sprungschicht. Die Bedrohungsseite schätzt, ob er schon ein Echo hat (ab etwa 25 dB) und ob er näher kommt.</li>
<li><b>Torpedo im Wasser:</b> Torpedo auf 150° achteraus legen, volle Fahrt, Tiefe wechseln, Täuschkörper werfen. Eine harte Wende bei Fahrt hinterlässt ein Wirbelfeld (Knuckle), das Schall schluckt.</li>
<li><b>Bojeneinschläge</b> in der Nähe heißen: Der Hubschrauber sucht hier. Leise bleiben, Ort verlassen.</li>
<li><b>Aktive Bojen (DICASS)</b> pingen alle 45 Sekunden und verraten sich dabei selbst. Ihre Pings tauchen im Horchraum als „Boje“ auf.</li>
<li><b>Flugzeugradar im ESM</b> (Bedrohungsseite „LUFT“): Seeaufklärer in der Nähe – Mast einfahren und tiefer gehen. Der eigene Fernaufklärer meldet den Konvoi dagegen über die Führung: Wer dann auf Empfangstiefe ist, bekommt Peilung, Entfernung, Kurs und Fahrt.</li>
<li><b>Lärmdeckung:</b> Wer nahe hinter einem Frachter läuft, verschwindet für die Eskorte in dessen Lärm.</li>
</ul>
<h2>Minen</h2>
<p>Kilo-, Küsten- und AIP-Boote haben vier Minen an Bord („Mine legen“ im Feuerleitstand, höchstens 8 kn, alle 30 s eine). Sie gehen nur in Wasser
von 25 bis 300 m: bis 60 m auf den Grund, tiefer verankert in 10 m. Nach drei Minuten sind sie scharf und treffen jedes Schiff, auch eigene und neutrale.
Am wirksamsten ist eine Sperre quer zur Route, 3 bis 6 km vor dem Konvoi, mit etwa 100 m Abstand – ein Frachter löst erst im Umkreis von rund 55 m aus.
In der Kampagne bleiben gelegte Minen verbraucht, bis die Werft aufmunitioniert.</p>
`;

export const chapterEscort = `
<h1 id="k6">6 · Als Kommandant der Eskorte</h1>
<p class="lead">Der Konvoi zählt, nicht die Abschüsse. Zwischen U-Boot und Konvoi bleiben, Kontakte früh finden, Angriffe stören.</p>
<h2>Die Stationen</h2>
<table class="grid">
<tr><th>Taste</th><th>Station</th><th>Aufgabe</th></tr>
<tr><td>1</td><td>Operationszentrale</td><td>Lagebild mit Konvoi, Eskorten, Datalink-Kontakten, Bojen, Hubschrauber und Funkpeilungen; Befehle an den Konvoi (Kurs, Zickzack, Fahrt).</td></tr>
<tr><td>2</td><td>Sonar</td><td>Rumpfsonar aktiv/passiv, Pulsart CW oder LFM, Schleppsonar mit Länge und Seitenwahl, BT-Sonde, VDS (nur F-30).</td></tr>
<tr><td>3</td><td>Waffen</td><td>U-Jagd-Rakete (bis 18 km, 40 s Flugzeit, setzt einen Leichttorpedo ab), Torpedorohre, Wasserbomben, Täuschkörper-Schleppe, Torpedowarnung.</td></tr>
<tr><td>4</td><td>Radar und ESM</td><td>Radar an/aus (verrät die eigene Position), kurze Echos von Masten und Schnorcheln, Peilung gegnerischer Funksprüche.</td></tr>
<tr><td>5</td><td>Brücke</td><td>Ausguck in 3D: Masten, Schnorchelfahnen, Torpedolaufbahnen, Treffer bei Tag; nachts nur beleuchtete Schiffe.</td></tr>
</table>
${pair(shot('ui-f-opz.jpg', 'Bild 7 · Operationszentrale mit Konvoi, Peillinien und Verbandsstatus.'), shot('ui-f-sonar.jpg', 'Bild 8 · Sonarraum der F-30: Rumpfsonar am VDS in 146 m, Schleppsonar, LOFAR.'))}
${pair(shot('ui-f-waffen.jpg', 'Bild 9 · Waffenleitstand mit Zielkarte.'), shot('ui-f-radar.jpg', 'Bild 10 · Radar und Funkpeilung (ESM-Rose).'))}
${shot('ui-f-bruecke.jpg', 'Bild 11 · Brücke: Ausguck in 20 m Augenhöhe.')}
<h2>Sensoren richtig einsetzen</h2>
<table class="grid">
<tr><td>Schleppsonar</td><td>Das beste passive Ohr. Lang ausgebracht hängt es unter der Schicht. Nur bis 14 kn brauchbar, nach jedem Kurswechsel 60 s Stabilisierung. Links/rechts-Mehrdeutigkeit: 20° wenden oder das Rumpfsonar entscheidet.</td></tr>
<tr><td>Aktivsonar</td><td>Liefert Entfernung, verrät aber das Schiff auf große Entfernung. <b>CW</b> misst den Doppler (kommt er näher?), <b>LFM</b> misst genau und findet auch langsame Ziele im Nachhall.</td></tr>
<tr><td>VDS (F-30)</td><td>Der Sonarkörper wird 40 m unter die gemessene Schicht gefiert. Dort hört und pingt er ohne den Schichtverlust. Bis 18 kn.</td></tr>
<tr><td>BT-Sonde</td><td>Misst die Sprungschicht. Ohne Messung kennt man ihre Tiefe nicht.</td></tr>
<tr><td>Radar</td><td>Sieht Masten und Schnorchel auf einige Kilometer und Flugzeuge weit darüber hinaus, verrät aber die Fregatte an jedes U-Boot mit ESM. Taucht der feindliche Fernaufklärer auf, kennen die U-Boote bald die Lage des Konvois – Kurs ändern lohnt sich.</td></tr>
</table>
<h3>ESM: Wer sendet da?</h3>
<p>Der ESM-Empfänger peilt nicht nur, er erkennt den Sender an Band, Umlaufzeit und Pulsbild. Eine Meldung lautet etwa „ESM 252° · SEEFALKE-2 · FREGATTE? (OBERFLÄCHENSUCHE) · STARK, STEIGEND“: Sender, wahrscheinlicher Träger, Art des Radars, Signalstärke und ob sie zunimmt (der Sender kommt näher). Ein Fragezeichen heißt: Mehrere Klassen tragen dasselbe Gerät – die F-12 und die F-30 klingen gleich, alle Handelsschiffe auch. Das ist ein Hinweis, keine Identifizierung. Flugzeugradare und Feuerleitradare erscheinen rot; im Sehrohr steht dann „FLUGZEUGRADAR – TAUCHEN“. Ein Feuerleitradar strahlt nur, solange das Schiff einen Flugkörper lenkt. Auf der Karte trägt die ESM-Peillinie den Sendernamen.</p>
${emitterTable()}
<h2>Hubschrauber und Seeaufklärer (F-12)</h2>
<p>Rechtsklick auf die Karte öffnet die Luftmittel. Der Hubschrauber fliegt mit 120 kn bis 30 km weit und braucht nach jeder Landung 2 Minuten an Deck.</p>
<table class="grid">
<tr><td>Sonarboje flach / tief</td><td>Passive Boje (DIFAR): peilt von ihrem Ort aus, 30 Minuten lang. „Tief“ hängt unter der Schicht. Bojen treiben mit der Strömung.</td></tr>
<tr><td>Aktive Boje (DICASS)</td><td>Pingt 15 Minuten lang alle 45 s und liefert Peilung und Entfernung bis etwa 6 km. Jedes U-Boot in der Nähe hört sie.</td></tr>
<tr><td>Tauchsonar</td><td>Der Hubschrauber schwebt 5 Minuten und pingt alle 20 s, flach oder unter der Schicht, bis 12 km.</td></tr>
<tr><td>Leichttorpedo</td><td>Abwurf auf eine Position; der Torpedo sucht im Kreis (45 kn, 8 km Lauf).</td></tr>
<tr><td>MAD</td><td>Kleeblattmuster in 50 m Höhe: Die Magnetsonde findet ein getauchtes Boot nur direkt darunter (wenige hundert Meter).</td></tr>
<tr><td>Seeaufklärer</td><td>Legt eine Bojenkette quer zu einer Peilung. Danach 30 Minuten Bereitschaft.</td></tr>
</table>
<h2>Angriff</h2>
<ol>
<li>Kontakt mit Entfernung festmachen: Aktivsonar, Kreuzpeilung zweier Schiffe, Boje oder Tauchsonar.</li>
<li>Rakete auf die Position (Rechtsklick „U-Jagd-Rakete hierher“). Der Leichttorpedo sucht aktiv; Täuschkörper können ihn verbrauchen, Wirbelfelder durchschaut er.</li>
<li>Nah dran: Wasserbomben überlaufen das Ziel; sie wirken in der eingestellten Tiefe.</li>
<li>Torpedowarnung: Täuschkörper-Schleppe ausbringen, abdrehen, Fahrt aufnehmen.</li>
</ol>
<h2>Minenabwehr</h2>
<p>Das aktive Rumpfsonar findet verankerte Minen voraus bis etwa 1 km (Grundminen 0,6 km). Das <b>Minenmeidesonar</b> (Sonarstation, „Minenmeiden“)
reicht 1,6 km in ±70° voraus, auch ohne Aktivsonar und kaum weit zu hören – aber nur bis 15 kn. Sein Suchsektor steht im Lagebild.
Gefundene Minen gehen über den Datalink an alle Geleitschiffe; der Konvoi weicht ihnen mit 400 m Abstand aus.
Liegt eine ganze Sperre vor dem Konvoi, versetzt <b>„Konvoi umleiten“</b> in der OPZ seinen Kurs um 1,5 oder 3 km zur Seite; „Route“ führt ihn zurück.</p>
<h2>Positionslichter</h2>
<p>Neutrale Schiffe fahren immer mit Lichtern. Der Konvoi führt sie, um die Kolonnen zu halten, und verdunkelt, sobald eine Bedrohung gemeldet wird
(Torpedowarnung, Verlust, Sichtung), für 30 ruhige Minuten. Eskorten löschen ihre Lichter zusätzlich, solange sie pingen oder auf Gefechtsstationen sind.
Nachts sieht man beleuchtete Schiffe viel weiter.</p>
`;

export const chapterClassify = `
<h1 id="k7">7 · Klassifizieren</h1>
<p>Der Server schickt nur Messwerte. Was ein Kontakt ist, entscheidest du. Die Klassenbibliothek bewertet deine Marken, die Entscheidung triffst du mit den Klassen-Knöpfen.</p>
<table class="grid">
<tr><th>Schritt</th><th>Vorgehen</th></tr>
<tr><td>1 · LOFAR</td><td>Kontakt wählen, auf eine senkrechte Linie klicken und „Grundton markieren“. Gestrichelte Linien bei 2f und 3f zeigen, ob die anderen Linien eine Familie bilden (Generator, Getriebe).</td></tr>
<tr><td>2 · DEMON</td><td>Die tiefe Linie als „Welle“, die stärkere höhere als „Blatt“ markieren. Blatt ÷ Welle = Blattzahl, Welle × 60 = Drehzahl. Drehzahl ÷ Fahrt ergibt einen Wert, der zur Klasse passt.</td></tr>
<tr><td>3 · Bibliothek</td><td>Sie vergleicht Blattzahl, Drehzahl je Knoten und Linien mit dem Katalog (siehe Einheitenreferenz).</td></tr>
<tr><td>Filter</td><td>Band wählen, Notch blendet die eigene Schraube aus, lange Integration hebt schwache Linien, „Spitze“ hält Maxima.</td></tr>
</table>
<div class="cols2">
<div class="box"><h4>Typische Merkmale</h4><ul>
<li><b>Frachter:</b> laut, 4–5 Blätter, Linien 50/100/150 Hz.</li>
<li><b>Fregatte/Korvette:</b> mittlere Drehzahl, Linien 60 bzw. 75 Hz.</li>
<li><b>U-Boot:</b> leise, 6–7 Blätter, kaum Linien; schnorchelnd starke Diesellinien.</li>
<li><b>Torpedo:</b> laut, keine Linien, sehr hohe Drehzahl, schnell wandernde Peilung.</li>
<li><b>Wale:</b> keine Schraube, pulsierende tiefe Töne um 20 Hz.</li>
</ul></div>
<div class="box"><h4>Fallen</h4><ul>
<li>Schleppsonar-Geister: Rumpf und Schlepp weichen ab.</li>
<li>Maskierung durch den Konvoi: Ein U-Boot in derselben Peilung wie ein Frachter fehlt im Wasserfall.</li>
<li>Neutrale Schiffe (Trawler, Frachter ohne AIS) nicht angreifen.</li>
</ul></div>
</div>
`;
