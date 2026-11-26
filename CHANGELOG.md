# Änderungsprotokoll · Changelog

Versionen folgen [Semantic Versioning](https://semver.org/lang/de/). Ein Tag `vX.Y.Z` erzeugt ein GitHub-Release mit dem
Abschnitt dieser Datei und das Docker-Image `ghcr.io/db9979/tiefenkontakt:X.Y.Z`.

## [Unreleased]

### Neu
- **Jeder Tap zählt beim ersten Mal (Handy):** iOS Safari wertet einen Tap als „Hover“ und schickt keinen Klick, wenn
  während des Tippens irgendwo auf der Seite ein Knopf neu eingefügt wird. Der Client fügte ständig Knöpfe neu ein:
  die Klassifizierungsknöpfe in Horchraum und Sonar viermal pro Sekunde, die Filterchips und Sortierköpfe der
  Kontaktlisten bei jeder Änderung von Zähler oder Peilung, und die Meldungsliste baute sich in einer Schleife mit der
  Barrierefreiheits-Schicht 2–4× pro Sekunde neu auf. Diese Teile werden jetzt nur noch neu geschrieben, wenn sich ihr
  eigener Inhalt ändert. Die Meldungszeilen reagieren beim Loslassen statt auf den Klick. Lobby-Updates warten, bis
  der Klick des Taps angekommen ist (vorher 50 ms nach dem Loslassen, iOS klickt oft später). Hover-Regeln gelten nur
  noch für echte Mauszeiger, und Zeilen, Sortierköpfe und Panel-Reiter haben `touch-action: manipulation`.
  Touch-Prüfung mit 390 × 844 vorher → nachher: U-Boot 17 → 55 von 55, Geleitschutz 24 → 46 von 46, Lobby-Timing
  0 → 4 von 4; Lobby, Briefing und Handy-Sehrohr waren schon in Ordnung, die Maus am Desktop unverändert.
- **Eigenes Schiff, vierte Runde:** gedämpfte rote Lichtkegel unter den Lampen auf Nocks, Niedergängen und Flugdeck
  statt rot getöntem Deck, dunkles Schanzkleid bei Nacht, fein aufgebrochener Schaum an der Wasserlinie,
  Hitzeflimmern über den Abgasrohren bei hoher Fahrt.
- **Restpunkte der Stationsprüfung:** Kartenbeschriftungen weichen den Kartenknöpfen aus (kompakte Routenleiste am
  Handy), EIGEN wechselt nicht mehr zwischen eigener Spur und Bojenspur, Auto-TMA meldet „ENTFERNUNG UNBESTIMMT“
  statt nach einer schwachen zweiten Peilstrecke auf wenige hundert Meter zu fallen, Schließen-Kreuz der Treffer-Kamera.
- **Stationsprüfung 4 (Kapitäne, UX-Tester, Grafiker):** 72 Befunde auf U-Boot und Fregatte geprüft und behoben.
  - Realismus U-Boot: Auto-TMA begrenzt die Zielfahrt nach Klasse und Wellendrehzahl (Warnung „an der Grenze“),
    Fliegeralarm bei Luftfahrzeug nahe am ausgefahrenen Mast mit ALARMTAUCHEN, Funk zählt nur echte Geleitschiffe,
    Ausweichvorschlag bleibt unter der Schicht, Batterie-Restzeit bei befohlener Fahrt, FEUER fragt bei Güte unter 50 %.
  - Realismus Fregatte: Hubschrauber mit Startvorbereitung und 50 km Radius, Waffenreichweiten geprüft und angezeigt,
    Werfer mit Sicherheitsabfrage, Schleppsonar mit totem Winkel auch voraus, kein Eis an der Färöer-Bank,
    ESM-Reichweite am Funkhorizont, Meerenge ohne Konvoi-Texte, Telegraf mit Überwasser-Fahrstufen.
  - Lagebild: NATO-Symbole mit Farben nach Zugehörigkeit (Handelsschiff neutral), Beschriftungen ohne Überlappung,
    eigene Konvoischiffe stabil EIGEN (auch über Bojen), verlorene Kontakte behalten ihre Nummer ohne Verwechslung.
  - Layout: Kontaktlisten ohne abgeschnittene Werte, Kopfleiste mit Zeitraffer bei allen Breiten, Treffer-Kamera
    verdeckt nichts, Meldungen gebündelt, Dezimalkomma und Gradzeichen durchgängig, Radarschirme bleiben im hellen
    Modus dunkel, Konvoi-Kurs per Klick befehlbar.
- **Eigenes Schiff, dritte Runde:** Schornsteinrauch als weiche, mit dem scheinbaren Wind ziehende Abgasfahne statt
  grauer Kugeln (bei Marschfahrt kaum sichtbar, bei hoher Fahrt deutlich); Bugwelle, Schaum an der Bordwand und
  Schraubenwasser achteraus, mit der Fahrt skaliert; Nockdeck mit rutschfestem Anstrich, Plattenfugen, Wassergang,
  Speigatten und Holzgrätings; abgeblendetes Schiff bei Nacht (Positionslaternen leuchten, gedämpftes Rotlicht auf
  Nocks, Niedergängen und Hangar); Torpedorohre nach außen geschwenkt; Täuschkörperwerfer; Heckspiegel geschlossen.
- **Eigenes Schiff, zweite Runde (mit dem Fregattenkapitän):** offene Brücke mit geschlossenem Schanzkleid (kein
  Durchblick mehr), Nocks bis zur vollen Breite mit Peilaufsatz, Signallampen und Seitenlichtschirmen, Fensterfront mit
  Klarsichtscheiben und Wischern, Flaggenkästen und Signalleinen; sichtbares Geschützrohr, Werfer auf Drehsockel mit
  Abgasschild; Dreibeinmast mit Rah, Radaren und ESM, Schornstein mit Abgasrohren, Beiboote in Davits, Rettungsinseln,
  Hangar mit Leitstand, Flugdeck mit Markierungen und Netzen, Schleppsonar-Winde und Flagge am Heck.
- **Eigenes Schiff im Detail:** von der Brücke sieht man jetzt ein eigenes Nahmodell statt der Fernansicht:
  rutschfestes Deck mit Fugen, Abnutzung und Markierungen, Geschützturm mit Rohr, U-Jagd-Werfer bzw. Flugkörperbehälter,
  Ankerspill mit Ketten, Poller, Lüfter, Wellenbrecher, Reling mit Stützen, Flaggenstock und eine Ausguckplattform
  (F-12, F-30, K-7; das Wachschiff nutzt das F-30-Modell). Der Blick folgt dem Schiff in Stampfen und Rollen.
- **Handy-Fernglas:** wurde nach spätestens 15 s getrennt (antwortete nicht auf die Verbindungsprüfung) – behoben.
- **Gründliche Oberflächenprüfung:** ein strenger Prüfer hat jede Station, jeden Reiter und jedes Menü in Hell und
  Dunkel bei 1440, 1140 und 390 px durchgesehen; 64 Befunde behoben, u. a.: FLASH- und Torpedo-Banner verdecken nichts
  mehr, NIEDERLAGE in Rot, Kontaktlisten mit getrennten Spalten SENS / KLASSE / PEGEL, überall Dezimalkomma,
  Beschriftungen in Karten, Wasserfällen und Spektren auf Hinterlegung statt übereinander, Meldungen mit Spielzeit
  „T+“, Funk bei eingefahrenem Mast gesperrt, Torpedo-Einstellungen als bündiges Raster, Handy-Leiste mit allen
  Stationen, Lobby und Briefing im Hellmodus und auf dem Handy lesbar.
- **Aus dem Spielen:** Kontakte im toten Winkel erscheinen nicht mehr im Sonar (nur was das Sonar gerade selbst hört),
  ein eingeholter Schleppsonar bleibt dunkel, keine Schicht in Wasser, das flacher ist als sie, Schiffe tauchen in
  3D aus dem Dunst auf statt aufzuploppen, kein weißer Strich mehr in der 3D-Ansicht, Flugzeuge hinterlassen ein
  Radarecho, eigener Hubschrauber, Seeaufklärer und Torpedos als NATO-Symbole, „Klasse zuweisen“ als Knopf,
  Reichweitenvorhersage mit Klartext-Legende und Tauchgrenze, schwächere Schatten neben lauten Wasserfall-Spuren.
- **Route plotten:** In der Zentrale des U-Boots und in der OPZ der Fregatte lassen sich bis zu 20 Wegpunkte auf die
  Karte setzen, verschieben und löschen, je Wegpunkt wahlweise mit Fahrt und (U-Boot) Tiefe. Die Route zeigt
  nummerierte Punkte, rechtweisenden Kurs und Entfernung je Schenkel. „Route fahren“ steuert den nächsten Wegpunkt
  an, schaltet beim Erreichen weiter und geht bei einem Kursbefehl von Hand aus. Ein Vorausvektor („VORAUS N MIN“,
  3–30 min) zeigt, wo das Schiff in N Minuten steht.
- **Expertenpanel-Überarbeitung:** U-Boot- und Fregattenkapitän, Entwickler, Grafikdesigner und Spieletester haben
  das ganze Spiel geprüft und diskutiert; die folgenden Punkte sind ihr gemeinsamer Beschluss.
- **Stationen zusammengelegt:** U-Boot 4 Stationen (Horchraum, Sehrohr mit Radarwarner, Feuerleitung mit Rohrbank,
  Zentrale mit Tauchstand), Fregatte 5 (OPZ mit Hubschrauber- und Verbands-Tab, Sonar mit Aktiv/VDS/BT, Waffen,
  Radar/ESM, Brücke). Jede Station füllt ihre Höhe, eine gemeinsame Kontaktliste (neue Kontakte oben, Sensor als
  Buchstabe), Tutorials mit hervorgehobenem Bedienelement und „Warum?“, Notfall-Tasten.
- **Sehrohr mit Sichtfeld:** Es sieht nur, wohin es zeigt (32°/8°/4° bei 1,5×/6×/12×). Profi: keine Klasse und keine
  Entfernung geschenkt, Entfernung nur über das Stadimeter. Einsteiger: Klasse nach 10 s Beobachtung bei ≥6×.
- **Radar gegen Mast und Schnorchel** einmal je Antennenumdrehung, Sehrohr bis 5 sm, Schnorchel bis 8 sm; Seegang
  stört. **Flugzeugradar** findet Schnorchel (Seefernaufklärer 30 km, Hubschrauber 15 km) und gibt der Eskorte eine
  ungenaue Position. **ESM/Radarwarner** reichen nur bis zum Funkhorizont (U-Boot–Fregatte etwa 18 sm).
- **Sonar:** Bojen empfindlicher, Schleppsonar +8 dB nur gegen laute Boote (Schnorchel, Pumpen, Kavitation); der
  geschleppte Täuschkörper kostet Eigenrauschen und begrenzt auf 25 kn. Aktivsonar mit Einzelping und Bereich
  4/8/16 km (Ping alle 6/11/22 s). Schleppsonar beruhigt sich nach kleinen Kursänderungen schneller.
- **Batterie zählt:** Diesel-Boote starten mit 40–70 %, schnelle Fahrt zehrt stark (1 + v³/70 %/h), Reichweite bei
  dieser Fahrt wird angezeigt.
- **Torpedos:** 40 kn → 15 km, 30 kn → 25 km; Abschuss nur bis 15 kn und 0,8 × Tauchtiefe (FEUER zeigt den Grund und
  behebt ihn mit einem Klick); Fächer 1–4; Restlaufzeit je Draht. Frachter: ein Treffer macht ihn zum Nachzügler, der
  nach 15 min sinkt, zwei Treffer versenken ihn.
- **U-Jagd-Waffen:** Rakete mit Streuung und 1,8 km Mindestentfernung, Leichttorpedos suchen ober- und unterhalb der
  gemessenen Schicht, Fregatten mit 6 Rohren und 15 min Nachladen, Wasserbomben ersetzt durch einen nach vorn
  geworfenen Werfer. Mast nicht über 10 kn.
- **Bordhubschrauber in der Luft:** Auftragsliste (Bojenlinie, Tauchsonar mit Ortswechsel, MAD, Angriff auf die letzte
  Position), 90 min Ausdauer, dann 10 min Tanken und Aufmunitionieren.
- **Tempo:** Das Zeitlimit gilt in echten Minuten (Standard 40, Zeitraffer bleibt ×1), die Aufstellung richtet sich
  nach der Seezeit, erster Kontakt binnen etwa 10 Minuten. „Zeitraffer bis Ereignis“ (×6) stoppt bei Kontakt, Alarm
  oder erledigtem Schritt; im Mehrspieler nur, wenn alle zustimmen.
- **Versenkt, aber dabei:** bei einem Mitspieler mitfahren, verzögert zuschauen oder sofort zur Nachbesprechung.
- **Lobby für Neue:** „Neu hier? → U-Boot / Fregatte lernen“, klare Spielmodi, Einstellungen hinter „Erweitert“,
  Einsteiger-Klassen markiert. **Auswertung** mit Ergebnisstufen (knapper Sieg, Unentschieden …) und Wertung je
  Spieler.
- **Gestaltung:** Schrift- und Abstands-Stufen, Farbrollen (Rot nur für Gefahr), besserer Kontrast im Hellmodus,
  Kopfzeile ohne Überlappung, Seitentabs mit Zählern, Ruderstand mit Telegrafenleiste, kein Flackern, Rasterzeilen
  wahlweise.
- **Vereinfacht:** Moral-Anzeige entfernt, Gefechtsstationen automatisch bei Alarm, zufällige Crew-Pannen ersetzt durch
  Geräusche, die der Spieler selbst verursacht (Nachladen, Trimmpumpen, Alarmtauchen bei Schleichfahrt).
- **Stabilität:** Partie friert nicht mehr ein, wenn ein Mitspieler zurückkommt; Peilverläufe bleiben nach
  Wiederverbinden erhalten; Verbindungsüberwachung; Kursbefehle beim Ziehen gehen nicht mehr verloren; zwei Lücken im
  Nebel des Krieges geschlossen; keine Speicher- und WebGL-Lecks mehr zwischen Partien; englische Oberfläche schneller.
- **Rückwärtsfahrt:** Fahrstufen achteraus (bis 40 % der Höchstfahrt, höchstens 8 kn). Das Schiff verliert erst die
  Fahrt und nimmt dann langsam Fahrt achteraus auf; das Ruder wirkt rückwärts nur halb. Ein aufgelaufenes Schiff kann
  sich achteraus freifahren, wenn hinter ihm tieferes Wasser ist.
- **Ruderstand aufgewertet:** Kompass mit Gradskala, Sollkurs-Marke, Drehbogen bis zum befohlenen Kurs, eigenem Schiff
  und Kielwasser; Instrumente für Kurs, Fahrt (voraus/zurück) und Ruderlage; Maschinentelegraf von „AK zurück“ bis
  „AK voraus“ zum Anklicken, mit Hebel (befohlen) und Zeiger (gemachte Fahrt); Fahrtregler mit Rückwärtsbereich.
- **Schadensabwehr neu gestaltet:** Schnittzeichnung aus dem 3D-Modell des Schiffs (über und unter Wasser), die
  Abteilungen genau im Rumpf eingefärbt (Wasser, Brand, Schaden, Schotten), Farben für hellen und dunklen Modus, Trimm
  und Absinken weich; Statuszeile, eine kompakte Zeile je Abteilung, Befehle für die gewählte Abteilung darunter.
- **Küsten im 3D genau:** Das Gelände nahe am Schiff hat 100-m-Raster und die Uferlinie liegt genau bei Wassertiefe 0
  der Seekarte; vorher ragte die Küste bis zu 300 m ins Wasser und man schien über Land zu fahren.
- **Auflaufen mit Folgen:** Wer mit Fahrt auf Grund läuft, bleibt sofort stehen und nimmt Schaden je nach Fahrt, am
  Felsufer mehr als auf einer Sandbank (bei 12 kn rund 35 Punkte statt pauschal 8).
- **Kontaktklang am Hydrophon:** Schmalbandlinien im Breitband nur noch leise und nicht mehr hochoktaviert (klang wie
  eine Orgel), Rauschen tiefer gewichtet, deutlicherer Blattschlag.
- **Handy-Fernglas:** Land sichtbar, Maske im hellen Modus schwarz, beide Okulare sauber ausgeschnitten.
- **Land im 3D:** Küsten, Inseln und Berge aus der Seekarte erscheinen in Sehrohr und Brücke (Strand, Grün, Fels,
  Schnee nach Höhe), um das eigene Schiff herum und mit dem Dunst verblassend.
- **Neue Geräusche:** Schnorchel-Diesel, Drahtbruch, Suchkopf-Pings eines anlaufenden Torpedos (immer schneller),
  Wasserbomben-Detonationen (als Transient für alle Spieler hörbar und gemeldet), Echos mit Doppler (höher beim Annähern).
- **Horchraum und Fregatten-Sonar ohne Scrollen:** Kontaktliste und Seitenwahl rechts unter der Signalanalyse, die
  Wasserfälle nutzen die volle Höhe.
- **Stationen neu geordnet:** U-Boote bekommen „Ortung“ (Bedrohung und Ausweichen, Aktivsonar-Schirm, ESM-Radarwarnung,
  Echolot, Reichweitenvorhersage) und „Torpedoraum“ (Rohre mit Ladestand, Draht mit Feinsteuerung, Täuschkörper, Minen),
  Überwasserschiffe „Ortung“ (Aktivsonar, BT, VDS, Minenmeiden) und die Fregatte mit Hubschrauber „Flug“ (Aufträge zum
  gewählten Kontakt als Knöpfe). Flugabwehr sitzt bei Radar/ESM, Gefechtsstationen und Notanblasen in der Zentrale, die
  doppelte Fahrstufenleiste im Tauchstand ist weg. Tasten 6 und 7, auf dem Telefon eine scrollbare Stationsleiste.
- **Aktivsonar-Schirm überarbeitet:** Bereiche 2–10 sm, Gradring, toter Winkel achtern, Echos nach Doppler gefärbt (CW),
  Echotabelle, Countdown zum nächsten Ping, Ping- und Pulsknöpfe direkt am Schirm.
- **Feuern mit Sicherung:** Raketen, Torpedos, Seeziel-FK und Hubschraubertorpedo fragen ein zweites Mal, wenn das Ziel ein
  eigenes Schiff ist, Eigene nahe am Zielpunkt stehen oder die TMA-Güte unter 30 % liegt; ohne Ziel verweigern sie.
- **Keine Lücken mehr:** Wasserfälle, Tiefenprofil und Signalanalyse sammeln auch, wenn ihre Station nicht angezeigt wird.
- **Mast vormerken:** Zu tief gedrückt fährt das Boot auf Sehrohrtiefe und der Mast geht bei Ankunft hoch („VORGEMERKT“).
- **Klassengerecht:** Korvette und Wachschiff zeigen keine Hubschrauber-/Bojenzeilen mehr, Schleppsonar-Längen nur bis
  zur Kabellänge der Klasse; Sehrohr, Brücke und Tiefenprofil füllen die Höhe; Wetterkreise getaucht ausgeblendet;
  wiederholte Aktivsonar-Peilungen im Meldungsprotokoll gebündelt.
- **Wasserfall:** schmale Keulen, Normalisierer (NORM), Mittelung, Helligkeit und Kontrast; der Konvoi zerfließt nicht mehr.
- **3D-Modelle:** eigenes Jagd-U-Boot mit Kreuzleitwerk, eigenständiges Wachschiff (U-Jagd-Starter vorn, schräge FK-Starter,
  Türme achtern, VDS-Pforte), Fregatte mit Geschütz vorn und Gittermast, Masthöhen und Tiefgang passend zum Erkennungsheft,
  Küsten-U-Boot liegt tiefer, erfundene statt echter Reedereinamen, kein Flimmern auf Distanz.
- **Klang:** Dauerbrummen (80 Hz) im Hydrophon behoben, Blattschlag richtig herum, Rauschen ohne hörbare Wiederholung,
  Begrenzer gegen Übersteuern, lauterer eigener Ping mit CW/LFM-Klang, Torpedo als Rauschen mit Blattschlag, Grundberührung
  ohne Explosion.
- **Reichweitenvorhersage:** Horchraum und Fregatten-Sonar zeigen einen Schnitt Entfernung gegen Tiefe: wo man den
  Gegner hört (grün) und wo man selbst gehört wird (rot), mit Schicht, Grund und Konvergenzzone, berechnet aus dem
  Schallmodell des Spiels. Ohne gemessene Schicht nur als grobe Schätzung gekennzeichnet.
- **Tiefen- und Grundalarme:** Im Tauchstand lassen sich Ober- und Untergrenze sowie zwei Grundabstände (Warnung,
  Gefahr) setzen. Ein Alarm piept, wird vorgelesen und steht auf jeder Station und am Ruderstand.
- **ESM erkennt den Radartyp:** Jede Abfangmeldung nennt den (erfundenen) Radartyp, die vermutliche Plattform mit „?“,
  wo mehrere Klassen dasselbe Gerät tragen, Stärke und Trend („SEEFALKE-2 · FREGATTE? (OBERFLÄCHENSUCHE) · STARK,
  STEIGEND“). Flugzeug- und Feuerleitradar sind rot („FLUGZEUGRADAR – TAUCHEN“). Gilt für Fregatten-ESM, Sehrohr und Lagebild.
- **U-Boot-Radar am Mast:** Mit ganz ausgefahrenem Mast kann ein U-Boot kurz sein Radar einschalten und findet Schiffe bis
  zum nahen Horizont (etwa 14 sm), auf einem eigenen Radarschirm am Sehrohr (16 sm, Küste, Echos). Jedes ESM peilt es dabei
  als U-Boot-Radar an; Mast einfahren oder Tauchen schaltet es ab.
- **Erkennungsheft erweitert:** Silhouetten im gemeinsamen Maßstab (Schiffe und U-Boote je eigener) mit Höhenraster,
  Wasserlinie, Länge, Tiefgang und Masthöhe fürs Stadimeter, dazu Draufsicht, Bugansicht und ein Vergleichsumriss.
  Neue Reiter „Akustik“ (Blattzahl, Drehzahl, Schmalbandlinien als Balken, Klang) und „Bedrohung“ (Waffen und Sensoren
  mit Reichweiten aus dem Spiel, ein taktischer Hinweis), außerdem „Verwechslungsgefahr“ mit Unterscheidungsmerkmal.
  Auf dem Telefon in voller Breite.
- **Erkennungsheft als PDF:** In der Lobby und in der Hilfe neben dem Handbuch zum Herunterladen: Titelseite mit allen
  Silhouetten im Maßstab, dann je Klasse eine A4-Seite mit Sicht, Bedrohung, Radar im ESM und Akustik
  (`npx tsx scripts/handbook/recog-pdf.ts` baut es neu).
- **Schelf ausgeglichen:** Die U-Boote warten 12 statt 10 km abseits der Route. KI-Arena je 12 Partien, Grund / Ost
  gemischt / West gemischt / beide gemischt: vorher 4:8, 11:1, 2:10, 2:10, jetzt 5:7, 7:5, 6:6, 4:8.
- **Grundaufstellung ausgeglichen:** Das Atom-U-Boot der KI schießt schon bei einer etwas gröberen Lösung. KI-Arena
  (60 Partien, alle fünf Missionen): Grund 43:17 -> 33:27, West gemischt 30:30 -> 32:28.
- **Sonaranzeigen realistischer:** Wasserfall, LOFAR und DEMON zeigen Signale auf einer dB-Skala statt früh gesättigt:
  starke Kontakte heller und breiter (Nachbarkeulen), schwache brechen auf; jeder Kontakt und jede Linie schwindet
  langsam auf und ab (Mehrwegeausbreitung).
- **Aktivsonar-Schirm:** Im Horchraum und im Fregatten-Sonar erscheint beim Pingen ein Schirm: der Schallring läuft
  hinaus, Nachhall knistert nah am Boot, Echos leuchten an Peilung und Entfernung auf, ältere Pings als Nachleuchten.
- **Eigene Torpedos in der Kontaktliste** (rot, Peilung und Entfernung über den Draht), auswählbar; ausgewählt ist ihr
  Laufgeräusch im Kopfhörer zu hören.
- **Sinkgeräusche:** Ein sinkendes Schiff bricht hörbar auseinander, etwa eine Minute lang: stöhnender und kreischender
  Stahl, entweichende Luft, nachgebende Schotten, mit zunehmender Tiefe dumpfe Implosionen.
- **Eigene Torpedos am richtigen Ort:** Getaucht zeigt die Karte das Boot am Koppelort; die drahtgelenkten Torpedos
  standen bisher an ihrer wahren Position und tauchten deshalb um den Koppelfehler versetzt irgendwo auf. Jetzt laufen sie
  vom gezeichneten Boot los. Im Horchraum erscheinen sie als helle Spur mit rotem Namen (T1 …) in der Zeile der Kontakte,
  lassen sich anklicken und sind dann auf Karte und in der Drahtsteuerung hervorgehoben.
- **Natürlichere Biolaute:** Delfinpfiffe und Walgesang sind keine schwingenden Dauertöne mehr, sondern einzelne Rufe mit
  wechselndem Verlauf und Pausen (Pfiffe in kurzen Gruppen, Gesang in langen gleitenden Einheiten mit Oberton).
- **Jagd-U-Boot zurückhaltender:** Es schießt erst ab 7,5 km und abwechselnd zwei und einen Torpedo. Beide Seiten gemischt
  in der KI-Arena (60 Partien, alle fünf Missionen) 42:18 -> 38:22, West gemischt unverändert 29:31.
- **Peillinien-Schalter deutlicher:** Der Knopf rechts oben auf der Karte leuchtet amber, wenn die Peillinien aus sind,
  nennt im Tooltip seinen Zustand, und die Karte zeigt bei gewähltem Kontakt „PEILLINIEN AUS“.
- **Weniger ESM-Meldungen:** Dasselbe Radar auf derselben Peilung kommt nur neu, stärker, näherkommend oder nach zwei
  Minuten wieder ins Meldungsprotokoll (Flugzeug- und Feuerleitradar nach 30 s).
- **Zeitraffer voreingestellt auf Echtzeit:** 2× und 3× bleiben in der Lobby wählbar.

### Moderation
- **Admin-Mails gestaltet:** Alle Mails an den Admin (Meldungen, Feedback, Fehlerberichte, Alarme, Berichte) kommen als
  HTML im Konsolen-Look der Spieler-Mails, mit Datenblöcken und Links, plus Textfassung.
  Feedback, Spielermeldungen und Client-Fehler gehen zusätzlich gebündelt als Mail an den Admin.
- **Beendete Partien verwalten:** Das Moderationspanel listet die aufgezeichneten Partien (Zeit, Mission, Sieger, Dauer,
  Spieler und Endgrund, der jetzt mitgespeichert wird). Einzelne Partien lassen sich aus Balance, Rangliste und Dienstbuch
  nehmen. „Alles zurücksetzen“ löscht nach Eingabe von RESET alle Partie-Statistiken samt Wertung, Ausstiegen und
  Grafikleistung; Konten, Kampagne, Wochenlagen und Saisonarchiv bleiben. Bereits verrechnete Wertungspunkte einer einzeln gelöschten Partie bleiben stehen.

### Spiel
- **Knöpfe zeigen ihren Status:** Jeder Druck blinkt sofort auf. Schalter tragen AN/AUS, laufende Vorgänge Prozent und
  einen Füllbalken (Mast, Schnorchel, Schleppsonar, VDS, Tiefenbefehle bis zum Haken), Waffen ihre bereiten Rohre, die
  Nachladezeit oder LEER. Der Mast meldet „ZU TIEF“, solange das Boot unter Sehrohrtiefe ist.
- **Jagd-U-Boot schießt nicht mehr in den eigenen Konvoi:** Steht ein eigener Frachter oder ein Neutraler näher als 3 km
  am Ziel, hält es das Feuer (im Schelf traf es zuvor 12 eigene Frachter in 12 Partien). In der Meerenge jagt ein
  West-U-Boot jetzt die Durchbrecher, statt selbst durch die Enge zu schleichen.
- **Jagd-U-Boot wehrt sich:** Die KI des S-14 hat nur U-Boote angegriffen und wurde vom Wachschiff mit U-Jagd-Raketen
  gejagt (in 11 von 30 Partien versenkt). Wird es bedrängt und ist kein U-Boot in Sicht, greift sie jetzt das feindliche
  Kriegsschiff an. Beide Seiten gemischt in der KI-Arena 16:44 -> 35:25, West gemischt unverändert.
- **Karten genordet:** Lagebild, Tiefenkarte, Radar, ESM, Kompass, Wasserfall, Nachbesprechung und Missionskarten zeigen
  Nord oben wie eine Weltkarte. Alle Kurse und Peilungen sind rechtweisend, in Anzeigen, Eingaben, Meldungen, Funk und
  Lagebesprechung (Gibraltar: Route nach Osten statt „Norden“). Die Simulation selbst ist unverändert, die Balance gilt weiter.
- **Zeitraffer wählbar:** In der Lobby 3× (Standard), 2× oder Echtzeit. Die Einsatzdauer steht jetzt als Seezeit
  (zum Beispiel 120 Minuten); Route, Zeitlimit auf See und Balance bleiben bei jedem Zeitraffer gleich, nur die echte
  Spieldauer ändert sich. Die Uhr zeigt die Seezeit und die echte Restzeit mit dem Zeitraffer, die Lagebesprechung beides.
- **Siegregel Wachschiff:** Frachter, die das Wachschiff mit Seezielflugkörpern versenkt, zählen nur zur Hälfte zum
  Tonnage-Ziel des Ostpakts; der Konvoi bleibt Sache der U-Boote. Die Tonnage-Leiste zeigt dann „ZÄHLT … %“. Ostpakt
  mit Wachschiff in der KI-Arena (60 Partien, fünf Missionen) 22:38 -> 28:32, auf den Konvoi-Missionen 26:22. Die
  Arena kennt `ARENA_SEED` (andere Partien als ab 1000) und zählt Flugkörper-Versenkungen mit.
- **Karten ausgeglichen:** Seit Gelände, Strömung und Jahreszeiten lagen die Konvoi-Missionen beim Ostpakt (KI-Arena
  10:20). Schelfmeer: Boote warten 10 statt 5 km neben der Route. Fjordausfahrt: Eskorten starten 4 km vor dem Konvoi.
  Hafenangriff: Start 17 statt 16 km vor dem Ankerplatz. Meerenge: Ausgang 1,5 km weiter nördlich. Arena jetzt 23:17.
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
