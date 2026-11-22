/** German → English phrase rules for damage-control reports (compartment names inside sentences). */
const PLACE: [string, string][] = [
  ['IM BUG-/TORPEDORAUM', 'IN THE BOW/TORPEDO ROOM'], ['IM BUGRAUM', 'IN THE BOW ROOM'], ['IM TORPEDORAUM', 'IN THE TORPEDO ROOM'], ['IN DER ZENTRALE', 'IN THE CONTROL ROOM'],
  ['IM REAKTORRAUM', 'IN THE REACTOR ROOM'], ['IM WOHNRAUM', 'IN THE ACCOMMODATION'], ['IM MASCHINENRAUM', 'IN THE ENGINE ROOM'], ['IM HECKRAUM', 'IN THE STERN ROOM'],
  ['IM VORSCHIFF', 'IN THE FORE SECTION'], ['IM MAGAZIN', 'IN THE MAGAZINE'], ['IN DER OPZ', 'IN THE CIC'], ['IN DER MASCHINE', 'IN THE MACHINERY'],
  ['IM ACHTERSCHIFF', 'IN THE AFT SECTION'], ['IM LADERAUM 1', 'IN HOLD 1'], ['IM LADERAUM 2', 'IN HOLD 2'], ['IM RUMPF', 'IN THE HULL'],
];
const WHAT: [string, string][] = [
  ['WASSEREINBRUCH', 'FLOODING'], ['FEUER GELÖSCHT', 'FIRE OUT'], ['LECK ABGEDICHTET', 'LEAK PLUGGED'], ['MUNITION DETONIERT', 'AMMUNITION EXPLODED'], ['FEUER', 'FIRE'],
];

export const EN_DAMAGE_PHRASES: [RegExp, string][] = [
  ...WHAT.flatMap(([w, we]) => PLACE.map(([p, pe]) => [new RegExp(`^${w} ${p.replace(/[/-]/g, '\\$&')}$`), `${we} ${pe}`] as [RegExp, string])),
  [/^EXPLOSION PEILUNG (\d+)$/, 'EXPLOSION BEARING $1'], [/^SINKGERÄUSCHE PEILUNG (\d+)$/, 'BREAKING-UP NOISES BEARING $1'],
];
