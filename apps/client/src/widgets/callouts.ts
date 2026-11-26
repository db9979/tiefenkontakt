import { CLASSES, angleDiff, isDangerEmitter, type AlertView, type Snapshot, type StationId } from '@tk/shared';
import { announce } from '../a11y.js';
import { audio } from '../audio.js';
import { lang } from '../i18n/index.js';
import { store } from '../store.js';
import { EsmThrottle } from './esm-throttle.js';
import { tdeg3 } from './format.js';
import { isFriendlyContact } from './friendly.js';
import { pushLog } from './log-group.js';

/**
 * Crew reports: watches successive snapshots and announces what changed, spoken with the
 * browser's speech synthesis (German or English) and written to the event log.
 */

export interface LogEntry {
  time: number;
  text: string;
  level: 'info' | 'warn' | 'alarm';
  label?: string;
  /** Station that deals with it (a click in the log goes there). */
  station?: StationId;
  /** New-contact report: bursts of these are listed as one line (groupLog). */
  group?: 'contact';
  /** Orders and signals from command: kept when the log is full (pings and the like go first). */
  keep?: boolean;
  /** Folded row (groupLog): how many alike reports it stands for. */
  count?: number;
}


const en = lang === 'en';
const L = (de: string, enText: string) => (en ? enText : de);
/** Game-frame direction → three true digits (every caller here passes an absolute bearing or course). */
const deg3 = (b: number) => tdeg3(b);
/** Naval digit reading of a game-frame direction in true degrees: "zwo-eins-null" / "two-one-zero". */
function digits(b: number): string {
  const d = deg3(b);
  const de = ['null', 'eins', 'zwo', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun'];
  const e = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];
  return [...d].map((c) => (en ? e : de)[Number(c)]).join('-');
}

export function voiceOn(): boolean {
  return localStorage.getItem('tk_voice') !== '0';
}

let voice: SpeechSynthesisVoice | undefined;
function pickVoice(): void {
  const all = typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices() : [];
  voice = all.find((v) => v.lang.startsWith(en ? 'en' : 'de') && /\bmale\b|Markus|Yannick|Flo|Eddy|Reed|Rocko|Daniel|Alex|Arthur|Oliver/i.test(v.name)) ??
    all.find((v) => v.lang.startsWith(en ? 'en' : 'de'));
}
if (typeof speechSynthesis !== 'undefined') {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

function say(text: string, urgent: boolean): void {
  if (!voiceOn() || audio.muted || typeof speechSynthesis === 'undefined') return;
  if (urgent) speechSynthesis.cancel();
  else if (speechSynthesis.pending) return; // never build a backlog of stale reports
  const u = new SpeechSynthesisUtterance(text);
  u.lang = en ? 'en-GB' : 'de-DE';
  if (voice) u.voice = voice;
  u.rate = urgent ? 1.15 : 1.05;
  u.pitch = 0.9;
  u.volume = Math.min(1, audio.volume * 1.4);
  speechSynthesis.speak(u);
}

const LEVEL: Record<string, LogEntry['level']> = { flash: 'alarm', command: 'info', boat: 'warn', sighting: 'warn', torpedo: 'alarm', sunk: 'alarm', ping: 'warn', esm: 'warn', transient: 'warn', hit: 'info' };

export class Callouts {
  private esm = new EsmThrottle();
  private pings = new EsmThrottle();

  reset(): void {
    this.esm.clear();
    this.pings.clear();
    this.log = [];
    this.prev = undefined;
    this.known.clear();
    this.spokenMast = false;
    this.spokenBattery = false;
    this.depthPending = undefined;
    this.coursePending = undefined;
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }

  log: LogEntry[] = [];
  private prev?: Snapshot;
  private known = new Set<string>();
  private spokenMast = false;
  private spokenBattery = false;

  private report(s: Snapshot, e: Omit<LogEntry, 'time'>, spoken: string): void {
    pushLog(this.log, { ...e, time: s.time });
    if (e.level !== 'alarm') audio.chime(e.level === 'warn' ? 'warn' : 'info');
    say(spoken, e.level === 'alarm');
    announce(e.text, e.level);
  }

  update(s: Snapshot): void {
    const p = this.prev;
    this.prev = s;
    // First snapshot, or a full one after a reconnect: the gap's alerts arrive at once
    if (!p || s.full) {
      for (const c of s.contacts) this.known.add(c.label);
      // After a reconnect the recent alerts arrive at once: list them, don't speak them
      for (const a of s.alerts) if (!p || a.time > p.time) pushLog(this.log, { time: a.time, text: a.text, level: LEVEL[a.kind] ?? 'info', keep: a.kind === 'command' || a.kind === 'flash' });
      return;
    }
    const sub = CLASSES[s.own.cls].submarine;
    const sonar: StationId = sub ? 'horch' : 'sonar';
    // New contacts (own sensors only; datalink tracks are not "our" reports)
    for (const c of s.contacts) {
      if (this.known.has(c.label) || c.via !== 'own') continue;
      // Lookout sightings are announced by their own report below
      if (c.sensors.includes('visual')) {
        this.known.add(c.label);
        continue;
      }
      this.known.add(c.label);
      // Own and allied ships the datalink already accounts for are no news (F7)
      if (isFriendlyContact(c, s)) continue;
      this.report(s, { level: 'info', text: L(`Neuer Kontakt ${c.label}, Peilung ${deg3(c.bearing)}°`, `New contact ${c.label}, bearing ${deg3(c.bearing)}°`), label: c.label, station: sonar, group: 'contact' },
        en ? `New contact ${c.label}, bearing ${digits(c.bearing)}` : `Neuer Kontakt ${c.label}, Peilung ${digits(c.bearing)}`);
    }
    // Server alerts that are new in this snapshot
    for (const a of s.alerts.filter((x) => x.time > p.time)) {
      const b = a.bearing !== undefined ? digits(a.bearing) : '';
      if (a.kind === 'torpedo') {
        const text = store.realism === 'profi' ? `HOCHFREQUENTES SCHRAUBENGERÄUSCH, SCHNELL WANDERND · PEILUNG ${deg3(a.bearing ?? 0)}°` : a.text;
        this.report(s, { level: 'alarm', text, station: sub ? 'feuerleitung' : 'waffen' }, en ? `Torpedo in the water! Bearing ${b}!` : `Torpedo im Wasser! Peilung ${b}!`);
      } else if (a.kind === 'sighting') {
        this.report(s, { level: 'warn', text: a.text, label: a.label, station: sub ? 'sehrohr' : 'bruecke' }, sightingCall(a, s.own.heading));
      } else if (a.kind === 'command') {
        this.report(s, { level: 'info', text: a.text, station: sub ? 'zentrale' : undefined, keep: true }, en ? 'Signal from fleet command received.' : 'Funkspruch der Führung empfangen.');
      } else if (a.kind === 'boat') {
        const urgent = /KOLLABIERT|RISS|DICHTUNG|BOLZEN|VERPUFFT|BRAND|WASSEREINBRUCH|^FEUER (IM|IN|GREIFT)|MUNITION|AUFTRIEB|SINKT|SACKT/.test(a.text);
        this.report(s, { level: urgent ? 'alarm' : 'warn', text: a.text, station: undefined }, boatCall(a.text));
      } else if (a.kind === 'ping') {
        // A pinger on the same bearing every 30 s: report it once, again when it gets louder or after 2 minutes
        if (!this.pings.report({ time: a.time, bearing: a.bearing, emitter: 'PING', esmLvl: Math.floor((a.level ?? 0) / 10) }, false)) continue;
        this.report(s, { level: 'warn', text: a.text }, en ? `Active sonar, bearing ${b}. We are being pinged.` : `Aktivsonar, Peilung ${b}. Wir werden angepingt.`);
      } else if (a.kind === 'transient') {
        const blast = /WASSERBOMBE|DETONATION/.test(a.text);
        this.report(s, { level: 'warn', text: a.text, station: sonar }, blast ? (en ? `Underwater explosion, bearing ${b}.` : `Unterwasserdetonation, Peilung ${b}.`) : en ? `Transient, bearing ${b}. Possible torpedo launch.` : `Transient, Peilung ${b}. Möglicher Torpedoabschuss.`);
      } else if (a.kind === 'hit') {
        this.report(s, { level: 'info', text: a.text }, en ? `Explosion, bearing ${b}.` : `Explosion, Peilung ${b}.`);
      } else if (a.kind === 'esm') {
        // The same radar on the same bearing only when new, stronger, closing or after a quiet spell
        if (!this.esm.report(a, isDangerEmitter(a.emitter))) continue;
        this.report(s, { level: 'warn', text: a.text }, en ? `Radar intercept, bearing ${b}.` : `Radarpeilung, Peilung ${b}.`);
      } else if (a.kind === 'sunk' || a.kind === 'flash') {
        // FLASH orders: the orders panel sounds the teletype alarm and speaks
        pushLog(this.log, { time: a.time, text: a.text, level: 'alarm', keep: true });
      }
    }
    const o = s.own;
    const po = p.own;
    if (o.hp < po.hp - 0.5 && o.alive) {
      this.report(s, { level: 'alarm', text: L('Treffer! Schadensmeldung abwarten', 'Hit! Await damage report'), station: undefined }, en ? 'We are hit! Damage control!' : 'Treffer! Schadensabwehr!');
    }
    if (!o.alive && po.alive) say(en ? 'Abandon ship.' : 'Alle Mann von Bord.', true);
    // Ordered depth and course reached (only after an order change)
    if (Math.abs(o.order.depth - po.order.depth) > 0.5) this.depthPending = o.order.depth;
    if (this.depthPending !== undefined && Math.abs(o.depth - this.depthPending) < 1.5) {
      const d = Math.round(this.depthPending);
      this.depthPending = undefined;
      this.report(s, { level: 'info', text: L(`Tiefe ${d} m erreicht`, `Depth ${d} m reached`), station: sub ? 'zentrale' : undefined }, en ? `Depth ${d} metres.` : `${d} Meter eingesteuert.`);
    }
    if (Math.abs(o.order.heading - po.order.heading) > 0.5) this.coursePending = o.order.heading;
    if (this.coursePending !== undefined && Math.abs(((o.heading - this.coursePending + 540) % 360) - 180) < 1.5) {
      const c = this.coursePending;
      this.coursePending = undefined;
      this.report(s, { level: 'info', text: L(`Kurs ${deg3(c)}° liegt an`, `Steady on ${deg3(c)}°`) }, en ? `Steady on course ${digits(c)}.` : `Kurs ${digits(c)} liegt an.`);
    }
    // Own torpedoes
    for (const t of s.torpedoes) {
      const was = p.torpedoes.find((x) => x.id === t.id);
      if (was && !was.homing && t.homing) this.report(s, { level: 'info', text: L(`${t.id} hat Ziel erfasst`, `${t.id} has acquired`), station: sub ? 'feuerleitung' : 'waffen' }, en ? `Torpedo has acquired.` : `Torpedo hat Ziel erfasst.`);
      if (was?.wire && !t.wire) this.report(s, { level: 'warn', text: L(`${t.id}: Draht gerissen`, `${t.id}: wire cut`), station: sub ? 'feuerleitung' : 'waffen' }, en ? 'Wire cut.' : 'Draht gerissen.');
    }
    if (!p.own.towedReady && o.towedReady && o.towedLength > 0) {
      this.report(s, { level: 'info', text: L('Schleppsonar klar', 'Towed array steady'), station: sonar }, en ? 'Towed array is steady.' : 'Schleppsonar klar.');
    }
    // Exposure and endurance warnings, once each
    if (o.mastUp && o.mastUpSince !== undefined && s.time - o.mastUpSince > 60 && !this.spokenMast) {
      this.spokenMast = true;
      this.report(s, { level: 'warn', text: L('Mast seit einer Minute oben', 'Mast up for one minute'), station: 'sehrohr' }, en ? 'Mast up for one minute.' : 'Mast seit einer Minute oben.');
    }
    if (!o.mastUp) this.spokenMast = false;
    const cap = CLASSES[o.cls].battery?.capacityKnH;
    if (cap && o.battery !== undefined && o.battery / cap < 0.25 && !this.spokenBattery) {
      this.spokenBattery = true;
      this.report(s, { level: 'warn', text: L('Batterie unter 25 %', 'Battery below 25 %'), station: 'zentrale' }, en ? 'Battery below twenty-five percent.' : 'Batterie unter fünfundzwanzig Prozent.');
    }
    // Radio from teammates
    for (const r of s.radio.filter((x) => x.from !== o.name && x.time > p.time)) {
      this.report(s, { level: 'info', text: L(`Funkspruch von ${r.from}`, `Radio message from ${r.from}`) }, en ? `Radio message from ${r.from}.` : `Funkspruch von ${r.from}.`);
    }
  }

  private depthPending?: number;
  private coursePending?: number;
}

export const callouts = new Callouts();
export const selectFromLog = (label: string) => (store.selected = label);

const WHAT = { mast: ['Sehrohr', 'Periscope'], snorkel: ['Schnorchel', 'Snorkel'], surfaced: ['U-Boot aufgetaucht', 'Submarine on the surface'] } as const;

/** Lookout report as sailors call it: what, side and sector relative to the bow, bearing, rough range. */
function sightingCall(a: AlertView, heading: number): string {
  const rel = angleDiff(heading, a.bearing ?? heading);
  const side = rel >= 0 ? (en ? 'starboard' : 'Steuerbord') : (en ? 'port' : 'Backbord');
  const abs = Math.abs(rel);
  const sector = abs < 30 ? (en ? 'bow' : 'voraus') : abs < 150 ? (en ? 'beam' : 'querab') : (en ? 'quarter' : 'achteraus');
  const what = WHAT[a.what ?? 'mast'][en ? 1 : 0];
  const m = Math.max(100, Math.round((a.range ?? 0) / 100) * 100);
  const b = digits(a.bearing ?? 0);
  if (abs < 8) return en ? `${what} dead ahead! Bearing ${b}, about ${m} meters!` : `${what} recht voraus! Peilung ${b}, etwa ${m} Meter!`;
  return en ? `${what}, ${side} ${sector}! Bearing ${b}, about ${m} meters!` : `${what} ${side} ${sector}! Peilung ${b}, etwa ${m} Meter!`;
}

/** "IM MASCHINENRAUM" → "im Maschinenraum" (German), "in the engine room" (English via the UI dictionary). */
function spokenPlace(dat: string): string {
  return dat.split(' ').map((w, i) => (i === 0 || w === 'DER' ? w.toLowerCase() : w.length <= 3 ? w : w[0] + w.slice(1).toLowerCase())).join(' ');
}

/** Damage-control reports from the compartments, spoken grammatically. */
function damageCall(text: string): string | undefined {
  const m = /^(WASSEREINBRUCH|FEUER|FEUER GELÖSCHT|LECK ABGEDICHTET|MUNITION DETONIERT) ((?:IM|IN DER) .+)$/.exec(text);
  if (m) {
    const place = spokenPlace(m[2]!);
    const de: Record<string, string> = { WASSEREINBRUCH: 'Wassereinbruch', FEUER: 'Feuer', 'FEUER GELÖSCHT': 'Feuer gelöscht', 'LECK ABGEDICHTET': 'Leck abgedichtet', 'MUNITION DETONIERT': 'Munition detoniert' };
    const enw: Record<string, string> = { WASSEREINBRUCH: 'Flooding', FEUER: 'Fire', 'FEUER GELÖSCHT': 'Fire out', 'LECK ABGEDICHTET': 'Leak plugged', 'MUNITION DETONIERT': 'Ammunition exploded' };
    return en ? `${enw[m[1]!]}: ${m[2]!.replace(/^(IM|IN DER) /, '').toLowerCase()}!` : `${de[m[1]!]} ${place}!`;
  }
  const b = /^SCHOTT (GESCHLOSSEN|GEÖFFNET) · (.+)$/.exec(text);
  if (b) {
    const name = b[2]!.length <= 3 ? b[2]! : b[2]![0] + b[2]!.slice(1).toLowerCase();
    if (b[1] === 'GESCHLOSSEN') return en ? `Bulkheads closed, ${b[2]!.toLowerCase()} sealed off.` : `Schotten dicht, ${name} abgeschottet.`;
    return en ? `Bulkhead open, ${b[2]!.toLowerCase()}.` : `Schott offen, ${name}.`;
  }
  const f = /^FEUER GREIFT ÜBER · (.+)$/.exec(text);
  if (f) return en ? `Fire spreading to ${f[1]!.toLowerCase()}!` : `Feuer greift über auf ${f[1]![0] + f[1]!.slice(1).toLowerCase()}!`;
  return undefined;
}

/** Short spoken version of a crew report from the boat (the full text goes to the log). */
function boatCall(text: string): string {
  const dc = damageCall(text);
  if (dc) return dc;
  const t: [RegExp, string, string][] = [
    [/SCHLECHTE LUFT/, 'Schlechte Luft im Boot!', 'Foul air in the boat!'],
    [/VERWUNDETE/, 'Verwundete! Sanitäter!', 'Wounded! Medic!'],
    [/UNTER TESTTIEFE|BOLZEN|DICHTUNG|RISS/, 'Wassereinbruch! Wir sind zu tief!', 'Flooding! We are too deep!'],
    [/LÄRM IM BOOT/, 'Ruhe im Boot, verdammt!', 'Silence in the boat, damn it!'],
    [/MAD-KONTAKT/, 'MAD-Kontakt unter dem Hubschrauber!', 'MAD contact under the helicopter!'],
    [/VERPASST/, 'Funkspruch der Führung verpasst.', 'Missed the signal from command.'],
    [/WETTERWARNUNG/, 'Wetterwarnung: Front zieht auf.', 'Weather warning: a front is coming.'],
    [/TREIBNETZ/, 'Treibnetz!', 'Driftnet!'],
    [/RUDER/, 'Ruderversager!', 'Rudder failure!'],
    [/SCHNORCHEL/, 'Schnorchelventil klemmt!', 'Snorkel valve stuck!'],
    [/BATTERIE/, 'Batteriegas!', 'Battery gas!'],
    [/AUFTRIEB FAST VERLOREN/, 'Wir sinken! Alle Mann klar zum Aussteigen!', 'We are sinking! Stand by to abandon!'],
    [/AUFTRIEB VERLOREN/, 'Alle Mann von Bord!', 'Abandon ship!'],
    [/BOOT WIRD SCHWER/, 'Boot wird schwer! Fahrt aufnehmen oder anblasen!', 'Boat is getting heavy! Speed up or blow!'],
    [/SCHWERE SCHLAGSEITE/, 'Schwere Schlagseite!', 'Heavy list!'],
    [/LI BLÄST/, 'LI bläst an!', 'Chief is blowing the tanks!'],
    [/FLUGKÖRPER ABGEFEUERT/, 'Flugkörper abgefeuert!', 'Missile away!'],
    [/ZIEL ABGESCHOSSEN|AUFKLÄRER ABGESCHOSSEN/, 'Luftziel abgeschossen!', 'Splash one! Air target down!'],
    [/ZIEL VERFEHLT/, 'Flugkörper hat verfehlt.', 'Missile missed.'],
    [/RAKETENSTART/, 'Raketenstart in Sicht!', 'Missile launch in sight!'],
    [/ABFANGJÄGER ANGEFORDERT/, 'Abfangjäger sind angefordert.', 'Interceptors requested.'],
    [/KEIN ZIEL GEFUNDEN/, 'Abfangjäger ohne Ziel, Rückflug.', 'Interceptors found nothing, returning.'],
    [/MINENWARNUNG/, 'Mine voraus! Mine im Sonar!', 'Mine ahead! Mine on sonar!'],
  ];
  const hit = t.find(([re]) => re.test(text));
  return hit ? (en ? hit[2] : hit[1]) : en ? 'Report from the boat.' : 'Meldung aus dem Boot.';
}
