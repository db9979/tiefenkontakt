/** English for the widget fixes of the UI QA pass (contact list, helm, waterfall, analysis, air defence, ESM). */
export const EN_WIDGETS: [string, string][] = [
  // Contact list
  ['SENS', 'SENS'], ['PEGEL', 'LEVEL'], ['Signalpegel in dB · ALT: Zeit seit der letzten Peilung', 'Signal level in dB · OLD: time since the last bearing'],
  ['EIGENER TORPEDO', 'OWN TORPEDO'], ['FREMDE', 'OTHERS'], ['Nur fremde Kontakte: eigene und verbündete Einheiten ausblenden', 'Others only: hide own and allied units'], ['ERFASST', 'ACQUIRED'], ['LÄUFT', 'RUNNING'],
  // Helm
  ['BEFOHLENE TIEFE', 'ORDERED DEPTH'], ['Befohlene Tiefe in Metern', 'Ordered depth in metres'], ['Befohlene Tiefe', 'Ordered depth'], ['Drehrate', 'Rate of turn'],
  ['Gemessene Sprungschicht', 'Measured layer'],
  // Waterfall
  ['−2 MIN', '−2 MIN'], ['−4 MIN', '−4 MIN'], ['SCHLEPPSONAR EINGEHOLT', 'TOWED ARRAY RECOVERED'], ['LÄNGE WÄHLEN ZUM AUSBRINGEN', 'CHOOSE A LENGTH TO STREAM IT'],
  ['SCHLEPPSONAR WIRD AUSGEBRACHT', 'TOWED ARRAY STREAMING'], ['ES HÖRT ERST, WENN ES DRAUSSEN UND STABIL IST', 'IT HEARS ONLY ONCE IT IS OUT AND STEADY'],
  ['SCHLEPPSONAR STABILISIERT SICH', 'TOWED ARRAY SETTLING'], ['GERADEAUS FAHREN, DANN HÖRT ES', 'STEER STRAIGHT, THEN IT HEARS'],
  ['Integration: Mittelung über mehrere Sekunden, ruhigere Spuren, aber träger', 'Integration: averaging over several seconds, steadier traces, but slower'],
  // Active sonar
  ['Messbereich', 'Range scale'],
  // Air defence
  ['Jäger anfordern', 'Request fighters'], ['Abfangjäger von Land anfordern', 'Request interceptors from shore'],
];

export const EN_WIDGETS_PHRASES: [RegExp, string][] = [
  [/^INT (\d+) S$/, 'INT $1 S'], [/^(\d+) HZ$/, '$1 HZ'], [/^ALT (\d+) S$/, 'OLD $1 S'], [/^ALT (\d+)MIN$/, 'OLD $1MIN'], [/^(\d+) FK AN BORD$/, '$1 SAM ON BOARD'],
  [/^Jäger anfordern · (\d+)$/, 'Request fighters · $1'], [/^Jäger in (\d+) min$/, 'Fighters in $1 min'], [/^Jäger bereit in (\d+) min$/, 'Fighters ready in $1 min'],
  [/^Flugkörper an Bord: (\d+) · Reichweite (\d+) km · bis (\d+) km Höhe$/, 'Missiles on board: $1 · range $2 km · up to $3 km altitude'],
];
