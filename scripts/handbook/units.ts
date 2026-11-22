import { CLASSES, SIGNATURES, createLoadout, type ClassId } from '@tk/shared';

/**
 * Unit reference cards for the handbook, generated from the game's own class tables so the
 * numbers in print always match the simulation.
 */

interface Card { cls: ClassId; role: string; side: string; text: string; tips: string[] }

const CARDS: Card[] = [
  {
    cls: 'ffg', side: 'Westbund', role: 'U-Jagd-Fregatte mit Bordhubschrauber',
    text: 'Das Rückgrat der Sicherung: kräftiges Rumpfsonar, langes Schleppsonar und ein Hubschrauber mit Sonarbojen, Tauchsonar, Leichttorpedo und Magnetsonde (MAD). Laut bei hoher Fahrt (Gasturbine).',
    tips: ['Mit 10–12 kn und ausgebrachtem Schleppsonar horchen, nach jedem Kurswechsel 60 s stabilisieren.', 'Den Hubschrauber an die Spitze der Peilung schicken; das Tauchsonar unter die Schicht senken.', 'Raketen erst mit Entfernung (Aktivsonar, Kreuzpeilung, Boje) einsetzen.'],
  },
  {
    cls: 'ffv', side: 'Westbund', role: 'U-Jagd-Fregatte mit Tiefensonar (VDS)',
    text: 'Leiser dieselelektrischer Antrieb und ein Sonarkörper, der an einem Kabel unter die Sprungschicht gefiert wird. Damit hört und pingt sie dort, wo sich U-Boote verstecken. Kein Hubschrauber.',
    tips: ['Im Sonarraum „VDS absenken“: der Körper geht 40 m unter die gemessene Schicht (vorher BT werfen).', 'Über 18 kn wird der VDS automatisch eingeholt.', 'Der VDS schließt den blinden Fleck unter dem eigenen Rumpf.'],
  },
  {
    cls: 'kor', side: 'Westbund', role: 'Geleitkorvette',
    text: 'Klein, wendig und leise, aber mit kurzem Schleppsonar, schwächerem Rumpfsonar und ohne Hubschrauber. Ideal als Flankensicherung und für die schnelle Verfolgung eines Kontakts.',
    tips: ['Flanke des Konvois sichern, Kontakte an die Fregatte melden.', 'Wasserbomben auf kurze Entfernung, Torpedorohre für den Gegenangriff.'],
  },
  {
    cls: 'ssn', side: 'Ostpakt', role: 'Atom-U-Boot',
    text: 'Schnell und unbegrenzt ausdauernd, mit Schleppsonar und 16 schweren Torpedos. Bei hoher Fahrt und geringer Tiefe laut (Kavitation, Reaktorpumpen).',
    tips: ['Weit vorauslaufen, dann langsam (unter 6 kn) und tief auf die Konvoibahn warten.', 'Das Schleppsonar hört weiter als jede Fregatte – nutzen, solange der Kurs gerade ist.'],
  },
  {
    cls: 'ssk', side: 'Ostpakt', role: 'Diesel-U-Boot',
    text: 'Auf Batterie das leiseste Boot im Spiel, aber mit begrenzter Ausdauer: Schnorcheln lädt, verrät das Boot aber durch Dieselgeräusch, Mast und Radar.',
    tips: ['Batterie über 50 % halten; schnorcheln, solange keine Eskorte in der Nähe ist.', 'Langsam vor dem Konvoi lauern statt hinterherzulaufen.'],
  },
  {
    cls: 'ssc', side: 'Ostpakt', role: 'Küsten-U-Boot',
    text: 'Sehr klein, extrem leise und wendig, nur 200 m Tauchtiefe und 4 Rohre. Ideal für flaches Wasser, Fjorde und Meerengen.',
    tips: ['Im Flachwasser nah am Grund bleiben – der Nachhall verdeckt das Echo.', 'Wenige Torpedos: nur auf gute Lösungen schießen.'],
  },
  {
    cls: 'ssa', side: 'Ostpakt', role: 'U-Boot mit außenluftunabhängigem Antrieb (AIP)',
    text: 'Fast so leise wie das Diesel-U-Boot, aber bis 5 kn ohne Batterieverbrauch. Muss nur zum schnellen Laufen schnorcheln. Ein schwacher 400-Hz-Ton der Stromrichter kann es verraten.',
    tips: ['Unter 5 kn unbegrenzt lauern; Batterie für Angriff und Flucht sparen.', 'Für die Klassifizierung: LOFAR-Linie bei 400 Hz, 7-Blatt-Schraube.'],
  },
  {
    cls: 'merchant', side: 'Konvoi', role: 'Frachter',
    text: 'Das Ziel der Partie. Laut und langsam, mit starken Linien bei 50/100/150 Hz. Fährt im Zickzack und weicht bei Angriffen aus. Nachts mit Positionslichtern, bis eine Bedrohung gemeldet wird.',
    tips: ['Der Lärm des Konvois überdeckt leisere Kontakte in derselben Peilung.'],
  },
  {
    cls: 'fischer', side: 'Neutral', role: 'Fischtrawler',
    text: 'Neutraler Verkehr, der als Zwischenfall auftaucht: langsam, laut, mit drei- oder vierflügeliger Schraube und vielen Lichtern. Neutrale Schiffe nie angreifen.',
    tips: ['Starke Linie bei 30 Hz, hohe Drehzahl für kleine Fahrt: schnell als Trawler zu erkennen.'],
  },
];

const fmt = (n: number) => n.toLocaleString('de-DE');

export function unitCards(): string {
  return CARDS.map((c) => {
    const k = CLASSES[c.cls];
    const sig = SIGNATURES[c.cls];
    const l = createLoadout(c.cls);
    const loaded = l.tubes.filter((t) => t.loaded).length;
    const heavy = l.heavy + (k.submarine ? loaded : 0);
    const light = l.light + (k.submarine ? 0 : loaded);
    const weapons = [
      l.tubes.length ? `${l.tubes.length} Rohre` : '',
      k.submarine && heavy ? `${heavy} schwere Torpedos` : '',
      !k.submarine && light ? `${light} leichte Torpedos` : '',
      l.rockets ? `${l.rockets} U-Jagd-Raketen` : '',
      l.depthCharges ? `${l.depthCharges} Wasserbomben` : '',
      l.noisemakers ? `${l.noisemakers} Täuschkörper` : '',
      l.xbt ? `${l.xbt} BT-Sonden` : '',
    ].filter(Boolean).join(' · ') || '—';
    const sensors = [
      k.hull.di > 0 ? `Rumpfsonar (Bündelung ${k.hull.di} dB${k.hull.activeSl ? ', aktiv' : ''})` : '',
      k.towed ? `Schleppsonar ${fmt(k.towed.maxLength)} m (bis ${k.towed.maxSpeedKn} kn)` : '',
      k.vds ? `Tiefensonar bis ${k.vds.maxDepth} m (bis ${k.vds.maxSpeedKn} kn)` : '',
      c.cls === 'ffg' ? 'Bordhubschrauber' : '',
      !k.submarine && c.cls !== 'merchant' && c.cls !== 'fischer' ? 'Radar, Funkpeilung, Ausguck' : '',
      k.submarine ? 'Sehrohr, Funkpeilung (ESM)' : '',
    ].filter(Boolean).join(' · ') || '—';
    const rows: [string, string][] = [
      ['Seite', c.side],
      ['Verdrängung', `${fmt(k.tonnage)} t`],
      ['Höchstfahrt', `${k.maxSpeedKn} kn`],
      ['Wendekreis', `${fmt(k.turnRadius * 2)} m`],
      k.submarine ? ['Tauchtiefe', `${k.maxDepth} m`] : ['Tiefgang', `${k.draft} m`],
      k.cavKn ? ['Kavitation ab', `${k.cavKn} kn an der Oberfläche, +${k.cavDepthKn} kn je 100 m Tiefe`] : ['Antrieb', sig.name.replace(/^.*\(|\)$/g, '')],
      k.battery ? ['Batterie', `${k.battery.capacityKnH} kn·h${k.aipKn ? ` · AIP bis ${k.aipKn} kn` : ''}`] : ['Ausdauer', 'unbegrenzt'],
      ['Sensoren', sensors],
      ['Bewaffnung', weapons],
      ['Signatur', `${sig.blades[0]}-Blatt-Schraube · Linien ${sig.tonals.map((t) => `${t.hz} Hz`).join(', ') || '—'}${sig.snorkelTonals ? ` · Schnorchel ${sig.snorkelTonals.map((t) => `${t.hz}`).join('/')} Hz` : ''}`],
      ['Klasse im Sonar', { merchant: 'Handelsschiff', warship: 'Kriegsschiff', submarine: 'U-Boot', torpedo: 'Torpedo', bio: 'Biologisch', unknown: 'Unbekannt' }[sig.choice]],
    ];
    return `<section class="unit">
      <h3>${k.name}<span class="role">${c.role}</span></h3>
      <img src="img/${c.cls}.png" alt="${k.name}">
      <div class="unit-body">
        <table class="data">${rows.map(([a, b]) => `<tr><th>${a}</th><td>${b}</td></tr>`).join('')}</table>
        <div><p>${c.text}</p><ul>${c.tips.map((t) => `<li>${t}</li>`).join('')}</ul></div>
      </div>
    </section>`;
  }).join('\n');
}

/** Short comparison table of all playable classes. */
export function unitTable(): string {
  const ids: ClassId[] = ['ffg', 'ffv', 'kor', 'ssn', 'ssk', 'ssc', 'ssa'];
  return `<table class="grid"><tr><th>Klasse</th><th>t</th><th>kn</th><th>Tiefe</th><th>Lärm*</th><th>Stärke</th></tr>${ids.map((id) => {
    const k = CLASSES[id];
    const strengths: Record<string, string> = {
      ffg: 'Hubschrauber, Bojen', ffv: 'VDS unter der Schicht', kor: 'wendig, leise', ssn: 'Tempo, Ausdauer', ssk: 'sehr leise', ssc: 'Flachwasser', ssa: 'leise und ausdauernd',
    };
    return `<tr><td>${k.name}</td><td>${fmt(k.tonnage)}</td><td>${k.maxSpeedKn}</td><td>${k.submarine ? `${k.maxDepth} m` : '—'}</td><td>${k.slBase} dB</td><td>${strengths[id]}</td></tr>`;
  }).join('')}</table><p class="small">* Quellpegel bei Marschfahrt (${'U-Boote 4–5 kn, Überwasserschiffe 15 kn'}). Je 6 dB weniger halbiert etwa die Entfernung, auf die man gehört wird.</p>`;
}
