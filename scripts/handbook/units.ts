import { BIO_KINDS, BIO_SOURCE, CLASSES, SIGNATURES, createLoadout, type BioKind, type ClassId } from '@tk/shared';

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
    text: 'Dampfturbinen-Fregatte älterer Bauart mit einem Sonarkörper, der an einem Kabel unter die Sprungschicht gefiert wird. Damit hört und pingt sie dort, wo sich U-Boote verstecken. Kein Hubschrauber.',
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
    text: 'Sehr klein, extrem leise und wendig, nur 200 m Tauchtiefe. Acht Bugrohre, aber keine Reservetorpedos: Was verschossen ist, ist weg. Ideal für flaches Wasser, Fjorde und Meerengen.',
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
    text: 'Schleppt mit 4–6 kn ein Netz und wechselt alle Viertelstunde den Kurs. Laut für seine Größe, viele Lichter. Im Schelf oft zu mehreren.',
    tips: ['Starke Linie bei 30 Hz, hohe Drehzahl für kleine Fahrt: schnell als Trawler zu erkennen.', 'Sein Netz kann Schleppsonare abreißen.'],
  },
  {
    cls: 'tanker', side: 'Neutral', role: 'Supertanker (VLCC)',
    text: 'Riesig, tiefgehend und träge: Wendekreis fast drei Kilometer, Brücke und Schornstein ganz achtern. Ein langsam drehender Zweitakt-Diesel treibt eine große Schraube – der lauteste Kontakt im Gebiet, sehr tiefe Linien.',
    tips: ['Feuerrate des Diesels um 9 Hz, Blattfrequenz nur wenige Hertz: DEMON im 0–15-Hz-Band.', 'Ein U-Boot im Kielwasser eines Tankers ist fast nicht zu hören.'],
  },
  {
    cls: 'container', side: 'Neutral', role: 'Containerschiff',
    text: 'Schnell (um 20 kn) und laut, Brücke drei Viertel achtern, bunte Containerstapel. Fährt geradeaus auf einer Handelsroute und hält nicht an.',
    tips: ['Hohe Fahrt bei niedriger Drehzahl: 6-Blatt-Schraube, Linien 12/60/120 Hz.', 'Schnell wandernde Peilung – nicht mit einem anlaufenden Kriegsschiff verwechseln.'],
  },
  {
    cls: 'faehre', side: 'Neutral', role: 'RoRo-Fähre',
    text: 'Weiß, hoch, mit zwei Schornsteinen und zwei Wellen. Pendelt zügig auf festen Linien zwischen Häfen, vor allem im Schelf und in Fjorden.',
    tips: ['Zwei Wellen mit Mittelschnellläufern: viele Linien zwischen 30 und 70 Hz.', 'Nachts hell erleuchtet und weithin sichtbar.'],
  },
  {
    cls: 'schlepper', side: 'Neutral', role: 'Hochseeschlepper',
    text: 'Klein und kräftig, Brücke vorn, Schleppbogen achtern. Sehr laut für seine Größe, hohe Wellendrehzahl.',
    tips: ['Starke Linie bei 40 Hz und hohe Drehzahl je Knoten.'],
  },
  {
    cls: 'yacht', side: 'Neutral', role: 'Segelyacht',
    text: 'Unter Segeln fast lautlos; nur der kleine Hilfsdiesel ist schwach zu hören. Im Sehrohr gut an den Segeln zu erkennen.',
    tips: ['Leiser als jedes U-Boot – ein schwacher Kontakt mit 25-Hz-Linie und sehr hoher Drehzahl ist oft eine Yacht.'],
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
      k.team === 'west' && c.cls !== 'merchant' ? 'Radar, Funkpeilung, Ausguck' : '',
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

const BIO_INFO: Record<BioKind, { where: string; hint: string }> = {
  bio: { where: 'tiefes Wasser, Schelf', hint: 'Abwärts gleitende Pulse um 20 Hz in langen Folgen; keine Schraube.' },
  blauwal: { where: 'tiefes Wasser', hint: 'Sehr tiefe, lange Rufe um 17 Hz mit Oberton bei 35 Hz.' },
  buckelwal: { where: 'Schelf, tiefes Wasser', hint: 'Gesang mit wechselnden Tönen zwischen 100 und 300 Hz.' },
  pottwal: { where: 'über tiefem Wasser, taucht 400 m und tiefer', hint: 'Laute Klicks; im DEMON eine langsame „Drehzahl“ um 1 Hz, keine Linien. Tiefer Kontakt – nicht mit einem U-Boot verwechseln.' },
  orca: { where: 'überall, nahe der Oberfläche', hint: 'Pfiffe und Rufe am oberen Rand des LOFAR, schnelle Klickfolgen im DEMON.' },
  delfine: { where: 'überall, Oberfläche', hint: 'Schwache hohe Pfiffe, sehr schnelle Klickfolgen; wandert schnell.' },
  garnelen: { where: 'flacher Grund (unter 120 m)', hint: 'Breitbandiges Knistern ohne Linien und ohne Bewegung: ein ortsfester „Kontakt“ am Grund.' },
};

/** Biological contacts: what they sound like and where they live. */
export function bioTable(): string {
  return `<table class="grid"><tr><th>Quelle</th><th>Lebensraum</th><th>Lautstärke*</th><th>Erkennen</th></tr>${BIO_KINDS.map((k) =>
    `<tr><td><b>${SIGNATURES[k].name}</b></td><td>${BIO_INFO[k].where}</td><td>${BIO_SOURCE[k].sl} dB</td><td>${BIO_INFO[k].hint}</td></tr>`).join('')}</table>
  <p class="small">* Quellpegel im Spiel. Reale Werte (Wikipedia): Finnwal 155–186 dB, Blauwal bis 188 dB, Pottwal-Klicks bis 236 dB (vor allem im Kilohertzbereich), Knallkrebse 185–190 dB je Knall.</p>`;
}

const AIR: { file: string; name: string; who: string; alt: string; kn: string; text: string }[] = [
  { file: 'air-helo', name: 'Bordhubschrauber', who: 'Westbund (F-12)', alt: '25–120 m', kn: '120', text: 'Wirft Sonarbojen und Leichttorpedos, taucht sein Sonar, fliegt das MAD-Kleeblatt. Ohne eigenes Radar; dem U-Boot verrät er sich durch Rotorlärm und im Sehrohr.' },
  { file: 'air-mpa', name: 'Seeaufklärer', who: 'Westbund (auf Anforderung)', alt: '300 m (MAD 60 m)', kn: '300', text: 'Vier Turboprops, Magnetsonde im Heck. Legt Bojenketten; sein Suchradar ist eingeschaltet und für jedes U-Boot mit ausgefahrenem Mast auf große Entfernung im ESM zu hören.' },
  { file: 'air-recon', name: 'Fernaufklärer', who: 'Ostpakt', alt: '1500 m, über dem Konvoi 300 m', kn: '330', text: 'Kommt etwa alle 40–60 Minuten, sucht mit eingeschaltetem Radar, kreist fünf Minuten tief über dem Konvoi und meldet Position, Kurs und Fahrt über die Führung an die U-Boote. Die Eskorte sieht ihn im Radar und hört sein Radar im ESM – abschießen kann sie ihn nicht.' },
  { file: 'air-airliner', name: 'Verkehrsflugzeug', who: 'Neutral', alt: '9–11,5 km', kn: '440–480', text: 'Kreuzt auf Luftstraßen. Bei Tag am Kondensstreifen bis 45 km zu sehen, nachts an den Lichtern; im Luftraumradar weit über den Horizont hinaus.' },
  { file: 'air-light', name: 'Kleinflugzeug', who: 'Neutral', alt: '500–1100 m', kn: '110', text: 'Hochdecker im Küstenverkehr, vor allem über Schelf und Fjord. Klein und nur auf wenige Kilometer zu sehen.' },
];

/** Aircraft: pictures and what each sensor makes of them. */
export function airCards(): string {
  return `<table class="grid"><tr><th></th><th>Typ</th><th>Seite</th><th>Höhe</th><th>kn</th><th>Rolle und Erkennung</th></tr>${AIR.map((a) =>
    `<tr><td style="width:34mm"><img src="img/${a.file}.png" alt="" style="width:32mm"></td><td><b>${a.name}</b></td><td>${a.who}</td><td>${a.alt}</td><td>${a.kn}</td><td>${a.text}</td></tr>`).join('')}</table>
  <table class="grid"><tr><th>Sensor</th><th>Was er von Flugzeugen liefert</th></tr>
  <tr><td>Luft-/Seeraumradar</td><td>Position, Höhe, Kurs und Fahrt bis zum Radarhorizont, der mit der Flughöhe wächst (Verkehrsflugzeuge weit über 100 km). Bereich 48 SM im Radarraum.</td></tr>
  <tr><td>Ausguck / Sehrohr</td><td>Bei Tag nach Größe (Verkehrsflugzeug am Kondensstreifen), nachts nur an den Lichtern. Auf der Brücke schwenkt „Luft“ auf jedes sichtbare Flugzeug und folgt ihm mit dem Höhenwinkel.</td></tr>
  <tr><td>ESM</td><td>Nur Peilung, aber auf die doppelte Radarreichweite: Seeaufklärer und Fernaufklärer verraten sich durch ihr Radar. Für ein U-Boot heißt das: Mast einfahren.</td></tr>
  <tr><td>Datalink</td><td>Eigene Flugzeuge immer (U-Boote nur mit ausgefahrenem Mast).</td></tr></table>`;
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
