/** English for the listening-range prediction panel (widgets/range-panel.ts). */

const NAMES: [string, string][] = [['FREGATTE', 'FRIGATE'], ['FRACHTER', 'FREIGHTER'], ['WACHSCHIFF', 'PATROL SHIP'], ['U-BOOT', 'SUBMARINE']];

export const EN_RANGE: [string, string][] = [
  ['REICHWEITENVORHERSAGE', 'RANGE PREDICTION'], ['SCHICHT UNBEKANNT', 'LAYER UNKNOWN'], ['NUR GROBE SCHÄTZUNG', 'ROUGH ESTIMATE ONLY'],
  ['Y = EIGENE TIEFE', 'Y = OWN DEPTH'], ['SENKRECHT: EIGENE TIEFE', 'VERTICAL: OWN DEPTH'], ['SENKRECHT: TIEFE DES U-BOOTS', "VERTICAL: SUBMARINE'S DEPTH"], ['WAAGERECHT: ENTFERNUNG', 'HORIZONTAL: RANGE'], ['Y = TIEFE DES BOOTS', "Y = BOAT'S DEPTH"], ['EIGENES SCHIFF', 'OWN SHIP'], ['SCHATTENZONE', 'SHADOW ZONE'],
  ...NAMES.flatMap(([de, en]): [string, string][] => [
    [`GRÜN = ${de}`, `GREEN = ${en}`], [`BLASSGRÜN = ${de}`, `PALE GREEN = ${en}`], [`ROT = ${de} HÖRT UNS`, `RED = ${en} HEARS US`],
    [`GRÜN: HIER HÖREN WIR ${de}`, `GREEN: HERE WE HEAR A ${en}`], [`BLASSGRÜN: HIER HÖREN WIR ${de}`, `PALE GREEN: HERE WE HEAR A ${en}`], [`ROT: HIER HÖRT ${de} UNS`, `RED: HERE THE ${en} HEARS US`],
  ]),
];

export const EN_RANGE_PHRASES: [RegExp, string][] = [
  [/WIRD GEHÖRT BIS ~/g, 'HEARD BY THEM TO ~'], [/WIRD GEHÖRT (\d)/g, 'HEARD BY THEM $1'],
  [/\bHÖRT (FREGATTE|FRACHTER|WACHSCHIFF|U-BOOT) /g, 'HEARS $1 '],
  ...NAMES.map(([de, en]): [RegExp, string] => [new RegExp(`\\b${de}(?= BIS ~| \\d+–\\d+ KM JE NACH TIEFE)`, 'g'), en]),
  [/ BIS ~(\d+) KM/g, ' TO ~$1 KM'], [/ KM JE NACH TIEFE/g, ' KM BY DEPTH'], [/\bKONVERGENZZONE (\d)/g, 'CONVERGENCE ZONE $1'], [/\bSCHATTENZONE (\d)/g, 'SHADOW ZONE $1'], [/^(\d)\. KZ$/, 'CZ $1'],
  // Doppler of a tonal (analysis, waterfall) and the cavitation limit (helm, Zentrale, recognition sheet)
  [/ HZ · NÄHERT/g, ' HZ · CLOSING'], [/ HZ · ENTFERNT SICH/g, ' HZ · OPENING'], [/ HZ · KEINE RADIALFAHRT/g, ' HZ · NO RADIAL MOTION'],
  [/\bKAV AB /g, 'CAV FROM '], [/^KAV (\d+)$/, 'CAV $1'], [/ KN SEHROHRTIEFE · /g, ' KN PERISCOPE DEPTH · '], [/ KN AUF 150 M\b/g, ' KN AT 150 M'],
  [/· HÖREN ([+\-\d—])/g, '· WE HEAR $1'], [/· GEHÖRT ([+\-\d—])/g, '· THEY HEAR $1'],
  [/^EIGENE TIEFE (\d+) M$/, 'OWN DEPTH $1 M'], [/^SCHICHT (\d+) M$/, 'LAYER $1 M'], [/^GRUND (\d+) M$/, 'BOTTOM $1 M'], [/^TAUCHGRENZE (EIGENES BOOT|U-BOOT) · GRUND (\d+) M$/, 'DIVING LIMIT · BOTTOM $2 M'],
];
