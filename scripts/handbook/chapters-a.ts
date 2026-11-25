import { figBaffles, figConvoy, figCz, figLayer, figNato, figSonarEq, figTowed } from './figures.js';

/** Handbook chapters 1–4: the game, getting started, the sea and its sound, symbols. */

const fig = (svg: string, cap: string) => `<figure>${svg}<figcaption>${cap}</figcaption></figure>`;
const shot = (file: string, cap: string) => `<figure class="ui"><img src="img/${file}" alt=""><figcaption>${cap}</figcaption></figure>`;

export const chapterIntro = `
<h1 id="k1">1 · Das Spiel</h1>
<p class="lead">Tiefenkontakt ist eine U-Boot-Jagd im Stil des Kalten Kriegs für 2 bis 12 Spieler im Browser. Zwei Teams kämpfen um einen Konvoi:
Das <b>Ostpakt-Wolfsrudel</b> will Tonnage versenken, der <b>Westbund-Geleitschutz</b> will den Konvoi ins Ziel bringen. Alle Nationen,
Schiffsklassen und Namen sind erfunden.</p>
<p>Jeder Spieler führt ein Schiff, allein oder als Besatzung mit Freunden. Fehlende Plätze übernimmt die KI, man kann also auch allein spielen.
Die Simulation ist bewusst nüchtern: Man sieht den Gegner fast nie. Man hört ihn, peilt ihn, schätzt seine Bahn und schießt auf eine Lösung.</p>
<p><b>Gemischte Teams:</b> Jede Seite darf einen gemischten Platz besetzen. Der Westbund schickt ein Jagd-U-Boot (S-14) vor den
Konvoi, der Ostpakt ein Wachschiff (Projekt 11) mit Seezielflugkörpern mit dem Rudel. Um eigene U-Boote liegt ein mitwanderndes Sperrgebiet von 4 km, in das
die eigene Seite keine U-Jagd-Waffe wirft; außerhalb ist jedes unbekannte U-Boot ein Ziel. Freund oder Feind zu erkennen ist damit Pflicht.</p>
<div class="cols2">
<div class="box"><h4>Sieg für die U-Boote</h4><ul><li>Die Hälfte der Konvoi-Tonnage versenkt, oder</li><li>bei Zeitablauf mindestens 30 % versenkt.</li></ul><p>Frachter, die das Wachschiff mit Seezielflugkörpern versenkt, zählen nur zur Hälfte: Der Konvoi ist Sache der U-Boote. Die Anzeige zeigt dann „ZÄHLT …&nbsp;%“.</p></div>
<div class="box"><h4>Sieg für den Geleitschutz</h4><ul><li>Mehr als die Hälfte der Tonnage im Zielhafen, oder</li><li>alle U-Boote versenkt, oder</li><li>bei Zeitablauf weniger als 30 % Verlust.</li></ul></div>
</div>
<p>Die Zeit läuft dreifach gerafft: Eine Stunde Simulationszeit dauert 20 Minuten. Alle Uhren im Spiel zeigen Simulationszeit.
Eine Partie dauert je nach Mission 30 bis 60 Minuten.</p>
${fig(figConvoy(), 'Abb. 1 · Konvoi mit Sicherung. Gefährlich ist der Bereich vorn und seitlich, auf den der Konvoi zuläuft.')}
`;

export const chapterStart = `
<h1 id="k2">2 · Erste Schritte</h1>
<h2>Konto, Gast und Lobby</h2>
<ol>
<li><b>Anmelden</b> mit Rufzeichen und Passwort oder als Gast. Mit Konto werden Rang, Statistik und Karriere gespeichert.</li>
<li><b>Lobby:</b> eine Partie eröffnen oder beitreten. Der Gastgeber wählt Mission, Tageszeit, Seegang, Sprungschicht, Einsatzdauer und KI-Stärke. Der <b>Zeitraffer</b> (3×, 2× oder Echtzeit) ändert nur die echte Spieldauer: Die Lage auf See bleibt gleich, eine Einsatzdauer von 120 Minuten Seezeit dauert bei 3× 40 Minuten, in Echtzeit 120. Die Uhr zeigt die Seezeit und dahinter die echte Restzeit.</li>
<li><b>Team und Klasse</b> wählen. Beim Teamkameraden „Mitfahren“ macht euch zur gemeinsamen Besatzung eines Schiffs, jeder an einer Station.</li>
<li><b>Bereit</b> melden. Leere Plätze besetzt die KI.</li>
<li>Vor dem Auslaufen erscheint die <b>Einsatzbesprechung</b> mit Auftrag, Lagebild, Aufklärung über den gegnerischen Kommandanten und den ersten Schritten.</li>
</ol>
${shot('ui-lobby.jpg', 'Bild 1 · Lobby: Teams, Klassenwahl und Missionen mit Kartenvorschau.')}
${shot('ui-briefing.jpg', 'Bild 2 · Einsatzbesprechung vor dem Auslaufen.')}
<h2>Sprechfunk</h2>
<p>Im Reiter <b>Funk</b> schaltet „Sprechfunk an“ das Mikrofon frei (der Browser fragt einmal). Gesprochen wird nur, solange
<b>Sprechen</b> gedrückt ist – mit der Maus, dem Finger oder der Taste <kbd>V</kbd>. Die Liste zeigt jeden Teamkameraden im
Sprechfunk mit Verbindungsgüte; ein grüner Punkt heißt: er spricht gerade.</p>
<table class="grid">
<tr><td>Fregatten und Korvetten</td><td>Immer auf Sendung. Reichweite bis zum Horizont der Antennen (Fregatte zu Fregatte gut 40 km); zum Rand hin rauscht es.</td></tr>
<tr><td>Verbindungsgüte</td><td>Zum Rand der Reichweite rauscht es stärker, die Stimme wird leiser und dünner und schwankt; unter etwa 35 % Güte reißt sie immer wieder kurz ab. Regen kostet 15 % Reichweite, Seegang ab 5 je Stufe 5 %, und ab Seegang 4 überspülen die Wellen den Funkmast eines U-Boots (je Stufe 8 %).</td></tr>
<tr><td>U-Boote</td><td>Nur aufgetaucht oder auf Sehrohrtiefe mit ausgefahrenem Funkmast. Getaucht kein Sprechfunk (Längstwelle und Schleppantenne tragen keine Sprache).</td></tr>
<tr><td>Gleiches Schiff</td><td>Bordsprechanlage: immer, auch getaucht, ohne Rauschen und ohne Abstrahlung.</td></tr>
<tr><td>Risiko</td><td>Jede Sendung über Funk gibt dem Gegner eine Funkpeilung, bei langem Sprechen alle paar Sekunden eine neue. Kurz fassen!</td></tr>
</table>
<h2>Lektionen</h2>
<p>Für den Einstieg führt <b>„Erste Feindfahrt“</b> (Lobby, Ausbildung) durch einen ganzen Angriff auf einen einzelnen Frachter: Tiefe, Schleichfahrt, Horchen, Schenkel für die TMA, Sehrohr, Schuss, Drahtlenkung und Ablaufen – jeder Schritt mit Haken, „Weiter“ überspringt.</p>
<p>Das Gegenstück für die Fregatte ist <b>„Erste Geleitfahrt“</b>: drei Frachter folgen der Fregatte, voraus läuft ein einzelnes Diesel-U-Boot tief und auf festem Kurs an. Die Lektion führt durch Fahrt verringern, Schleppsonar auf 900 m ausbringen und einschwingen lassen, Sonarboje vor den Konvoi werfen, den leisen Kontakt finden und als U-Boot klassifizieren, den Konvoi umleiten, mit kurzem LFM-Ping die Entfernung holen und die U-Jagd-Rakete schießen. Geschafft ist sie, wenn das U-Boot getroffen ist.</p>
<p>Die geführten Lektionen bringen jede Station Schritt für Schritt bei: Horchen, Peilen, TMA, Torpedoangriff, Schleppsonar, Hubschrauber und Ausweichen.
Ein gelber Hinweis zeigt immer den nächsten sinnvollen Schritt. Die Stufe „Einsteiger“ beschriftet Linien und bietet Auto-Marken und Auto-TMA,
„Profi“ verzichtet darauf.</p>
<h2>Der Bildschirm</h2>
<table class="grid">
<tr><th>Bereich</th><th>Inhalt</th></tr>
<tr><td>Obere Leiste</td><td>Stationen (Tasten 1–5), Schiff, Tonnage-Balken (rot versenkt, blau entkommen, Strich bei 50 %), Uhrzeit, Seegang, Restzeit, Ton, Einstellungen, Hilfe.</td></tr>
<tr><td>Mitte</td><td>Die gewählte Station: Sonar, Sehrohr, Feuerleitung, Tauchstand bzw. Operationszentrale, Sonar, Waffen, Radar, Brücke.</td></tr>
<tr><td>Rechts oben</td><td>Ruderstand: Kompass (Klick setzt den Kurs), Fahrstufen, Tiefe, Sehrohr bzw. Mast. Immer sichtbar.</td></tr>
<tr><td>Rechts unten</td><td>Reiter <b>Meldungen · Boot · Schaden · Funk</b>. Ein roter Punkt zeigt Neues in einem anderen Reiter.</td></tr>
</table>
<h2>Bedienung mit der Maus</h2>
<table class="grid">
<tr><td>Karte</td><td>Ziehen verschiebt, Rad zoomt, Linksklick wählt einen Kontakt. <b>Rechtsklick</b> öffnet Aktionen: Kurs hierher, Torpedo hierher, Rakete, Boje, Hubschrauber, TMA.</td></tr>
<tr><td>Kompass</td><td>Klicken oder ziehen setzt den Kurs. Gelb = befohlen, blau = aktuell.</td></tr>
<tr><td>Wasserfall, Radar</td><td>Klick auf eine Spur oder ein Echo wählt den Kontakt.</td></tr>
<tr><td>Listen</td><td>Spaltenköpfe sortieren, Filterchips grenzen ein (aktuell, ohne eigene, Sonar, ESM, Optik).</td></tr>
</table>
`;

export const chapterSea = `
<h1 id="k3">3 · Das Meer und der Schall</h1>
<p class="lead">Unter Wasser ist Schall das einzige Sinnesorgan auf Entfernung. Wer das Meer versteht, gewinnt.</p>
<h2>Die Sonargleichung</h2>
<p>Ein Kontakt entsteht, wenn der <b>Signalüberschuss</b> (SE) über null liegt. Er ergibt sich aus Quellpegel minus Ausbreitungsverlust
minus Störpegel (abzüglich der Bündelung der Antenne) minus Erkennungsschwelle. Jeder Faktor ist im Spiel nachgebildet.</p>
${fig(figSonarEq(), 'Abb. 2 · Sonargleichung als Pegeltreppe.')}
<table class="grid">
<tr><th>Faktor</th><th>Was ihn erhöht (schlecht für den Gehörten)</th><th>Was ihn senkt</th></tr>
<tr><td>Quellpegel SL</td><td>Fahrt (stark), Kavitation, Schnorcheln, Notanblasen, Rohrfluten, Gefechtslärm</td><td>Schleichfahrt, „Ruhe im Boot“ (−3 dB), Tiefe (Kavitation setzt später ein)</td></tr>
<tr><td>Ausbreitung TL</td><td>Sprungschicht zwischen den Partnern, Flachwasser mit Bodenverlust, Entfernung</td><td>Oberflächenkanal, Konvergenzzone, gleiche Seite der Schicht</td></tr>
<tr><td>Störpegel NL</td><td>Seegang, Regen, Verkehr, eigene Fahrt, Lärm anderer Schiffe in derselben Peilung</td><td>Ruhige See, langsame eigene Fahrt</td></tr>
</table>
<h2>Sprungschicht und Oberflächenkanal</h2>
<p>Unter der warmen Deckschicht fällt die Temperatur plötzlich ab. Diese <b>Sprungschicht</b> knickt Schallstrahlen ab: Wer auf der anderen Seite ist,
wird 10–15 dB leiser gehört. Über der Schicht bildet sich ein <b>Oberflächenkanal</b>, der Schall weit trägt. Die Schichttiefe ist unbekannt, bis sie gemessen ist:
Die Fregatte wirft eine BT-Sonde, das U-Boot bemerkt sie beim Durchtauchen. Auf kurze Entfernung (unter 2 km) wirkt die Schicht nur teilweise.</p>
${fig(figLayer(), 'Abb. 3 · Schallausbreitung an der Sprungschicht.')}
<h2>Konvergenzzonen</h2>
<p>In tiefem Wasser biegen sich Strahlen in großer Tiefe wieder nach oben und kommen in etwa 55 km Entfernung an die Oberfläche zurück.
Dort hört man laute Schiffe plötzlich wieder, dazwischen ist Stille.</p>
${fig(figCz(), 'Abb. 4 · Konvergenzzonen in der Grönland-Lücke.')}
<h2>Reichweitenvorhersage</h2>
<p>Im Horchraum des Boots und am Sonar der Fregatte zeigt die aufklappbare <b>Reichweitenvorhersage</b> einen Schnitt durch die See: nach rechts die Entfernung,
nach unten die Tiefe. <b>Grün</b> ist, wo man ein typisches Ziel hört (Boot: Geleitfahrzeug mit 15 kn, blass ein Frachter mit 9 kn; Fregatte: Diesel-U-Boot mit 5 kn
auf Batterie), <b>rot schraffiert</b>, wo der Gegner einen selbst hört. Beim Boot ist die Tiefe die eigene: Man sieht, wie es unter der Schicht stiller wird.
Bei der Fregatte ist es die Tiefe des Boots. Die Vorhersage rechnet mit eigener Fahrt, Seegang, Wassertiefe und der gemessenen Schicht. Ohne Messung steht
dort <b>SCHICHT UNBEKANNT · NUR GROBE SCHÄTZUNG</b>. Schwund, Maskierung und Gelände rechnet sie nicht mit.</p>
<h2>Flachwasser</h2>
<p>Im Schelfmeer und im Fjord ist das Wasser 100–300 m tief. Der Boden schluckt Schall mit jeder Reflexion, die Schicht ist schwach und
<b>Nachhall</b> (Echos von Boden und Oberfläche) überdeckt das Aktivsonar. Ein CW-Puls findet dort langsame Ziele kaum, ein <b>LFM-Puls</b>
mit Pulskompression schon. Ein schnelles Ziel hebt sich durch seinen Doppler auch beim CW-Puls vom Nachhall ab.</p>
<h2>Maskierung</h2>
<p>Ein lautes Schiff überdeckt leisere Kontakte in fast derselben Peilung (Rumpfsonar etwa ± 8°, Schleppsonar ± 5°).
U-Boote nutzen das: Wer sich nah unter einen Frachter setzt, verschwindet in dessen Lärm.</p>
<h2>Toter Winkel und blinder Fleck</h2>
<p>Hinter jedem Schiff liegt ein toter Winkel von etwa ± 30°, in dem das Rumpfsonar die eigene Schraube hört.
Zusätzlich sieht kein Rumpfsonar steil nach unten: Ein Ziel mehr als 30° unter dem Schiff, also tief und nah, ist unsichtbar.
Das Schleppsonar hört achtern, kann aber links und rechts nicht unterscheiden.</p>
${fig(figBaffles(), 'Abb. 5 · Toter Winkel achtern und blinder Fleck unter dem Rumpf.')}
${fig(figTowed(), 'Abb. 6 · Mehrdeutigkeit des Schleppsonars.')}
<h2>Abstrahlung</h2>
<p>Schiffe sind von achtern am lautesten (Schraube) und von vorn am leisesten. Querab werfen sie das stärkste Aktiv-Echo zurück, von vorn das schwächste.
Darum zeigt ein U-Boot einem pingenden Gegner das Heck und meidet die Breitseite.</p>
`;

export const chapterSymbols = `
<h1 id="k4">4 · Lagebild und Symbole</h1>
<p>Die Karte zeigt Kontakte mit Symbolen nach NATO-Art. Die Form steht für die Zugehörigkeit (eigen, feindlich, unbekannt), die volle Form für Überwasser, die untere Hälfte für U-Boot.
Ein Kontakt wird erst „feindlich“, wenn du ihn klassifiziert hast; vorher ist er unbekannt.</p>
${fig(figNato(), 'Abb. 7 · Kartensymbole.')}
<table class="grid">
<tr><th>Element</th><th>Bedeutung</th></tr>
<tr><td>Peillinie</td><td>Passive Peilung ohne Entfernung. Gestrichelt rot: Funkpeilung (ESM) eines sendenden U-Boots.</td></tr>
<tr><td>Gelber Lösungskreis</td><td>Die TMA-Lösung: Position mit Kurs- und Fahrtvektor. Ziehen verschiebt die Entfernung, die Vektorspitze ändert Kurs und Fahrt.</td></tr>
<tr><td>Ellipse</td><td>Unsicherheit einer Lösung oder Kreuzpeilung.</td></tr>
<tr><td>Kreuz mit Kreis</td><td>Sonarboje; mit zweitem Ring und „A“ eine aktive Boje (DICASS). „T“ = tief unter der Schicht.</td></tr>
<tr><td>Kreuz</td><td>Hubschrauber; gestrichelter Kreis: Reichweite des Tauchsonars beim Schweben.</td></tr>
<tr><td>Luftsymbol</td><td>Obere Rahmenhälfte (Bogen eigen, Winkel feindlich, offenes Rechteck neutral) mit Typ, Höhe und Fahrtstrich. Ein gestrichelter Strahl mit ✈ ist ein Flugzeugradar, das nur im ESM gehört wird.</td></tr>
<tr><td>Kartenfärbung</td><td>Land, Untiefen, Schelf und tiefes Wasser aus der Seekarte. Wer die Fahrrinne im Fjord verlässt, läuft auf.</td></tr>
</table>
<p>Peilungen werden geglättet angezeigt, damit Symbole ruhig stehen. Die Rohwerte rauschen, je schwächer das Signal, desto mehr.</p>
`;
