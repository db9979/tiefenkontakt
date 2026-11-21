import { CLASSES, type Snapshot } from '@tk/shared';
import { audio } from '../audio.js';
import { lang } from '../i18n/index.js';
import { store } from '../store.js';

/**
 * Crew reports: watches successive snapshots and announces what changed, spoken with the
 * browser's speech synthesis (German or English) and written to the event log.
 */

export interface LogEntry {
  time: number;
  text: string;
  level: 'info' | 'warn' | 'alarm';
  label?: string;
  station?: number;
}

const en = lang === 'en';
const L = (de: string, enText: string) => (en ? enText : de);
/** Naval digit reading: "zwo-eins-null" / "two-one-zero". */
function digits(b: number): string {
  const d = String(Math.round(((b % 360) + 360) % 360)).padStart(3, '0');
  const de = ['null', 'eins', 'zwo', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun'];
  const e = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];
  return [...d].map((c) => (en ? e : de)[Number(c)]).join('-');
}
const deg3 = (b: number) => String(Math.round(((b % 360) + 360) % 360)).padStart(3, '0');

export function voiceOn(): boolean {
  return localStorage.getItem('tk_voice') !== '0';
}

let voice: SpeechSynthesisVoice | undefined;
function pickVoice(): void {
  const all = typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices() : [];
  voice = all.find((v) => v.lang.startsWith(en ? 'en' : 'de') && /male|Markus|Yannick|Daniel|Alex/i.test(v.name)) ??
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

const LEVEL: Record<string, LogEntry['level']> = { torpedo: 'alarm', sunk: 'alarm', ping: 'warn', esm: 'warn', transient: 'warn', hit: 'info' };

export class Callouts {
  reset(): void {
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
    this.log.push({ ...e, time: s.time });
    if (this.log.length > 80) this.log.shift();
    if (e.level !== 'alarm') audio.chime(e.level === 'warn' ? 'warn' : 'info');
    say(spoken, e.level === 'alarm');
  }

  update(s: Snapshot): void {
    const p = this.prev;
    this.prev = s;
    if (!p) {
      for (const c of s.contacts) this.known.add(c.label);
      // After a reconnect the recent alerts arrive at once: list them, don't speak them
      for (const a of s.alerts) this.log.push({ time: a.time, text: a.text, level: LEVEL[a.kind] ?? 'info' });
      return;
    }
    const sub = CLASSES[s.own.cls].submarine;
    const sonar = sub ? 0 : 1;
    // New contacts (own sensors only; datalink tracks are not "our" reports)
    for (const c of s.contacts) {
      if (this.known.has(c.label) || c.via !== 'own') continue;
      this.known.add(c.label);
      this.report(s, { level: 'info', text: L(`Neuer Kontakt ${c.label}, Peilung ${deg3(c.bearing)}`, `New contact ${c.label}, bearing ${deg3(c.bearing)}`), label: c.label, station: sonar },
        en ? `New contact ${c.label}, bearing ${digits(c.bearing)}` : `Neuer Kontakt ${c.label}, Peilung ${digits(c.bearing)}`);
    }
    // Server alerts that are new in this snapshot
    for (const a of s.alerts.filter((x) => x.time > p.time)) {
      const b = a.bearing !== undefined ? digits(a.bearing) : '';
      if (a.kind === 'torpedo') {
        const text = store.realism === 'profi' ? `HOCHFREQUENTES SCHRAUBENGERÄUSCH, SCHNELL WANDERND · PEILUNG ${deg3(a.bearing ?? 0)}` : a.text;
        this.report(s, { level: 'alarm', text, station: sub ? 3 : 2 }, en ? `Torpedo in the water! Bearing ${b}!` : `Torpedo im Wasser! Peilung ${b}!`);
      } else if (a.kind === 'ping') {
        this.report(s, { level: 'warn', text: a.text }, en ? `Active sonar, bearing ${b}. We are being pinged.` : `Aktivsonar, Peilung ${b}. Wir werden angepingt.`);
      } else if (a.kind === 'transient') {
        this.report(s, { level: 'warn', text: a.text, station: sonar }, en ? `Transient, bearing ${b}. Possible torpedo launch.` : `Transient, Peilung ${b}. Möglicher Torpedoabschuss.`);
      } else if (a.kind === 'hit') {
        this.report(s, { level: 'info', text: a.text }, en ? `Explosion, bearing ${b}.` : `Explosion, Peilung ${b}.`);
      } else if (a.kind === 'esm') {
        this.report(s, { level: 'warn', text: a.text }, en ? `Radar intercept, bearing ${b}.` : `Radarpeilung, Peilung ${b}.`);
      } else if (a.kind === 'sunk') {
        this.log.push({ time: a.time, text: a.text, level: 'alarm' });
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
      this.report(s, { level: 'info', text: L(`Tiefe ${d} m erreicht`, `Depth ${d} m reached`), station: sub ? 3 : undefined }, en ? `Depth ${d} metres.` : `${d} Meter eingesteuert.`);
    }
    if (Math.abs(o.order.heading - po.order.heading) > 0.5) this.coursePending = o.order.heading;
    if (this.coursePending !== undefined && Math.abs(((o.heading - this.coursePending + 540) % 360) - 180) < 1.5) {
      const c = this.coursePending;
      this.coursePending = undefined;
      this.report(s, { level: 'info', text: L(`Kurs ${deg3(c)} liegt an`, `Steady on ${deg3(c)}`) }, en ? `Steady on course ${digits(c)}.` : `Kurs ${digits(c)} liegt an.`);
    }
    // Own torpedoes
    for (const t of s.torpedoes) {
      const was = p.torpedoes.find((x) => x.id === t.id);
      if (was && !was.homing && t.homing) this.report(s, { level: 'info', text: L(`${t.id} hat Ziel erfasst`, `${t.id} has acquired`), station: 2 }, en ? `Torpedo has acquired.` : `Torpedo hat Ziel erfasst.`);
      if (was?.wire && !t.wire) this.report(s, { level: 'warn', text: L(`${t.id}: Draht gerissen`, `${t.id}: wire cut`), station: 2 }, en ? 'Wire cut.' : 'Draht gerissen.');
    }
    if (!p.own.towedReady && o.towedReady && o.towedLength > 0) {
      this.report(s, { level: 'info', text: L('Schleppsonar klar', 'Towed array steady'), station: sonar }, en ? 'Towed array is steady.' : 'Schleppsonar klar.');
    }
    // Exposure and endurance warnings, once each
    if (o.mastUp && o.mastUpSince !== undefined && s.time - o.mastUpSince > 60 && !this.spokenMast) {
      this.spokenMast = true;
      this.report(s, { level: 'warn', text: L('Mast seit einer Minute oben', 'Mast up for one minute'), station: 1 }, en ? 'Mast up for one minute.' : 'Mast seit einer Minute oben.');
    }
    if (!o.mastUp) this.spokenMast = false;
    const cap = CLASSES[o.cls].battery?.capacityKnH;
    if (cap && o.battery !== undefined && o.battery / cap < 0.25 && !this.spokenBattery) {
      this.spokenBattery = true;
      this.report(s, { level: 'warn', text: L('Batterie unter 25 %', 'Battery below 25 %'), station: 3 }, en ? 'Battery below twenty-five percent.' : 'Batterie unter fünfundzwanzig Prozent.');
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
