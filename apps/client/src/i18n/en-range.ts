/** English for the listening-range prediction panel (widgets/range-panel.ts). */

const NAMES: [string, string][] = [['FREGATTE', 'FRIGATE'], ['FRACHTER', 'FREIGHTER'], ['WACHSCHIFF', 'PATROL SHIP'], ['U-BOOT', 'SUBMARINE']];

export const EN_RANGE: [string, string][] = [
  ['REICHWEITENVORHERSAGE', 'RANGE PREDICTION'], ['SCHICHT UNBEKANNT', 'LAYER UNKNOWN'], ['NUR GROBE SCHÄTZUNG', 'ROUGH ESTIMATE ONLY'],
  ['Y = EIGENE TIEFE', 'Y = OWN DEPTH'], ['Y = TIEFE DES BOOTS', "Y = BOAT'S DEPTH"], ['EIGENES SCHIFF', 'OWN SHIP'],
  ...NAMES.flatMap(([de, en]): [string, string][] => [
    [`GRÜN = ${de}`, `GREEN = ${en}`], [`BLASSGRÜN = ${de}`, `PALE GREEN = ${en}`], [`ROT = ${de} HÖRT UNS`, `RED = ${en} HEARS US`],
  ]),
];

export const EN_RANGE_PHRASES: [RegExp, string][] = [
  [/WIRD GEHÖRT BIS ~/g, 'HEARD BY THEM TO ~'], [/WIRD GEHÖRT (\d)/g, 'HEARD BY THEM $1'],
  [/\bHÖRT (FREGATTE|FRACHTER|WACHSCHIFF|U-BOOT) /g, 'HEARS $1 '],
  ...NAMES.map(([de, en]): [RegExp, string] => [new RegExp(`\\b${de}(?= BIS ~| \\d+–\\d+ KM JE NACH TIEFE)`, 'g'), en]),
  [/ BIS ~(\d+) KM/g, ' TO ~$1 KM'], [/ KM JE NACH TIEFE/g, ' KM BY DEPTH'], [/\bKONVERGENZZONE (\d)/g, 'CONVERGENCE ZONE $1'],
  [/· HÖREN ([+\-\d—])/g, '· WE HEAR $1'], [/· GEHÖRT ([+\-\d—])/g, '· THEY HEAR $1'],
  [/^EIGENE TIEFE (\d+) M$/, 'OWN DEPTH $1 M'], [/^SCHICHT (\d+) M$/, 'LAYER $1 M'], [/^GRUND (\d+) M$/, 'BOTTOM $1 M'],
];
