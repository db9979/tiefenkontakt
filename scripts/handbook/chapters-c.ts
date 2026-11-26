/** Handbook chapters 9–12: missions, environment and incidents, tactics, keys and glossary. */

const MISSIONS: [string, string, string][] = [
  ['Grönland-Lücke', 'Tiefes Wasser, Konvergenzzonen, ausgeprägte Sprungschicht. Quer zur Route liegt eine flache Bank (150–250 m) im Wartegebiet der U-Boote.', 'Schicht nutzen; Schleppsonare hören sehr weit. Minen gehen nur auf der Bank.'],
  ['Schelfmeer', 'Flach (110–270 m), schwache Schicht, viel Nachhall, wenig Tauchtiefe.', 'Eskorte: LFM-Puls und aktive Bojen. U-Boot: nah am Grund und im Lärm der Frachter.'],
  ['Fjordausfahrt', 'Enger Kanal zwischen Untiefen; wer ihn verlässt, läuft auf.', 'Der Konvoi ist berechenbar – die U-Boote auch: Die Rinne zwingt beide auf wenige Wege.'],
  ['Hafenangriff', 'Frachter ankern in einer Bucht, die Eskorte bewacht die Einfahrt.', 'Langsam an der Einfahrt horchen; Schüsse auf ankernde Ziele brauchen keine TMA.'],
  ['U-Boot-Duell', 'U-Boote gegen U-Boote, kein Konvoi.', 'Wer zuerst hört, gewinnt: sehr langsam, Schleppsonar, aktive Torpedos.'],
  ['Fühlung halten', 'Waffen gesperrt: 25 Minuten Kontakt zum Konvoi aus höchstens 12 km (in einer kurzen Partie höchstens die Hälfte der Seezeit).', 'Die Eskorte muss das Boot abdrängen, nicht versenken.'],
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
<tr><td>Einsatzdauer</td><td>20, 30, 40 oder 60 echte Minuten (voreingestellt 40). Die Aufstellung richtet sich nach der Seezeit.</td></tr>
<tr><td>Zeitraffer</td><td>Unter „Erweitert“: Echtzeit, 2× oder 3×. Die echte Dauer bleibt, auf See vergeht mehr Zeit und der Konvoi kommt weiter.</td></tr>
<tr><td>Tageszeit</td><td>Tag, Dämmerung oder Nacht; die Uhr läuft mit. Nachts sieht man nur beleuchtete Schiffe und Mündungsfeuer weit; wie dunkel die Nacht ist, bestimmt der Mond (Kapitel 10).</td></tr>
<tr><td>Seegang</td><td>Mehr Seegang heißt mehr Störpegel, mehr Seegangsechos im Radar und schwerere Sicht im Sehrohr; ab Seegang 5 kein Hubschrauberstart (Kapitel 10).</td></tr>
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
<h2>Schwere See</h2>
<p>Seegang trifft beide Seiten, aber verschieden:</p>
<table class="grid">
<tr><th>Ab Seegang</th><th>U-Boot</th><th>Geleit</th></tr>
<tr><td>4</td><td>Wellen überspülen das Sehrohr (Seegang 4: 15 % der Blicke verloren, 6: 45 %); das Kopfventil des Schnorchels kann zuschlagen (Diesel aus, 20–40 s keine Ladung); je Stufe über 3 lädt der Schnorchel 12 % langsamer.</td><td>Das Radar verliert Sehrohre in den Schaumkronen, Schnorchel etwas weniger; in Gegensee verlieren Geleitschiffe je Stufe über 3 Fahrt (Fregatte 8 %, Korvette 12 % der Höchstfahrt).</td></tr>
<tr><td>5</td><td>Auf Sehrohrtiefe zieht die See das Boot nach oben; ein langsames Boot kann <b>durchbrechen</b> und zeigt den Turm (Radar, Ausguck). Mit 4 kn und mehr greifen die Tiefenruder besser.</td><td>Das Bugsonar leidet (−3 dB, Seegang 6 −8 dB, gelegentliche Aussetzer); Schleppsonar und VDS nicht. Kein Hubschrauberstart, Landung dauert doppelt so lange.</td></tr>
</table>
<h2>Nacht, Mond und Meeresleuchten</h2>
<p>Mond, Phase und Stand werden für Seegebiet, Datum und Bordzeit berechnet; die <b>MOND</b>-Zeile auf Brücke und Sehrohr und die Lagebesprechung
nennen ihn. Neumond hilft dem U-Boot, Vollmond dem Geleit: Ein hoher voller Mond gibt dem Ausguck und dem Sehrohr einen guten Teil der Tagessicht
zurück, eine mondlose oder bewölkte Nacht nimmt noch etwas mehr. Abgeblendete Flugzeuge sieht man nur im Mondlicht.</p>
<p><b>Meeresleuchten</b> gibt es je nach Seegebiet und Jahreszeit: kräftig in warmem und gemäßigtem Wasser vom späten Frühjahr bis in den Herbst
(Biskaya, Mittelmeer, im Spätsommer Nordsee und norwegische Küste), schwach in arktischem Wasser und im Winter; jede Partie hat ihre eigene Blüte.
Nur in dunkler Nacht leuchtet das aufgewühlte Wasser: eine Sehrohrfahne bis etwa 1,5 km, ein fahrendes Boot auf Sehrohrtiefe bis etwa 1 km,
eine Torpedobahn bis 1,8 km. Heller Mond und Schaumkronen löschen es aus. Die Brücke zeigt die erwartete Reichweite als „MEERESLEUCHTEN · BOOT (6 KN)“.</p>
<h2>Strömung</h2>
<p>Eine Meeresströmung versetzt alle Bojen. Eine Boje, die vor 20 Minuten gesetzt wurde, liegt nicht mehr dort, wo sie abgeworfen wurde – die Karte zeigt ihre aktuelle Position.</p>
<h2>Schäden</h2>
<p>Treffer beschädigen Antrieb, Sonar, Waffen und verursachen Wassereinbruch und Brände. Der Reiter <b>SCHADEN</b> (die Schadensabwehr) zeigt oben eine
Schnittzeichnung des eigenen Schiffs aus dem 3D-Modell, über und unter der Wasserlinie, mit den Abteilungen genau im Rumpf eingefärbt: Wasser, Brand,
Schaden und Schotten. Schlagseite, Trimm und Absinken folgen dem Wasser im Schiff. Darunter:</p>
<table class="grid">
<tr><td>Statuszeile</td><td>Schlagseite, Trimm, Wasser im Schiff in Prozent der Reserve (ab 100 % sinkt es) und brennende Abteilungen.</td></tr>
<tr><td>Abteilungen</td><td>Eine Zeile je Abteilung mit Wasser, Brand, Leck und Schaden; die Kennbuchstaben sagen, was darin sitzt (A Antrieb, S Sonar, W Waffen, B Batterie, M Magazin). Ein Klick wählt die Abteilung.</td></tr>
<tr><td>Befehle</td><td>Für die gewählte Abteilung: <b>Trupp hierher</b> (Lecks dichten, lenzen, Brand löschen, reparieren) oder <b>Abschotten</b> (hält das Wasser auf, sperrt aber auch den Trupp aus; „Schott öffnen“ lässt ihn wieder hinein).</td></tr>
<tr><td>Systeme</td><td>Balken für Antrieb (Höchstfahrt sinkt), Sonar (Eigenlärm steigt), Waffen (Nachladen dauert länger, ab 90 % Ausfall) und Wasser; ein Klick legt fest, was zuerst repariert wird.</td></tr>
</table>
<p>Verwundete senken die Leistung, Sanitäter versorgen sie.</p>
`;

export const chapterTactics = `
<h1 id="k11">11 · Taktik</h1>
<div class="cols2">
<div class="box"><h4>Für U-Boote</h4><ol>
<li>Vor den Konvoi setzen, nicht hinterherlaufen: Er kommt zu dir.</li>
<li>Unter 6 kn bleiben, solange nicht geschossen wird. Kavitation verrät dich auf viele Kilometer, und schnelle Fahrt leert die Batterie.</li>
<li>Sehrohr und Schnorchel kurz halten: Jedes Radar hat bei jeder Antennenumdrehung eine neue Chance, den Mast zu sehen.</li>
<li>Die Sprungschicht ist dein Mantel. Horchen darüber, verstecken darunter.</li>
<li>Funken nur, wenn es sich lohnt: Jede Meldung ist eine Funkpeilung für die Eskorte.</li>
<li>Nach dem Schuss sofort weg: Transienten haben dich verraten.</li>
<li>Im Lärm der Frachter bist du für die Eskorte fast unsichtbar.</li>
<li>Gegen pingende Eskorten: Heck zeigen, langsam, Schicht wechseln.</li>
<li>Schnell nur tief: Die Kavitation setzt in 150 m fast dreimal so spät ein wie auf Sehrohrtiefe.</li>
<li>Bis 80–90 % schnorcheln, nicht bis voll: Über 70 % lädt die Batterie immer langsamer.</li>
<li>Am Draht ruhig bleiben: höchstens 12 kn und 30° je Minute, den Torpedo nie achteraus.</li>
<li>Über tiefem Wasser die Schattenzone nutzen: Zwischen dem direkten Weg und der Konvergenzzone hört dich kaum jemand.</li>
</ol></div>
<div class="box"><h4>Für die Eskorte</h4><ol>
<li>Zuerst die Schicht messen (BT), dann das Schleppsonar auf die passende Länge.</li>
<li>Passiv suchen, aktiv bestätigen: ein Einzelping im passenden Bereich statt Dauerpingen. Wer ständig pingt, warnt jedes U-Boot.</li>
<li>Kreuzpeilungen mit dem zweiten Schiff liefern Entfernungen ohne Ping.</li>
<li>Funkpeilungen und Radarfixe aus der Luft sofort mit Hubschrauber oder Bojen nachgehen.</li>
<li>Im Flachwasser: LFM-Puls, aktive Bojen, VDS. Der Nachhall frisst CW-Echos.</li>
<li>Unter dem eigenen Kiel bist du blind – ein Boot, das nah und tief steht, braucht Hubschrauber oder VDS.</li>
<li>Den Konvoi bei Gefahr abdrehen und verdunkeln lassen; ein schärferer Zickzack-Plan stört die TMA der U-Boote.</li>
<li>Den Hubschrauber früh starten: Startvorbereitung und Flugkurs kosten drei Minuten, ab Seegang 6 startet er nicht.</li>
<li>Kielwassertorpedo im Wasser: Täuschkörper nützen nichts – hart wenden oder eine fremde Hecksee kreuzen.</li>
<li>Zwei Datalink-Spuren mit gleicher Bewegung sind oft dasselbe Boot.</li>
</ol></div>
</div>
`;

const KEYS: [string, string][] = [
  ['1 … 4 / 1 … 5', 'Stationen (U-Boot 1–4, Fregatte 1–5)'], ['← →', 'Kurs 5° (mit ⇧ 1°)'], ['↑ ↓', 'Fahrt ± 1 kn'], ['Bild ↑ / Bild ↓', 'Tiefe ∓ 10 m'],
  ['A / D · W / S', 'Sehrohr bzw. Fernglas drehen · heben und senken'], ['E · G', 'Vergrößerung wechseln · Stabilisierung'],
  ['T', 'Notfall: Täuschkörper (U-Boot) bzw. Täuschkörper-Schleppe (Fregatte)'], ['X', 'Notfall U-Boot: Alarmtauchen'], ['Q', 'Notfall U-Boot: Mast einfahren'],
  ['F', 'Notfall U-Boot: Feuer (zur Feuerleitung)'], ['P', 'Notfall Fregatte: Einzelping'], ['R', 'Notfall Fregatte: U-Jagd-Rakete (zu den Waffen)'], ['V (halten)', 'Sprechfunk senden'], ['H', 'Hilfe'], ['M', 'Ton an/aus'], ['Esc', 'Menüs und Fenster schließen'],
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
  ['Doppelspur', 'Dasselbe Ziel zweimal im Lagebild, weil zwei Meldungen über den Datalink nicht nah genug beieinanderlagen.'],
  ['Doppler', 'Verschiebung einer Linie nach oben (Ziel nähert sich) oder unten (entfernt sich).'],
  ['Flugkurs', 'Kurs, auf dem der Wind über Deck den Start oder die Landung des Hubschraubers erlaubt (höchstens 30° vom Bug).'],
  ['Kielwassertorpedo', 'Torpedo des Ostpakt-Atom-U-Boots, der der Hecksee eines Schiffs folgt; Täuschkörper wirken nicht.'],
  ['Konvergenzzone', 'Ring in 40–60 km Entfernung (je Seegebiet), in dem Schall über tiefem Wasser wieder an die Oberfläche kommt; der zweite liegt doppelt so weit.'],
  ['LOFAR', 'Schmalband-Spektrum: zeigt Linien von Maschinen, Generatoren und Getrieben.'],
  ['MAD', 'Magnetanomalie-Detektor: findet ein getauchtes Boot nur direkt darunter.'],
  ['Meeresleuchten', 'Leuchtendes Plankton: verrät in dunkler Nacht Sehrohrfahne, Kielwasser und Torpedobahn.'],
  ['Schenkel', 'Ein gerades Stück eigener Kurs während der TMA.'],
  ['Schattenzone', 'Bereich über tiefem Wasser zwischen dem Ende des direkten Wegs und der ersten Konvergenzzone; nur Bodenreflexion trägt hinein.'],
  ['SE', 'Signalüberschuss: über 0 dB ist ein Kontakt da.'],
  ['Sprechtaste', 'Taste zum Senden im Sprechfunk; nur solange sie gedrückt ist, geht die Stimme hinaus.'],
  ['TMA', 'Zielbewegungsanalyse: Kurs, Fahrt und Entfernung aus einer Folge von Peilungen.'],
  ['Toter Winkel', 'Sektor achtern, in dem das Rumpfsonar die eigene Schraube hört.'],
  ['VDS', 'Tiefensonar an einem Kabel: hört unter der Sprungschicht.'],
  ['VLF', 'Längstwellenfunk der Führung, bis etwa 25 m Tiefe zu empfangen.'],
];

export const chapterReference = `
<h1 id="k12">12 · Tastatur und Glossar</h1>
<p>Die Maus ist das Hauptwerkzeug; die Tasten sind Abkürzungen und lassen sich in der Hilfe (H) frei belegen. Die Notfall-Tasten wirken auf jeder Station und stehen als Tastenkappe auf dem Knopf, den sie drücken; Feuer und Rakete gehen dabei über den Sicherheitsknopf ihrer Station.</p>
<table class="grid keys">${KEYS.map(([k, v]) => `<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`).join('')}</table>
<h2>Glossar</h2>
<table class="grid gloss">${[...GLOSSARY].sort((a, b) => a[0].localeCompare(b[0], 'de')).map(([k, v]) => `<tr><td><b>${k}</b></td><td>${v}</td></tr>`).join('')}</table>
`;
