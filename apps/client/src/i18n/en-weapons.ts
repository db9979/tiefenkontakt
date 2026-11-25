/** English for the weapons and boat-systems texts (battery range, salvo, launch envelope, mortar, crew reports). */

export const EN_WEAPONS: [string, string][] = [
  ['REICHWEITE BEI DIESER FAHRT', 'RANGE AT THIS SPEED'], ['AIP · UNBEGRENZT', 'AIP · UNLIMITED'],
  ['SALVE', 'SALVO'], ['FÄCHER', 'SPREAD'], ['LAUFZEIT', 'RUN TIME'], ['DRAHT', 'WIRE'],
  ['ZU SCHNELL', 'TOO FAST'], ['ZU TIEF', 'TOO DEEP'], ['KEIN ROHR', 'NO TUBE'],
  ['Wasserbombenwerfer', 'ASW mortar'], ['WERFER', 'MORTAR'], ['Salve voraus werfen', 'Throw salvo ahead'],
  ['ZIEL 400–800 M VORAUS AUF EIGENEM KURS', 'TARGET 400–800 M AHEAD ON OWN HEADING'],
  ['U-Jagd-Rakete: 1,8–18 km Reichweite', 'ASW rocket: 1.8–18 km range'],
  ['Ziel zu nah: U-Jagd-Rakete erst ab 1,8 km', 'Target too close: ASW rocket from 1.8 km'],
  ['GEFECHTSSTATIONEN · ALARM', 'BATTLE STATIONS · ALARM'], ['GEFECHTSSTATIONEN AUFGEHOBEN', 'STAND DOWN FROM BATTLE STATIONS'],
  ['MAST EINGEFAHREN · ÜBER 10 KN BRICHT ER AB', 'MAST LOWERED · ABOVE 10 KN IT WOULD BREAK'],
  ['Mast und Sehrohr erst unter 10 kn', 'Mast and periscope only below 10 kn'],
  ['NACHLADEN IST LAUT · RUHE IM BOOT GESTÖRT', 'RELOADING IS LOUD · SILENT RUNNING BROKEN'],
  ['TRIMMPUMPEN LAUFEN · HÖRBAR', 'TRIM PUMPS RUNNING · AUDIBLE'],
  ['SCHNELLTAUCHEN · FLUTEN UND KLAPPERN IM BOOT', 'CRASH DIVE · FLOODING AND RATTLING IN THE BOAT'],
  ['SCHIFF SCHWER GETROFFEN · FÄLLT ZURÜCK', 'SHIP BADLY HIT · FALLING BEHIND'],
  ['IM WURFFELD', 'IN THE PATTERN'], ['ZU NAH · UNTER 1,8 KM', 'TOO CLOSE · UNDER 1.8 KM'], ['Werfer leer', 'Mortar empty'],
  ['Salve 400–800 m voraus geworfen', 'salvo thrown 400–800 m ahead'],
  ['TRÄGT EINEN LEICHTGEWICHTSTORPEDO 1,8–18 KM WEIT, FLUGZEIT CA. 40 S, STREUUNG ETWA 150 M. DER TORPEDO SUCHT AKTIV IM KREIS, ÜBER UND UNTER DER GEMESSENEN SCHICHT.',
    'CARRIES A LIGHTWEIGHT TORPEDO 1.8–18 KM, FLIGHT ABOUT 40 S, SCATTER ABOUT 150 M. THE TORPEDO SEARCHES ACTIVELY IN CIRCLES, ABOVE AND BELOW THE MEASURED LAYER.'],
];

export const EN_WEAPONS_PHRASES: [RegExp, string][] = [
  [/^LÄDT (\d+) %\/H$/, 'CHARGING $1 %/H'], [/^(\d+:\d\d(?::\d\d)?) · (\d+) SM$/, '$1 · $2 NM'],
  [/^ZU SCHNELL · AUF (\d+) KN$/, 'TOO FAST · TO $1 KN'], [/^ZU TIEF · AUF (\d+) M$/, 'TOO DEEP · TO $1 M'],
  [/^Abschuss nur bis (\d+) kn \(jetzt (\d+) kn\)$/, 'Launch only up to $1 kn (now $2 kn)'],
  [/^Abschuss nur bis (\d+) m Tiefe \(jetzt (\d+) m\)$/, 'Launch only down to $1 m depth (now $2 m)'],
  [/^(\d) TORPEDOS · FÄCHER (\d+)°$/, '$1 TORPEDOES · SPREAD $2°'],
  [/^Batterie bei (\d+) %: bei 4 kn etwa (\d+) h getaucht, bei 10 kn etwa (\d+),(\d) h; Schnorcheln lädt$/, 'Battery at $1 %: about $2 h submerged at 4 kn, about $3.$4 h at 10 kn; snorkelling charges'],
  [/^Werfer: noch (\d+) Salven$/, 'Mortar: $1 salvos left'],
  [/^(\d+) \/ (\d+) M \(SCHICHT (\d+) M\)$/, '$1 / $2 M (LAYER $3 M)'], [/^(\d+) \/ (\d+) M · SCHICHT NICHT GEMESSEN \(BT\)$/, '$1 / $2 M · LAYER NOT MEASURED (BT)'],
  [/ · BUG AUF DAS ZIEL, 400–800 M$/, ' · BOW ON THE TARGET, 400–800 M'],
];
