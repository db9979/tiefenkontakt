/** English for the ship's helicopter panel, its task queue, map menu and crew reports (helo-panel.ts, helo.ts). */

export const EN_HELO: [string, string][] = [
  ['ANHÄNGEN', 'APPEND'], ['SOFORT', 'AT ONCE'], ['Tauchsonar', 'Dipping sonar'], ['Bojenlinie', 'Buoy line'], ['Angriff', 'Attack'],
  ['Zurück', 'Return'], ['Liste leeren', 'Clear list'], ['TAUCHSONAR', 'DIPPING SONAR'], ['BOJENLINIE', 'BUOY LINE'],
  ['ZURÜCK AN DECK', 'BACK TO DECK'], ['HÄLT POSITION', 'HOLDING POSITION'], ['IN DER LUFT', 'AIRBORNE'], ['SCHWEBT', 'HOVERING'],
  ['TANKEN/AUFMUNITIONIEREN', 'REFUEL/REARM'], ['KRAFTSTOFF', 'FUEL'], ['KARTENPUNKT', 'MAP POINT'], ['KONTAKT ODER PUNKT WÄHLEN', 'SELECT A CONTACT OR POINT'],
  ['KEIN HUBSCHRAUBER', 'NO HELICOPTER'], ['ZU WEIT (30 KM)', 'TOO FAR (30 KM)'], ['LÄUFT', 'RUNNING'], ['KEIN AUFTRAG', 'NO TASK'],
  ['ZIEL: GEWÄHLTER KONTAKT ODER KARTE', 'TARGET: SELECTED CONTACT OR MAP'], ['RECHTSKLICK / LANGE TIPPEN', 'RIGHT-CLICK / LONG PRESS'],
  ['Auftrag streichen', 'Strike task'],
  ['Anhängen: ans Ende der Liste · Sofort: alles andere fällt weg', 'Append: to the end of the list · At once: everything else is dropped'],
  ['Bojen in der Linie (2,5 km Abstand, quer zur Sichtlinie)', 'Buoys in the line (2.5 km apart, across the line of sight)'],
  ['Schwebt 3 min und pingt über und unter der gemessenen Schicht, dann 4 km weiter in Suchrichtung (3 Tauchstellen)',
    'Hovers 3 min pinging above and below the measured layer, then 4 km on in the search direction (3 dips)'],
  ['Linie passiver Bojen quer zur Sichtlinie über dem Ziel, abwechselnd über und unter der Schicht', 'Line of passive buoys across the line of sight over the target, alternately above and below the layer'],
  ['Magnetsonde: Kleeblatt über dem Punkt (6 min), findet getauchte Boote nur sehr nah', 'Magnetic detector: cloverleaf over the point (6 min), finds submerged boats only very close'],
  ['Leichttorpedo auf die letzte gehaltene Position des Kontakts (aus dem Schweben etwa 1 min)', 'Lightweight torpedo on the contact\'s latest held position (about 1 min from the hover)'],
  ['Zurück an Deck: 10 min tanken und aufmunitionieren', 'Back to deck: 10 min to refuel and rearm'],
  ['Auftragsliste leeren (in der Luft: zurück an Deck)', 'Clear the task list (airborne: back to deck)'],
  ['Hubschrauber: aktive Bojenlinie (DICASS) · pingt, verrät sich', 'Helicopter: active buoy line (DICASS) · pings, gives itself away'],
  ['TORPEDO IM WASSER', 'TORPEDO IN THE WATER'], ['GELANDET', 'LANDED'], ['TANKEN UND AUFMUNITIONIEREN 10 MIN', 'REFUEL AND REARM 10 MIN'],
  ['KRAFTSTOFF KNAPP', 'FUEL LOW'], ['KEHRT ZURÜCK', 'RETURNING'], ['KEHRT ZUM AUFMUNITIONIEREN ZURÜCK', 'RETURNING TO REARM'],
  ['KEIN TORPEDO MEHR', 'NO TORPEDO LEFT'], ['SPERRGEBIET', 'RESTRICTED AREA'], ['KEIN ABWURF', 'NO DROP'],
  ['Auftragsliste voll', 'Task list full'], ['Kein Zielpunkt', 'No target point'], ['Auftrag nicht mehr in der Liste', 'Task no longer in the list'],
  ['Kein Auftrag gewählt', 'No task chosen'],
];

export const EN_HELO_PHRASES: [RegExp, string][] = [
  [/\b(\d+) AN BORD\b/g, '$1 ABOARD'], [/\b(\d+) IM MAGAZIN\b/g, '$1 IN THE MAGAZINE'],
  [/^Hubschrauber-Ziel hier \(([\d,.]+) KM\)$/, 'Helicopter target here ($1 KM)'],
  [/^Hubschrauber: Tauchsonar hier/, 'Helicopter: dipping sonar here'], [/^Hubschrauber: Bojenlinie hier/, 'Helicopter: buoy line here'],
  [/^Hubschrauber: MAD-Suche hier \(Kleeblatt, 6 min\)/, 'Helicopter: MAD search here (cloverleaf, 6 min)'],
  [/Hubschrauber: Torpedo hier/, 'Helicopter: torpedo here'], [/ \(sofort\)$/, ' (at once)'],
];
