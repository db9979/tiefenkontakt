# Änderungsprotokoll · Changelog

Versionen folgen [Semantic Versioning](https://semver.org/lang/de/). Ein Tag `vX.Y.Z` erzeugt ein GitHub-Release mit dem
Abschnitt dieser Datei und das Docker-Image `ghcr.io/db9979/tiefenkontakt:X.Y.Z`.

## [Unreleased]

### Spiel
- **Seezielflugkörper für das Wachschiff:** Projekt 11 trägt acht Sea-Skimmer (6–40 km, zwei Vierfachstarter).
  Der Suchkopf öffnet 9 km vor dem Zielpunkt und nimmt das größte Echo im Kegel, auch Neutrale. Eskorten wehren
  automatisch ab: Flugabwehrraketen bei Radar an (ein Starter, eine Salve überlastet ihn), aus der Nähe die Geschütze.
  Flugkörperwarnung für die Eskorten, Symbole auf der Karte, Pult im Waffenleitstand und Rechtsklick-Befehl. Die KI
  hält 14–30 km Abstand zum Konvoi und schießt zwei Salven zu vier. Damit verliert der Ostpakt mit Wachschiff keinen
  Angreifer mehr.
- **Gemischte Teams:** je Seite ein gemischter Platz. Westbund: Jagd-U-Boot S-14 in direkter Unterstützung des
  Konvois (jagt die Wölfe). Ostpakt: Wachschiff Projekt 11 mit Tiefensonar und Raketen (bindet die Eskorte, jagt deren
  Boot). Eigene Signaturen, Modelle, Erkennungsbuch und Handbuchkarten. Mitwanderndes Sperrgebiet (4 km) um eigene
  U-Boote: keine eigene Rakete, Wasserbombe oder Hubschraubertorpedo dort, auf der Karte eingezeichnet. Die KI fährt
  beide Rollen; der Westbund gewinnt weiter, wenn alle Ost-U-Boote versenkt sind.
- **Sehrohr:** Entfernungen werden fortlaufend verfeinert statt jede Sekunde neu geschätzt; Ziele springen nicht mehr.
- **Land dazwischen:** Inseln und Landzungen blockieren Schall, flache Schwellen lassen nur Schall nahe ihrem Kamm
  durch; Radar, Sehrohr, Ausguck und Radarwarner brauchen freie Sicht über das Land. Der Radarschirm zeigt auf
  allen Karten Küstenechos mit Radarschatten dahinter.
- **Flugzeuge nur mit dem Auge gesehen** erscheinen auf dem Plot als grobe Schätzung (Peilung gut, Entfernung
  ±25 %, nur „hoch“ oder „tief“); unbeleuchtete Flugzeuge sieht man nachts nur aus der Nähe.
- **Strömungen und Gezeiten** der echten Gebiete: Gibraltar zweischichtig (oben ostwärts, unter 150 m westwärts),
  Dardanellen, Messina, Pentland Firth bis 5,5 kn, Overflow an der Färöer-Bank, Gezeitenströme in Fjorden und
  auf dem Schelf. Schiffe, Boote, Torpedos und Bojen versetzen; Zentrale und OPZ zeigen Strom und Kenterzeit.
- **Jahreszeit** (Lobby): Sonnenstand nach Breite und Monat (Polarnacht, Mitternachtssonne, Sonne am echten
  Himmel), Sprungschicht je Gebiet und Jahreszeit (scharfe Sommerschicht im Mittelmeer, Winterdurchmischung im
  Atlantik, keine Schicht im arktischen Winter, Halokline der Ostsee), Nebel und Eis nach Gebiet.
- **Navigation ohne GPS:** Der Mast allein gibt keinen Standort mehr. Fix durch Landpeilung (±100 m), Satellit
  (Durchgang etwa alle 90 Minuten, ±200 m), Sterne (nachts bei klarem Himmel, ±1,5 km) oder Echolot gegen die
  Seekarte (hilft am geneigten Grund, ist auf wenige Kilometer hörbar). Zentrale mit Koppelort in Grad und Minuten.
- **Bodenechos:** Felsnadeln, Kuppen und Steilhänge der echten Seekarte antworten auf einen Ping wie ein
  gestopptes Boot.
- **Funk:** ELF-Ruf für Atom-U-Boote zwei Minuten vor einem Funkspruch der Führung; VLF-Sendeplan in der Zentrale.
- **Verkehr auf echten Wegen:** Verkehrstrennungsgebiete, Durchgangswege und Fährlinien (Tarifa–Tanger,
  Messina, Çanakkale, Rønne–Ystad, Helsinki–Tallinn, Bodø–Moskenes u. a.) über Wasser geführt, Trawler auf den
  Fanggründen; Wege und Fanggründe stehen auf der Karte.

- **Sofort spielen:** „Als Geleitschutz“ oder „Als U-Boot“ startet ohne Lobby eine Partie gegen die KI mit zufälliger
  Mission, Tageszeit, Wetter und Lage.
- **Wochenlage:** eine Lage pro Kalenderwoche, für alle gleich; das beste Ergebnis je Konto und Seite kommt auf die
  Wochenliste (`GET /api/weekly`).
- **Gamepad:** linker Stick Kurs, Trigger Fahrt, Steuerkreuz Tiefe und Feinkurs, Schultertasten Station, Start ⚙-Menü,
  Select Hilfe.

- **Rückmeldung nach der Partie** (für Testabende): Spaß 1–5, Stichworte, ein Satz; Moderatoren sehen Liste und
  Schnitt in der Lobby.
- **Moderationspanel:** Grafikleistung echter Geräte (anonym, Bildzeiten je Geräteklasse und Stufe), Ausstiege (Lobby,
  Ausbildungsschritt, Spielminute, Seite und Klasse) und Balance aus echten Partien (Mensch–Mensch und Mensch–KI);
  `scripts/real-balance.ts` gibt dasselbe auf der Konsole aus.

- **Echte Seegebiete:** 26 Gebiete mit echten Tiefen und Küsten (NOAA ETOPO 2022), darunter Färöer-Bank,
  Barentssee, Vestfjord, Kolabucht, Gibraltar, Dänemarkstraße, Färöer-Shetland-Kanal, Nordkap, Ostsee, Ofotfjord,
  Loch Ewe, Firth of Clyde, Messina, Dardanellen und Pentland Firth. In der Lobby wählt man zur Mission das
  Seegebiet; jede Mission spielt in den Gebieten, die zu ihr passen. Sofort-Spiel und Wochenlage ziehen ein Gebiet.
- Balance auf den echten Karten (KI-Arena): Fjordausfahrt im breiten Vestfjord mit vorausgesetzter Eskorte und näher
  wartenden U-Booten (vorher 1:9, jetzt 18:12); die anderen Missionen wie vorher.
- **Land und Grund:** KI-Schiffe, Konvoi und Neutrale weichen Untiefen und Land aus, der Navigator warnt Spieler
  rechtzeitig; U-Boote laufen auf Land auf statt darüber zu fahren; Torpedos detonieren an der Küste.

- **Fernglas:** 6×, 8×, 10× und 12× (Mausrad, Taste E) mit Strichplatte (Strichskala für die Entfernung), frei nach oben,
  unten und zur Seite schwenkbar (Ziehen, W A S D, ▲▼). **Sehrohr:** 1,5×, 6× und 12×. Bei beiden zuschaltbare
  Stabilisierung (Knopf „Stab“, Taste G): ohne sie schwankt das Bild mit Schiff und Seegang, das Fernglas zittert in
  der Hand.

- **3D-Ansicht aufs Handy:** Auf Brücke und Sehrohr zeigt „📱 Handy“ einen QR-Code (Einmal-Link, 10 Minuten). Das
  Handy zeigt Sehrohr oder Fernglas, umschauen durch Drehen und Neigen (Kreisel), zwei Finger zoomen, Tippen wählt ein
  Schiff, Foto-Knopf; die Station am PC folgt dem Blick des Handys. Ton aus dem Handy-Lautsprecher.
- **Hafenangriff:** Die KI-U-Boote laufen den bekannten Ankerplatz an und schießen aus Sehrohrtiefe einen Fächer;
  Start rund 16 km vor dem Hafen. Arena vorher 30:0 für den Geleitschutz, jetzt 19:21.

- **Kartenwerkzeuge:** Markierung (mit Namen), Linie (mit Peilung und Länge), Kreis (mit Radius) und Radierer am
  Rand des Plots; die Zeichnungen liegen fest auf der Karte und bleiben für die Partie gespeichert. Rechtsklick:
  „Alle Zeichnungen löschen“.

- **Zentrale im U-Boot** (Station 5): Koppeltisch mit Kontakten, Lösungen und Zeichnungen, Tiefe, Sprungschicht,
  Batterie, Eigengeräusch und Mast auf einen Blick, Funkbuch des Rudels, Schnellbefehle (Sehrohrtiefe, unter die
  Schicht, Alarmtauchen, Ruhe im Boot, Mast) und ein Wasserfall-Streifen.

- **Horchraum-Ton:** Das Meer rauscht nach Seegang, Regen, Eis und eigener Fahrt; ein Kontakt liegt mit seiner
  Signalstärke darüber und versinkt, wenn sie fällt. Schraubentakt nach Flügelzahl, Kavitationsknistern, dumpf in der
  Ferne, aus der Peilrichtung (Stereo), Linien mit Doppler. Wale (Pulse, Gesang), Pottwal- und Delfinklicks,
  Pfiffe, Knallkrebse und das Heulen eines Torpedos sind zu erkennen.
- LOFAR bis 500 Hz mit Band „Hoch“ (200–500 Hz): der 400-Hz-Ton des AIP-Boots ist jetzt messbar.
- **Handbuch:** Signaturtabelle aller Klassen (Flügel, Drehzahl je Knoten, DEMON-Beispiel, LOFAR- und
  Schnorchellinien, Analyseband, Klang) und eine Anleitung zum Erhorchen und Messen.

### Grafik
- **Seekarte:** Tiefseehügel, Seeberge und Kontinentalhang neben der Route, Sandwellen, ein ertrunkenes Flusstal und
  eine buchtenreiche Küste auf dem Schelf, Schären und Bergland an den Fjorden, Land nach Höhe gefärbt. Um die Route
  bleibt die Tiefe wie bisher (gleiche Akustik).
- Sehrohr unterschneidet im groben Seegang (grünes Wasser, die Optik tropft nach); Wind, Seeschlag, Regen und Donner
  (nach Entfernung verzögert) an Deck; beleuchtete Fenster bei Nacht; Treffer nach Schiffsgröße, Tanker brennen
  länger; Unterwasser-Rekonstruktion mit Wellen von unten, Snellius-Fenster und Trübung nach Seegang.
- **Neues Meer:** sieben Wellenzüge mit echter Ausbreitungsgeschwindigkeit, die langen laufen mit dem Wind, die Dünung
  quer dazu; das Meer liegt fest auf der Karte, das Wasser strömt also am fahrenden Schiff vorbei. Dichtes Gitter am
  Auge, kurze Wellen nur, wo Gitter und Pixel sie tragen (vorher liefen Schein-Wellen in falsche Richtungen).
- Schiffe reiten auf den Wellen (Tauchen, Stampfen, Rollen aus der Wasseroberfläche unter dem Rumpf), auch das eigene
  Schiff auf der Brücke.
- Kielwasser und Bugwelle liegen auf den Wellen, der Schaum bleibt im Wasser stehen; kleine Schaumkronen in Windrichtung.
- **Wetter:** Bewölkung nach Wetterlage (Schönwetterwolken, aufgelockert bei frischem Wind, bedeckt unter und nahe
  Schauern), fest auf der Karte und mit dem Höhenwind ziehend, von der Sonnenseite beleuchtet; Sonnenhof, Abendrot nur
  auf der Sonnenseite, Dunstband am Horizont, Sterne nur in Wolkenlücken. Das Meer spiegelt den Himmel.
- Regen fällt in Streifen, schräg vom Wind und vom eigenen Fahrtwind, und raut die Wasseroberfläche auf; in kalten
  Lagen schneit es. Unter einem Schauer wird es diesig statt einer Wand. Gewitter in manchen Schauerzellen.
- Ab Seegang 5 Gischtstreifen in Windrichtung; Schaumkronen sind nachts nicht mehr hell.
- **Seegang:** Wellenhöhe nach WMO-Tabelle (Seegang 3 ≈ 1,6 m, 5 ≈ 4 m, 6 ≈ 6 m signifikant), die Energie liegt
  bei der zum Seegang passenden Wellenlänge, die Kämme sind geschärft; das Gitter trägt die Wellen jetzt bis in die
  Ferne (vorher fielen sie ab etwa 100 m weg, das Meer wirkte flach). Das Wasser spiegelt je nach Neigung Horizont
  oder Himmel, so zeichnen sich die Wellen ab.
- Schiffe rollen zusätzlich in ihrer Eigenperiode, im groben Wetter deutlich (Fregatte bei Seegang 5 um 10–15°),
  auch die eigene Brücke.
- **Schiffsvielfalt:** Jedes Schiff sieht nach seiner Kennung aus, immer gleich. Geleitzug: Stückgutfrachter
  (Brücke mittschiffs, ¾ achtern oder achtern; 4–6 Luken; Ladebäume, Pfosten oder Kräne; Holz, Container oder
  Fahrzeuge an Deck), Containerfeeder, Massengutfrachter, Kühlschiffe, kleinere Tanker und Ro-Ro-Frachter.
  Beladen tief, in Ballast hoch mit rotem Unterwasserschiff; Rostfahnen, Zierstreifen, viele Reedereifarben.
- Neutrale: Tanker, Containerschiffe, Fähren (auch mit farbigem Rumpf) und Schlepper in Größe und Farben variiert,
  dazu Motoryachten und ältere Seitenfänger neben Segelyachten und Heckfängern.
- **Sicht:** Dunst nach Koschmieder für alles im 3D-Bild (Schiffe, Meer, Kielwasser, Rauch, Schauer, Wolken):
  Kontrast fällt exponentiell mit der Entfernung, die Sichtweite kommt aus dem Wetter (klare Luft ~30 km, Gischtdunst
  bei hohem Seegang, Regen ~6 km, Schnee weniger, Nebelbank 150 m). Server und Bild rechnen mit derselben
  Sichtweite: das Sehrohr sieht im Regen jetzt etwa 5,5 statt 10 km weit. Positionslichter tragen weiter als der Rumpf.
- Zwölf statt sieben Wellenzüge mit breiterer Richtungsstreuung (keine regelmäßigen Reihen mehr), Kammschärfung
  begrenzt, damit die Oberfläche nicht überschlägt; kein Sonnenglitzern mehr im Regen.
- Eigener Produktentanker (~150 m) im Geleitzug statt des verkleinerten Großtankers. Das Erkennungsheft zeigt auf
  der Geleitzug-Seite alle sechs Typen als Seitenriss.
- Grafik „Auto“ schaltet für die Sitzung eine Stufe herunter, wenn ein Gerät unter 60 % der Bildrate bleibt.
- Flugzeuge: Verkehrsflugzeuge in den Farben verschiedener Fluglinien, teils vierstrahlig; Sportflugzeuge und
  Hubschrauber in mehreren Lackierungen.

## [1.0.0] – 2026-11-23

Die erste vollständige Version: ein asymmetrisches U-Boot-Gefecht im Kalten Krieg im Browser, Wolfsrudel gegen
Geleitschutz um einen Konvoi, auf einem Raspberry Pi 5 betreibbar.

### Spiel
- **Zwei Seiten, neun Missionen:** Grönland-Lücke, Schelfmeer, Fjordausfahrt, U-Boot-Duell, Hafenangriff, Fühlung halten,
  Meerengen-Durchbruch, Aufklärung und eine frei einstellbare Mission; je Team 1–6 Spieler, KI füllt leere Plätze.
- **Schiffsklassen:** Atom-U-Boot, Diesel-U-Boot, AIP-Boot, Küsten-U-Boot; Fregatte F-12, VDS-Fregatte F-30, Korvette K-7.
- **Stationen wie an Bord:** Horchraum mit Wasserfall, LOFAR und DEMON; Sehrohr in 3D mit Fotos und Erkennungsbuch;
  Feuerleitung mit Zielbewegungsanalyse (manuell und Auto-TMA); Tauchstand; auf der Fregatte Operationszentrale, Sonar,
  Waffen, Radar/ESM und Brücke.
- **Simulation:** Sonargleichung mit Sprungschicht, Konvergenzzonen, Nachhall und Seegang; Schleppsonar mit
  Links-/Rechts-Mehrdeutigkeit; drahtgelenkte Torpedos, Täuschkörper, U-Jagd-Raketen, Hubschrauber, Sonarbojen,
  Seefernaufklärer, Seeminen und Flugabwehr; Abteilungsschäden mit Wassereinbruch, Feuer und Sinken; Wetter mit
  Nebelbänken, Schauern, Eis und Eisbergen; ziviler Verkehr und Meerestiere.
- **Funk als Risiko:** U-Boote senden nur mit Mast oben und werden dabei angepeilt; Sprechfunk über einen eigenen
  LiveKit-Server mit denselben Funkregeln, Wetter und Reichweite.
- **KI-Kapitäne** mit Lösungsverfahren nach kleinsten Quadraten, Teamtaktik der Eskorte, Minensperren und einer KI,
  die die Gewohnheiten der Spieler lernt; Balance über die Bot-Arena geprüft.
- **Variation:** Wartepositionen, Eskorte, Route, Konvoifahrt und Seegang ändern sich von Partie zu Partie (aus, gering,
  stark), Tageszeit und Wetter auf Wunsch zufällig; „Gleiche Lage nochmal“ nach jeder Partie.
- **Einstieg:** Ausbildungen und zwei geführte Lernpartien („Erste Feindfahrt“, „Erste Geleitfahrt“), Nächster-Schritt-Hilfe,
  Einsteiger-Modus, Spielerhandbuch als PDF.
- **Danach:** Nachbesprechung mit Wiederholung der wahren Kurse und eigenen TMA-Lösungen, teilbar per Link; Kampagne
  mit bleibenden Schäden, Dienstbuch, Saisonranglisten und Abzeichen.

### Oberfläche
- Konsolen-Look mit Röhren-Effekt; **heller Modus** und „Wie System“, ☀/☾ unten links und im ⚙-Menü; 2D-Anzeigen
  zeichnen im hellen Modus direkt mit gespiegelter Helligkeit, Optiken bleiben dunkel.
- Seekarte mit feinem Tiefenrelief, Schummerung, beschrifteten Tiefenlinien und Wetterlage.
- Deutsch und Englisch, Farbenblind-Palette, Rotlicht, Schriftgröße 90–130 %.
- **Barrierefreiheit:** Warnungen und Alarme für Bildschirmleser, benannte Symbol-Knöpfe, Stationen als Reiter, Listen per
  Tastatur bedienbar, sichtbarer Fokusrahmen.
- **Touch:** langes Drücken für das Kontextmenü, Zwei-Finger-Zoom auf Karte und Nachbesprechung, größere Tippflächen.
- Installierbar als App (Service Worker), schneller Start durch Vorladen.

### Betrieb
- Ein Docker-Image (amd64 und arm64) mit Server und Client; `docker compose` mit LiveKit und TURN.
- Konten mit E-Mail-Bestätigung, Moderation, Sicherungen mit Spiegel und wöchentlichem Wiederherstellungstest,
  Watchdog mit Alarm-Mails, Metriken (`/api/metrics`), nächtliche Bot-Arena.
- **Last:** auf einem Raspberry Pi 5 gemessen; 30 Partien laufen mit der halben Kraft eines Kerns. Neue Partien werden
  abgelehnt, wenn die Simulation den Server über `MAX_LOAD` (Standard 0,6) auslastet.
- Tests: 320 Unit- und Integrationstests, Browser-Test, beide Lernpartien im Browser, alle Seiten hell und dunkel mit
  Kontrastprüfung in der CI.

### English summary
First complete release: a Cold War submarine-versus-escort battle in the browser with nine missions, seven ship
classes, a sonar/TMA simulation, voice radio with radio rules, learning AI captains, per-match variation with rematch,
guided tutorials, campaign, rankings, shareable replays, light and dark theme, accessibility and touch support, and a
single Docker image that runs on a Raspberry Pi 5.

[1.0.0]: https://github.com/db9979/tiefenkontakt/releases/tag/v1.0.0
