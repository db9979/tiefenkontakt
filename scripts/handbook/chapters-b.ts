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
<tr><td>1</td><td>Horchraum</td><td>Breitband-Wasserfall über die volle Höhe, Signalanalyse (LOFAR, DEMON), Mithören, Klassifizieren, Schleppsonar. Reiter <b>Kontakte</b>; <b>Bedrohung</b> mit Pings, Bojeneinschlägen, Ausweichvorschlag und Reichweitenvorhersage; <b>Aktiv</b> mit dem Aktivsonar-Schirm (Einzelping, verrät das Boot weit hinaus).</td></tr>
<tr><td>2</td><td>Sehrohr</td><td>3D-Sicht über Wasser mit Sichtfeld und Stadimeter (siehe unten), Erkennungsheft und Foto. Daneben der Block <b>Mast · Radarwarner</b>: Zeit mit Mast oben (nach 20 s rät er zum Einfahren), ESM-Radarwarnung (hört nur mit Mast oben) und das kleine <b>Radar</b> am Mast. Es sendet nur mit ganz ausgefahrenem Mast und findet Schiffe bis zum nahen Horizont, etwa 14 sm; ein kleiner Radarschirm erscheint dann unter dem Sehrohr. Jedes Schiff und Flugzeug mit ESM peilt das Boot dabei an, also nur für einen kurzen Rundblick einschalten. Der Mast fährt in 8 s aus und 5 s ein.</td></tr>
<tr><td>3</td><td>Feuerleitung</td><td>Lagebild und Kontakte, TMA (Hypothese, Ekelund, Dot-Stack, Auto-TMA), Torpedo programmieren (Fahrt, Suchtiefe, Aktiv/Passiv, Freigabe-Entfernung, Salve und Fächer), Rohrbank mit Ladestand und Nachladen, Feuer; Torpedos am Draht mit Feinsteuerung und Restlaufzeit, Täuschkörper.</td></tr>
<tr><td>4</td><td>Zentrale</td><td>Der Platz des Kommandanten: Koppeltisch mit Wegpunkten und darunter das Tiefenprofil mit Sprungschicht und Grund (Klick = Tiefe); Kacheln für Tiefe, Trimm, Batterie (mit Reichweite bei dieser Fahrt) und Schnorchel; Tiefe befehlen (Sehrohrtiefe, 60 m, über/unter die Schicht, größte Tiefe); Befehle (Alarmtauchen, Schnorcheln, Ruhe im Boot, Gefechtsstationen, Echolot, Notanblasen); Navigation mit Echolot, Bootszustand, Tiefenalarme, Minen.</td></tr>
</table>
${pair(shot('ui-u-horchraum.jpg', 'Bild 3 · Horchraum: Wasserfall, DEMON-Analyse, Kontaktliste und Bedrohungsseite.'), shot('ui-u-sehrohr.jpg', 'Bild 4 · Sehrohr mit Strichplatte; rechts die Messwerte.'))}
${shot('ui-u-feuer.jpg', 'Bild 5 · Feuerleitung: Lagebild, TMA und Torpedoprogrammierung.')}
<p class="small">Die Bildschirmfotos stammen aus einer Version vor der Zusammenlegung der Stationen; Anordnung und Reiter weichen im Spiel davon ab, die Bedienelemente sind dieselben.</p>
<h2>Der Ablauf eines Angriffs</h2>
<ol>
<li><b>Horchen:</b> langsam (3–5 kn) und tief fahren. Im Wasserfall erscheint eine Spur; Klick wählt den Kontakt.</li>
<li><b>Klassifizieren:</b> In der Signalanalyse Linien markieren (Kapitel 7). Erst wenn klar ist, dass es ein Frachter ist, lohnt der Anlauf.</li>
<li><b>Peilen:</b> Einen Schenkel von einigen Minuten fahren, dann 30–60° abdrehen und einen zweiten Schenkel fahren. Ohne Kurswechsel keine Entfernung.</li>
<li><b>Lösen:</b> „Auto-TMA“ oder den gelben Kreis ziehen, bis die Peilungsreste klein sind. Hilfen: Ekelund-Entfernung aus zwei Schenkeln, Dot-Stack. Ziel: Güte über 60 %. Lösungen veralten nach 120 s.</li>
<li><b>Bestätigen:</b> Ein kurzer Blick durchs Sehrohr misst die Entfernung mit dem Stadimeter, kostet aber Sichtbarkeit.</li>
<li><b>Schießen:</b> „Lösung übernehmen“, Salve wählen und „Feuer“, oder Rechtsklick auf die Karte und „Torpedo hierher“ (im Profi-Modus setzt das nur Schusskurs und Suchkopf-Entfernung, geschossen wird mit dem Feuer-Knopf). Geschossen wird nur bis 15 kn eigener Fahrt und bis 0,8 × Tauchtiefe.</li>
<li><b>Lenken:</b> Solange der Draht hält (eigene Fahrt bis 12 kn, bis 18 km), mit ◀ ▶ nachsteuern, bis „ZIEL ERFASST“ erscheint. Jeder Draht zeigt die Restlaufzeit seines Torpedos.</li>
<li><b>Absetzen:</b> Rohrfluten und Abschuss sind weit hörbar. Abdrehen, tief gehen, unter die Schicht.</li>
</ol>
<div class="box"><h4>Erkennungsheft</h4><p>„Erkennung“ am Sehrohr (und auf der Brücke der Fregatte) öffnet das Heft mit allen Klassen. Jede Seite hat drei Reiter:
<b>Sicht</b> zeigt Seite, Draufsicht und Bug, alle Schiffe in einem gemeinsamen Maßstab und alle U-Boote in einem eigenen –
so lassen sich Größen direkt vergleichen. Eingetragen sind Höhengitter, Wasserlinie, Länge, Tiefgang und die Masthöhe, mit der das
Stadimeter rechnet; „Vergleich“ legt den Umriss einer zweiten Klasse darüber. Darunter stehen die Klassen, mit denen man sie leicht
verwechselt, und woran man sie unterscheidet. <b>Akustik</b> zeigt Flügelzahl, Drehzahl je Knoten, die Schmalbandlinien bis 500 Hz
(gelb: nur beim Schnorcheln) und wie die Klasse klingt. <b>Bedrohung</b> listet Waffen und Sensoren mit ihrer Reichweite und einen
taktischen Hinweis. Alle Werte kommen aus der Simulation. „Klasse zuweisen“ ordnet die Klasse dem gewählten Sichtkontakt zu.</p></div>
${fig(figTma(), 'Abb. 8 · Zielbewegungsanalyse (TMA) mit zwei Schenkeln.')}
<h2>Sehrohr: Sichtfeld und Stadimeter</h2>
<p>Das Sehrohr sieht nur, wohin es zeigt. Das Sichtfeld ist bei 1,5× Vergrößerung 32° breit, bei 6× 8° und bei 12× 4°; was außerhalb liegt, wird
nicht entdeckt. Solange niemand das Sehrohr dreht, hält die Wache es mit 1,5× auf den Bug. „Himmel absuchen“ sucht den Luftraum ab, „Auf Ziel“ dreht
auf den gewählten Kontakt. Über 10 kn darf kein Mast oben sein: Fährt das Boot schneller, holt die Besatzung Mast und Radar ein und meldet es. Ist das Boot zu tief, wird der Mast vorgemerkt („VORGEMERKT“): Es geht auf Sehrohrtiefe, und der Mast fährt bei Ankunft aus.</p>
<p>Die Entfernung misst das <b>Stadimeter</b>: Man weist dem Ziel eine Klasse zu (Erkennungsheft, „Klasse zuweisen“), das Stadimeter rechnet mit deren
Masthöhe aus dem Winkel zwischen Mastspitze und Wasserlinie. Das Anlegen von Hand hat einen Fehler von etwa 6 %; eine falsch zugewiesene Klasse
verschiebt die Entfernung entsprechend.</p>
<table class="grid">
<tr><th>Stufe</th><th>Was das Sehrohr verrät</th></tr>
<tr><td>Profi</td><td>Weder Klasse noch Entfernung werden geschenkt. Ohne zugewiesene Klasse steht in der Entfernungszeile „KLASSE ZUWEISEN“; die Entfernung gibt es nur über das Stadimeter.</td></tr>
<tr><td>Einsteiger</td><td>Die gemessene Entfernung steht neben dem Stadimeterwert. Wer ein Schiff 10 s ohne Unterbrechung mit 6× oder 12× im Bild hält, bekommt seine Klasse automatisch.</td></tr>
</table>
<h2>Torpedos</h2>
<table class="grid">
<tr><td>Reichweite</td><td>Der schwere Torpedo läuft mit 30 kn bis 25 km, mit 40 kn nur bis 15 km (dazwischen gleitend). Mit 30 kn ist er leiser und der Suchkopf hört weiter, mit 40 kn ist er schneller.</td></tr>
<tr><td>Abschuss</td><td>Nur bis 15 kn eigener Fahrt und bis 0,8 × Tauchtiefe. Ist eins davon verletzt, bleibt FEUER gesperrt und zeigt den Grund; ein Knopf daneben behebt ihn mit einem Klick.</td></tr>
<tr><td>Salve</td><td>1 bis 4 Torpedos, im Fächer um die Lösungspeilung (höchstens 10° zwischen zwei Torpedos). Vorgeschlagen wird ein Fächer nach Länge des Ziels auf diese Entfernung und Fehler der TMA.</td></tr>
<tr><td>Draht</td><td>Hält bis 18 km Laufstrecke und solange das Boot nicht schneller als 12 kn fährt. Jeder Draht zeigt die Restlaufzeit.</td></tr>
<tr><td>Sicherung</td><td>Ist das Ziel ein eigenes Schiff, stehen Eigene nahe am Zielpunkt oder liegt die TMA-Güte unter 30 %, fragt der Feuer-Knopf ein zweites Mal; ohne Ziel verweigert er.</td></tr>
<tr><td>Frachter</td><td>Ein Treffer macht einen Frachter zum Nachzügler: Er schleppt sich mit höchstens 4 kn aus dem Konvoi und sinkt etwa 15 Minuten später. Zwei Treffer versenken ihn sofort.</td></tr>
</table>
<h2>Antrieb, Luft und Boot</h2>
<table class="grid">
<tr><td>Batterie</td><td>Diesel- und AIP-Boote fahren getaucht auf Batterie. Sie kommen von einer Feindfahrt und starten mit 40–70 % Ladung (in leichten Partien mindestens 60 %). Der Verbrauch ist 1 + v³/70 % je Stunde (v in kn): gestoppt 1 %/h, bei 6 kn etwa 4 %/h, bei 10 kn etwa 15 %/h; volle Fahrt leert eine volle Batterie in rund einer Stunde. Die Kachel in der Zentrale zeigt die Reichweite bei der gerade gefahrenen Fahrt. Schnorcheln auf Sehrohrtiefe (höchstens 8 kn) lädt, ist aber laut und zeigt Mast und Abgas. Das AIP-Boot verbraucht bis 5 kn nichts.</td></tr>
<tr><td>Luft</td><td>CO₂ steigt geschlossen um etwa 0,12 % je Stunde, O₂ fällt. Ab 3 % CO₂ oder unter 18 % O₂ leistet die Besatzung weniger. Abhilfe: Schnorcheln, Auftauchen, CO₂-Absorber und Sauerstoffkerzen.</td></tr>
<tr><td>Trimm</td><td>Fahrt und Tiefenwechsel bringen das Boot aus dem Trimm. Ein schlecht getrimmtes Boot steuert Tiefe träge.</td></tr>
<tr><td>Pressluft</td><td>Drei Flaschen. „Notanblasen“ (zweimal tippen) bringt das Boot schnell nach oben, ist aber sehr laut und kostet eine Flasche.</td></tr>
<tr><td>Testtiefe</td><td>Unter der Tauchtiefe drohen Lecks und Schäden.</td></tr>
<tr><td>Tiefenalarme</td><td>In der Zentrale unter „Tiefenalarme“ einstellbar und einzeln abschaltbar: Obergrenze (meldet, wenn das Boot ungewollt flacher steigt; schweigt bei befohlener Sehrohrtiefe), Untergrenze (Vorgabe 90 % der Testtiefe) und Grundabstand mit WARNUNG (50 m) und GEFAHR (25 m) Wasser unter dem Kiel. Ein Alarm ertönt einmal und erscheint auf jeder Station unter der Kopfleiste und in der Tiefenzeile des Ruderstands; erneut erst, wenn das Boot den Bereich um einige Meter verlassen hat. Die Werte gelten je Bootsklasse und bleiben gespeichert.</td></tr>
<tr><td>Koppelort</td><td>Getaucht wird die eigene Position nur gekoppelt und immer ungenauer (bis 8 sm). Ein Fix am Mast setzt sie zurück.</td></tr>
<tr><td>Besatzung</td><td>Gefechtsstationen geben +10 % Leistung, ermüden aber in etwa 90 Minuten. Ein Alarm (Torpedo im Wasser, Treffer) ruft sie von selbst aus; nach 20 ruhigen Minuten werden sie wieder aufgehoben. „Ruhe im Boot“ senkt den Lärm um 3 dB, halbiert aber Reparatur und Nachladen.</td></tr>
<tr><td>Eigene Geräusche</td><td>Die Besatzung macht Lärm, wenn sie arbeitet: Nachladen eines Rohrs, anlaufende Trimmpumpen bei Schleichfahrt und Alarmtauchen sind als Transienten zu hören. Wer leise bleiben will, wartet damit.</td></tr>
</table>
<h3>Route plotten</h3>
<p>Auf dem Koppeltisch der Zentrale setzt <b>„⚑ Wegpunkte“</b> mit jedem Klick einen Wegpunkt; Ziehen verschiebt ihn, Rechtsklick auf einen Punkt gibt ihm Fahrt und Tiefe oder löscht ihn. Fahrt und Tiefe gelten ab Beginn des Schenkels zu diesem Punkt, danach darf man sie von Hand ändern. An jedem Schenkel stehen rechtweisender Kurs und Länge. <b>„Route fahren“</b> lässt den Rudergänger Punkt für Punkt abfahren (der Knopf zeigt den nächsten Wegpunkt); er steuert nach dem Koppelort, getaucht liegt die Route also so ungenau wie dieser. Jeder Kurs von Hand schaltet die Route ab, die Punkte bleiben stehen. <b>„Voraus N min“</b> zeigt, wo das Boot nach 3 bis 30 Minuten steht.</p>
<h2>Funk und Führung</h2>
<p>Funken geht nur mit ausgefahrenem Mast auf Sehrohrtiefe, und jede Sendung erzeugt beim Gegner eine Funkpeilung.
Die Flottenführung sendet etwa alle 20 Minuten für 3 Minuten. Empfangen kann man über VLF bis 25 m Tiefe oder mit der Schleppantenne bis 60 m bei höchstens 6 kn.</p>
<h2>Überleben</h2>
<ul>
<li><b>Ping gehört:</b> Heck zum Pinger, Schleichfahrt, durch die Sprungschicht. Die Bedrohungsseite schätzt, ob er schon ein Echo hat (ab etwa 25 dB) und ob er näher kommt.</li>
<li><b>Torpedo im Wasser:</b> Torpedo auf 150° achteraus legen, volle Fahrt, Tiefe wechseln, Täuschkörper werfen. Eine harte Wende bei Fahrt hinterlässt ein Wirbelfeld (Knuckle), das Schall schluckt.</li>
<li><b>Bojeneinschläge</b> in der Nähe heißen: Der Hubschrauber sucht hier. Leise bleiben, Ort verlassen.</li>
<li><b>Aktive Bojen (DICASS)</b> pingen alle 45 Sekunden und verraten sich dabei selbst. Ihre Pings tauchen im Horchraum als „Boje“ auf.</li>
<li><b>Radar gegen Mast:</b> Jedes Radar hat je Antennenumdrehung eine Chance, einen Mast zu sehen – ein Sehrohr bis etwa 5 sm, einen Schnorchel mit Gischt und Abgas viel leichter und bis 8 sm. Seegang stört das Radar. Also kurz zeigen und wieder einfahren.</li>
<li><b>Radarwarner:</b> ESM und Radarwarner hören ein Radar nur etwas über den Funkhorizont hinaus (zwischen U-Boot und Fregatte etwa 18 sm, nie über 40 sm), und nur mit Mast oben.</li>
<li><b>Flugzeugradar im ESM</b> (Bedrohungsseite „LUFT“): Seeaufklärer oder Hubschrauber in der Nähe – Mast einfahren und tiefer gehen. Ihr Radar findet einen Schnorchel aus der Luft weit (Seefernaufklärer 30 km, Hubschrauber im Transit 15 km), ein Sehrohr auf 9 bzw. 6 km, und meldet der ganzen Eskorte eine Position auf etwa 1 km genau. Der eigene Fernaufklärer meldet den Konvoi dagegen über die Führung: Wer dann auf Empfangstiefe ist, bekommt Peilung, Entfernung, Kurs und Fahrt.</li>
<li><b>Lärmdeckung:</b> Wer nahe hinter einem Frachter läuft, verschwindet für die Eskorte in dessen Lärm.</li>
</ul>
<h2>Minen</h2>
<p>Kilo-, Küsten- und AIP-Boote haben vier Minen an Bord („Mine legen“ in der Zentrale, höchstens 8 kn, alle 30 s eine). Sie gehen nur in Wasser
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
<tr><td>1</td><td>OPZ</td><td>Operationszentrale: Lagebild mit Konvoi, Eskorten, Datalink-Kontakten, Bojen, Hubschrauber und Funkpeilungen, darüber eine Leiste mit dem Stand aller U-Jagd-Mittel; Wegpunkte und „Route fahren“. Reiter <b>Kontakte</b>; <b>Verband</b> mit „Konvoi umleiten“, Frachtern, Datalink-Teilnehmern, Strom und Seefernaufklärer; <b>Hubschrauber</b> mit der Auftragsliste des Bordhubschraubers (nur Fregatte mit Hubschrauber).</td></tr>
<tr><td>2</td><td>Sonar</td><td>Rumpf- und Schleppsonar übereinander, Schleppsonar mit Länge und Seitenwahl. Reiter <b>Analyse</b> (LOFAR/DEMON), <b>Aktiv</b> (Aktivsonar-Schirm mit Einzelping, Dauerpingen, CW/LFM und Bereich 4/8/16 km), <b>VDS/BT</b> (BT-Sonde, Tiefensonar nur F-30, Minenmeiden, Reichweitenvorhersage) und <b>Kontakte</b>.</td></tr>
<tr><td>3</td><td>Waffen</td><td>Ziel, vier Waffenkarten: U-Jagd-Rakete (1,8–18 km, 40 s Flugzeit, setzt einen Leichttorpedo ab), Torpedorohre, Wasserbombenwerfer (wirft voraus), Torpedoabwehr mit Täuschkörper-Schleppe; beim Wachschiff die Seezielflugkörper. Dazu Zielkarte (Rechtsklick = Rakete hierher) und Kontakte.</td></tr>
<tr><td>4</td><td>Radar/ESM</td><td>Luft-/Seeraumradar mit Bereichswahl (verrät die eigene Position), kurze Echos von Masten und Schnorcheln, ESM-Peilungen als rote Striche am Rand des Radarschirms und in der Liste, Luftabwehr.</td></tr>
<tr><td>5</td><td>Brücke</td><td>Ausguck in 3D mit Fernglas: Masten, Schnorchelfahnen, Torpedolaufbahnen, Treffer bei Tag; nachts nur beleuchtete Schiffe. Daneben die Messwerte des Ausgucks; „Erkennung“ öffnet das Erkennungsheft.</td></tr>
</table>
${pair(shot('ui-f-opz.jpg', 'Bild 6 · Operationszentrale mit Konvoi, Peillinien und Verbandsstatus.'), shot('ui-f-sonar.jpg', 'Bild 7 · Sonarraum der F-30: Rumpfsonar am VDS in 146 m, Schleppsonar, LOFAR.'))}
${pair(shot('ui-f-waffen.jpg', 'Bild 8 · Waffenleitstand mit Zielkarte.'), shot('ui-f-radar.jpg', 'Bild 9 · Radar und Funkpeilung (ESM-Rose).'))}
${shot('ui-f-bruecke.jpg', 'Bild 10 · Brücke: Ausguck in 20 m Augenhöhe.')}
<p><b>Route plotten:</b> In der OPZ werden Wegpunkte genauso gesetzt wie im U-Boot (<b>„⚑ Wegpunkte“</b>, Ziehen, Rechtsklick für Fahrt oder Löschen). <b>„Route fahren“</b> steuert die Fregatte selbst von Punkt zu Punkt, etwa für einen Suchschlag vor dem Konvoi; ein Kurs von Hand oder „Kurs hierher“ schaltet sie ab. Der Vorausvektor zeigt die Position in N Minuten.</p>
<h2>Sensoren richtig einsetzen</h2>
<table class="grid">
<tr><td>Schleppsonar</td><td>Das beste passive Ohr. Lang ausgebracht hängt es unter der Schicht. Nur bis 14 kn brauchbar. Nach einer Kursänderung unter 10° bleibt es ruhig, bis 45° braucht es 60 s, bei mehr 150 s auf dem neuen Kurs. Gegen laute Boote (Schnorchel, Diesel aufgetaucht, Pumpen, Kavitation, Anblasen) gewinnt es 8 dB auf deren Schmalbandlinien; ein leises Boot auf Batterie bietet ihm diesen Vorteil nicht. Links/rechts-Mehrdeutigkeit: 20° wenden oder das Rumpfsonar entscheidet.</td></tr>
<tr><td>Aktivsonar</td><td>Liefert Entfernung, verrät aber das Schiff auf große Entfernung. Voreingestellt ist der <b>Einzelping</b> (Taste <kbd>P</kbd>); „Dauer“ pingt im Takt des Bereichs. Der Bereich legt fest, wie weit Echos kommen und wie oft gepingt wird: 4 km alle 6 s, 8 km alle 11 s, 16 km alle 22 s; Echos von jenseits des Bereichs zeigt der Schirm nicht. Der Schirm zeigt den hinauslaufenden Ring, Nachhall, den toten Winkel achtern, Echos mit Doppler-Farbe bei CW (gelb nähert, blau entfernt), eine Echotabelle und den Countdown zum nächsten Ping. <b>CW</b> misst den Doppler (kommt er näher?), <b>LFM</b> misst genau und findet auch langsame Ziele im Nachhall.</td></tr>
<tr><td>VDS (F-30)</td><td>Der Sonarkörper wird 40 m unter die gemessene Schicht gefiert. Dort hört und pingt er ohne den Schichtverlust. Bis 18 kn.</td></tr>
<tr><td>BT-Sonde</td><td>Misst die Sprungschicht. Ohne Messung kennt man ihre Tiefe nicht.</td></tr>
<tr><td>Radar</td><td>Hat je Antennenumdrehung eine Chance auf einen Mast (Sehrohr bis etwa 5 sm, Schnorchel deutlich leichter und bis 8 sm; Seegang stört). Sieht Masten und Schnorchel also auf einige Kilometer und Flugzeuge weit darüber hinaus, verrät aber die Fregatte an jedes U-Boot mit ESM. Taucht der feindliche Fernaufklärer auf, kennen die U-Boote bald die Lage des Konvois – Kurs ändern lohnt sich.</td></tr>
</table>
<h3>ESM: Wer sendet da?</h3>
<p>Der ESM-Empfänger peilt nicht nur, er erkennt den Sender an Band, Umlaufzeit und Pulsbild. Eine Meldung lautet etwa „ESM 252° · SEEFALKE-2 · FREGATTE? (OBERFLÄCHENSUCHE) · STARK, STEIGEND“: Sender, wahrscheinlicher Träger, Art des Radars, Signalstärke und ob sie zunimmt (der Sender kommt näher). Ein Fragezeichen heißt: Mehrere Klassen tragen dasselbe Gerät – die F-12 und die F-30 klingen gleich, alle Handelsschiffe auch. Das ist ein Hinweis, keine Identifizierung. Flugzeugradare und Feuerleitradare erscheinen rot; im Sehrohr steht dann „FLUGZEUGRADAR – TAUCHEN“. Ein Feuerleitradar strahlt nur, solange das Schiff einen Flugkörper lenkt. Auf der Karte trägt die ESM-Peillinie den Sendernamen.</p>
${emitterTable()}
<h2>Hubschrauber und Seeaufklärer (F-12)</h2>
<p>Der Bordhubschrauber der F-12 fliegt mit 120 kn bis 30 km vom Schiff und arbeitet eine <b>Auftragsliste</b> ab (bis zu acht Aufträge). Befohlen wird im
OPZ-Reiter <b>Hubschrauber</b> zum gewählten Kontakt oder zu einem Punkt, den man im Kartenmenü als „Hubschrauber-Ziel hier“ wählt, oder direkt per
Rechtsklick auf die Karte. <b>ANHÄNGEN</b> setzt den Auftrag ans Ende der Liste, <b>SOFORT</b> verwirft alles andere. Die Liste zeigt jeden Auftrag mit
der Zeit bis zur Ankunft; × streicht einen Auftrag, „Liste leeren“ schickt ihn heim.</p>
<table class="grid">
<tr><td>Ausdauer</td><td>Etwa 90 Minuten Treibstoff; bei knappem Treibstoff kehrt er von selbst um. An Deck dauern Tanken und Aufmunitionieren 10 Minuten. Je Flug trägt er 12 Bojen und 2 Leichttorpedos aus dem Magazin des Schiffs.</td></tr>
<tr><td>Tauchsonar</td><td>Schwebt 3 Minuten und pingt alle 20 s (bis 12 km) über und unter der gemessenen Schicht, dann 4 km weiter in Suchrichtung zur nächsten Tauchstelle (voreingestellt drei) oder, nach einem Echo, auf den Kontakt zu.</td></tr>
<tr><td>Bojenlinie</td><td>4, 5 oder 6 passive Bojen (DIFAR) mit 2,5 km Abstand quer zur Sichtlinie über dem Ziel, abwechselnd über und unter der Schicht. Bojen peilen 30 Minuten lang von ihrem Ort aus und treiben mit der Strömung. Als aktive Bojenlinie (DICASS) pingt jede Boje alle 45 s und liefert Peilung und Entfernung bis etwa 6 km – jedes U-Boot in der Nähe hört sie.</td></tr>
<tr><td>MAD</td><td>Kleeblattmuster in 50 m Höhe über dem Punkt (6 Minuten): Die Magnetsonde findet ein getauchtes Boot nur direkt darunter (wenige hundert Meter).</td></tr>
<tr><td>Angriff</td><td>Leichttorpedo auf die letzte gehaltene Position des Kontakts; aus dem Schweben dauert es etwa eine Minute bis zum Abwurf.</td></tr>
<tr><td>Zurück</td><td>Landet an Deck, tankt und munitioniert auf.</td></tr>
<tr><td>Radar</td><td>Im Transit sucht der Hubschrauber mit Radar: Ein Schnorchel fällt ihm bis 15 km auf, ein Sehrohr bis 6 km. Jeder Fund geht als Position mit etwa 1 km Fehler an alle Eskorten. Beim Schweben und auf dem MAD-Muster ist sein Radar aus.</td></tr>
<tr><td>Seefernaufklärer</td><td>Auf Anforderung (Rechtsklick „Seefernaufklärer: Bojensperre hier“): legt eine Kette von 6 Bojen quer zur Peilung, danach 30 Minuten Bereitschaft. Sein Radar findet Schnorchel bis 30 km, Sehrohre bis 9 km.</td></tr>
</table>
<h2>Angriff</h2>
<ol>
<li>Kontakt mit Entfernung festmachen: Aktivsonar, Kreuzpeilung zweier Schiffe, Boje, Tauchsonar oder Radarfix aus der Luft.</li>
<li>Rakete auf die Position (Rechtsklick „U-Jagd-Rakete hierher“ oder „Rakete auf Ziel“, Taste <kbd>R</kbd>), von 1,8 bis 18 km. Der Leichttorpedo fällt mit einer Streuung von etwa 150 m um den Zielpunkt ins Wasser und sucht abwechselnd knapp über der gemessenen Schicht und 40 m darunter. Täuschkörper können ihn verbrauchen, Wirbelfelder durchschaut er.</li>
<li>Torpedorohre: Fregatten haben sechs Rohre mit Leichttorpedos, alle geladen; Nachladen aus dem Magazin dauert 15 Minuten.</li>
<li>Nah dran (unter der Mindestentfernung der Rakete): Der <b>Wasserbombenwerfer</b> wirft eine Salve von sechs Ladungen 400–800 m voraus auf den eigenen Kurs; sie sinken auf die eingestellte Tiefe (50–200 m). Tödlich im Umkreis von 20 m, Schaden bis 60 m. Die Detonationen hören alle.</li>
<li>Torpedowarnung: Täuschkörper-Schleppe (Taste <kbd>T</kbd>) ausbringen, abdrehen, Fahrt aufnehmen. Die Schleppe kostet: 12 dB Eigenrauschen im Schleppsonar, 5 dB im Rumpfsonar, und mehr als 25 kn sind mit ihr nicht drin.</li>
</ol>
<h2>Minenabwehr</h2>
<p>Das aktive Rumpfsonar findet verankerte Minen voraus bis etwa 1 km (Grundminen 0,6 km). Das <b>Minenmeidesonar</b> (Sonar, Reiter „VDS/BT“, „Minenmeiden“)
reicht 1,6 km in ±70° voraus, auch ohne Aktivsonar und kaum weit zu hören – aber nur bis 15 kn. Sein Suchsektor steht im Lagebild.
Gefundene Minen gehen über den Datalink an alle Geleitschiffe; der Konvoi weicht ihnen mit 400 m Abstand aus.
Liegt eine ganze Sperre vor dem Konvoi, versetzt <b>„Konvoi umleiten“</b> (OPZ, Reiter „Verband“) seinen Kurs um 1,5 oder 3 km zur Seite; „Route“ führt ihn zurück.</p>
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
