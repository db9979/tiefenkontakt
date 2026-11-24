/** Handbook chapters 9–12: missions, environment and incidents, tactics, keys and glossary. */

const MISSIONS: [string, string, string][] = [
  ['Grönland-Lücke', 'Tiefes Wasser, Konvergenzzonen, ausgeprägte Sprungschicht. Quer zur Route liegt eine flache Bank (150–250 m) im Wartegebiet der U-Boote.', 'Schicht nutzen; Schleppsonare hören sehr weit. Minen gehen nur auf der Bank.'],
  ['Schelfmeer', 'Flach (110–270 m), schwache Schicht, viel Nachhall, wenig Tauchtiefe.', 'Eskorte: LFM-Puls und aktive Bojen. U-Boot: nah am Grund und im Lärm der Frachter.'],
  ['Fjordausfahrt', 'Enger Kanal zwischen Untiefen; wer ihn verlässt, läuft auf.', 'Der Konvoi ist berechenbar – die U-Boote auch: Die Rinne zwingt beide auf wenige Wege.'],
  ['Hafenangriff', 'Frachter ankern in einer Bucht, die Eskorte bewacht die Einfahrt.', 'Langsam an der Einfahrt horchen; Schüsse auf ankernde Ziele brauchen keine TMA.'],
  ['U-Boot-Duell', 'U-Boote gegen U-Boote, kein Konvoi.', 'Wer zuerst hört, gewinnt: sehr langsam, Schleppsonar, aktive Torpedos.'],
  ['Fühlung halten', 'Waffen gesperrt: 25 Minuten Kontakt zum Konvoi aus höchstens 12 km.', 'Die Eskorte muss das Boot abdrängen, nicht versenken.'],
  ['Meerengen-Durchbruch', 'Die U-Boote müssen durch eine bewachte Enge (Gibraltar: nach Osten ins Mittelmeer).', 'Tief und langsam durch das tiefste Wasser; die Eskorte legt Bojensperren.'],
  ['Aufklärung', 'Ein Geleitschiff im Sehrohr erkennen und per Funk melden.', 'Ein kurzer Blick auf unter 4 km, dann senden – und sofort weg.'],
  ['Eigene Mission', 'Konvoigröße, Fahrt, Meeresboden und Abstand frei wählbar.', 'Zum Üben einzelner Lagen.'],
];

export const chapterMissions = `
<h1 id="k9">9 · Missionen</h1>
<table class="grid">
<tr><th>Mission</th><th>Lage</th><th>Hinweis</th></tr>
${MISSIONS.map(([a, b, c]) => `<tr><td><b>${a}</b></td><td>${b}</td><td>${c}</td></tr>`).join('\n')}
</table>
<h2>Einstellungen der Partie</h2>
<table class="grid">
<tr><td>Tageszeit</td><td>Tag, Dämmerung oder Nacht; die Uhr läuft mit. Nachts sieht man nur beleuchtete Schiffe und Mündungsfeuer weit.</td></tr>
<tr><td>Seegang</td><td>Mehr Seegang heißt mehr Störpegel, mehr Seegangsechos im Radar und schwerere Sicht im Sehrohr.</td></tr>
<tr><td>Sprungschicht</td><td>Tiefe und Stärke der Schicht; im Flachwasser schwächer.</td></tr>
<tr><td>KI-Stärke</td><td>Bestimmt, wie schnell und genau KI-Kommandanten lösen, schießen und melden. Jeder KI-Kommandant hat einen Charakter (draufgängerisch, schlauer Fuchs, vorsichtig, verbissener Jäger); die Aufklärung im Briefing deutet ihn manchmal an.</td></tr>
</table>
`;

export const chapterWorld = `
<h1 id="k10">10 · Umwelt und Zwischenfälle</h1>
<h2>Neutraler Verkehr</h2>
<p>In jeder Mission fahren neutrale Schiffe durch das Gebiet: im offenen Ozean vor allem Tanker und Containerschiffe, im Schelf
Fischer, Fähren und Schlepper, in Fjorden auch Yachten. Sie halten ihren eigenen Kurs, meiden Untiefen, fahren immer mit Lichtern
und werden ersetzt, wenn sie das Gebiet verlassen. Sie sind laut, verdecken leisere Kontakte in derselben Peilung und sind
<b>nie</b> ein Ziel. Typen und Erkennungsmerkmale stehen in der Einheitenreferenz.</p>
<h2>Zwischenfälle</h2>
<p>Alle 15 bis 30 Minuten passiert etwas, für beide Seiten gleich:</p>
<table class="grid">
<tr><th>Zwischenfall</th><th>Wirkung</th></tr>
<tr><td>Treibnetz</td><td>Reißt Schleppsonare ab (Ersatz nach 15 Minuten) und verfängt flach fahrende Boote für 20 Sekunden – laut.</td></tr>
<tr><td>Wetterfront</td><td>Angekündigt 20 Minuten vorher: Seegang steigt um zwei Stufen, Regen.</td></tr>
<tr><td>Weiteres Schiff</td><td>Ein zusätzliches neutrales Schiff kreuzt das Gebiet.</td></tr>
<tr><td>Meeresleben</td><td>Wale, Delfine oder eine Knallkrebsbank – je nach Wassertiefe. Siehe Biologische Kontakte.</td></tr>
<tr><td>Ruderversager</td><td>Das Ruder klemmt eine Minute.</td></tr>
<tr><td>Schnorchelventil</td><td>Klemmt: Der Schnorchel bleibt 45 Sekunden oben.</td></tr>
<tr><td>Batteriegas</td><td>Fünf Minuten weiter schnorcheln und lüften, sonst verpufft das Gas und beschädigt den Antrieb.</td></tr>
</table>
<h2>Strömung</h2>
<p>Eine Meeresströmung versetzt alle Bojen. Eine Boje, die vor 20 Minuten gesetzt wurde, liegt nicht mehr dort, wo sie abgeworfen wurde – die Karte zeigt ihre aktuelle Position.</p>
<h2>Schäden</h2>
<p>Treffer beschädigen Antrieb, Sonar, Waffen und verursachen Wassereinbruch. Im Reiter „Schaden“ legt ein Klick die Reparatur-Priorität fest.
Verwundete senken die Leistung, Sanitäter versorgen sie.</p>
`;

export const chapterTactics = `
<h1 id="k11">11 · Taktik</h1>
<div class="cols2">
<div class="box"><h4>Für U-Boote</h4><ol>
<li>Vor den Konvoi setzen, nicht hinterherlaufen: Er kommt zu dir.</li>
<li>Unter 6 kn bleiben, solange nicht geschossen wird. Kavitation verrät dich auf viele Kilometer.</li>
<li>Die Sprungschicht ist dein Mantel. Horchen darüber, verstecken darunter.</li>
<li>Funken nur, wenn es sich lohnt: Jede Meldung ist eine Funkpeilung für die Eskorte.</li>
<li>Nach dem Schuss sofort weg: Transienten haben dich verraten.</li>
<li>Im Lärm der Frachter bist du für die Eskorte fast unsichtbar.</li>
<li>Gegen pingende Eskorten: Heck zeigen, langsam, Schicht wechseln.</li>
</ol></div>
<div class="box"><h4>Für die Eskorte</h4><ol>
<li>Zuerst die Schicht messen (BT), dann das Schleppsonar auf die passende Länge.</li>
<li>Passiv suchen, aktiv bestätigen. Wer ständig pingt, warnt jedes U-Boot.</li>
<li>Kreuzpeilungen mit dem zweiten Schiff liefern Entfernungen ohne Ping.</li>
<li>Funkpeilungen sofort mit Hubschrauber oder Bojen nachgehen.</li>
<li>Im Flachwasser: LFM-Puls, aktive Bojen, VDS. Der Nachhall frisst CW-Echos.</li>
<li>Unter dem eigenen Kiel bist du blind – ein Boot, das nah und tief steht, braucht Hubschrauber oder VDS.</li>
<li>Den Konvoi bei Gefahr abdrehen und verdunkeln lassen.</li>
</ol></div>
</div>
`;

const KEYS: [string, string][] = [
  ['1 … 5', 'Stationen'], ['← →', 'Kurs 5° (mit ⇧ 1°)'], ['↑ ↓', 'Fahrt ± 1 kn'], ['Bild ↑ / Bild ↓', 'Tiefe ∓ 10 m'],
  ['A / D', 'Sehrohr drehen'], ['V (halten)', 'Sprechfunk senden'], ['H', 'Hilfe'], ['M', 'Ton an/aus'], ['Esc', 'Menüs und Fenster schließen'],
];

const GLOSSARY: [string, string][] = [
  ['AIP', 'Außenluftunabhängiger Antrieb: lässt ein konventionelles U-Boot langsam ohne Batterieverbrauch fahren.'],
  ['BT', 'Bathythermograph: Sonde, die das Temperaturprofil und damit die Sprungschicht misst.'],
  ['CW / LFM', 'Pulsarten des Aktivsonars: Dauerton (misst Doppler) und frequenzmodulierter Puls (genau, gut im Nachhall).'],
  ['DEMON', 'Analyse der Modulation des Schraubengeräuschs: ergibt Wellen- und Blattfrequenz.'],
  ['DICASS', 'Aktive Sonarboje, die selbst pingt.'],
  ['DIFAR', 'Passive Richtungsboje: liefert Peilungen von ihrem Ort aus.'],
  ['ESM', 'Funk- und Radarpeilung: hört gegnerische Sender.'],
  ['Kavitation', 'Dampfblasen an der Schraube bei hoher Fahrt: plötzlich sehr laut; setzt in der Tiefe später ein.'],
  ['Knuckle', 'Wirbelfeld nach einer harten Wende bei Fahrt: schluckt Schall und lenkt Suchköpfe kurz ab.'],
  ['Konvergenzzone', 'Bereich in etwa 55 km Entfernung, in dem Schall in tiefem Wasser wieder an die Oberfläche kommt.'],
  ['LOFAR', 'Schmalband-Spektrum: zeigt Linien von Maschinen, Generatoren und Getrieben.'],
  ['MAD', 'Magnetanomalie-Detektor: findet ein getauchtes Boot nur direkt darunter.'],
  ['Schenkel', 'Ein gerades Stück eigener Kurs während der TMA.'],
  ['SE', 'Signalüberschuss: über 0 dB ist ein Kontakt da.'],
  ['Sprechtaste', 'Taste zum Senden im Sprechfunk; nur solange sie gedrückt ist, geht die Stimme hinaus.'],
  ['TMA', 'Zielbewegungsanalyse: Kurs, Fahrt und Entfernung aus einer Folge von Peilungen.'],
  ['Toter Winkel', 'Sektor achtern, in dem das Rumpfsonar die eigene Schraube hört.'],
  ['VDS', 'Tiefensonar an einem Kabel: hört unter der Sprungschicht.'],
  ['VLF', 'Längstwellenfunk der Führung, bis etwa 25 m Tiefe zu empfangen.'],
];

export const chapterReference = `
<h1 id="k12">12 · Tastatur und Glossar</h1>
<p>Die Maus ist das Hauptwerkzeug; die Tasten sind Abkürzungen und lassen sich in der Hilfe (H) frei belegen.</p>
<table class="grid keys">${KEYS.map(([k, v]) => `<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`).join('')}</table>
<h2>Glossar</h2>
<table class="grid gloss">${GLOSSARY.map(([k, v]) => `<tr><td><b>${k}</b></td><td>${v}</td></tr>`).join('')}</table>
`;
