# Änderungsprotokoll · Changelog

Versionen folgen [Semantic Versioning](https://semver.org/lang/de/). Ein Tag `vX.Y.Z` erzeugt ein GitHub-Release mit dem
Abschnitt dieser Datei und das Docker-Image `ghcr.io/db9979/tiefenkontakt:X.Y.Z`.

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
