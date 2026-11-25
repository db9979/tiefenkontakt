import type { AdminReport, Block, Row, Tone } from './admin-mail.js';

/**
 * Operator mails about what players send in while the game runs: feedback after a game,
 * reports about other players and browser errors. Each mail covers one or more items
 * (admin-notify.ts collects them so a busy evening doesn't flood the inbox).
 */

/** Tokens in links (#reset=…, #verify=…, ?token=…) never go into a mail. */
export function redact(s: string): string {
  return s.replace(/\b(verify|reset|phone|join|token|session|tk_session)=[^\s&#'"]+/gi, '$1=…');
}

function links(url: string | undefined): { label: string; url: string }[] {
  try {
    const o = new URL(url ?? '').origin;
    return o === 'null' ? [] : [{ label: 'ADMIN-BEREICH (LOBBY)', url: `${o}/` }];
  } catch {
    return [];
  }
}

const time = (at: number) => new Date(at).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
const more = (dropped: number): Block[] =>
  dropped > 0 ? [{ kind: 'text', paras: [`Dazu ${dropped} weitere, die nicht mehr in diese Mail passten: siehe Admin-Bereich.`] }] : [];
const FOOTER = 'Empfänger: ADMIN_MAIL_TO, sonst ALERT_TO / MAIL_FROM. Abstellen mit ADMIN_MAIL=0 oder einzeln über ADMIN_MAIL_SKIP.';

export interface FeedbackItem {
  at: number;
  callsign?: string;
  rating: number;
  tags: string[];
  text: string;
  mission?: string;
  side?: 'west' | 'east';
  cls?: string;
  won?: boolean;
  quality?: string;
}

const TAG: Record<string, string> = {
  ruckeln: 'Ruckeln', fehler: 'Fehler', unklar: 'Unklar', zu_schwer: 'Zu schwer', zu_leicht: 'Zu leicht', super: 'Super',
};
const stars = (n: number) => `${'★'.repeat(Math.max(0, Math.min(5, n)))}${'☆'.repeat(5 - Math.max(0, Math.min(5, n)))} ${n}/5`;

export function feedbackReport(items: FeedbackItem[], dropped = 0, url?: string): AdminReport {
  const avg = items.reduce((a, f) => a + f.rating, 0) / Math.max(1, items.length);
  const bad = items.some((f) => f.rating <= 2 || f.tags.includes('fehler'));
  const one = items.length === 1 ? items[0] : undefined;
  const who = (f: FeedbackItem) => f.callsign ?? 'Gast';
  const blocks: Block[] = items.flatMap((f, i): Block[] => {
    const rows: Row[] = [
      ['Bewertung', stars(f.rating), f.rating <= 2 ? 'alarm' : f.rating >= 4 ? 'ok' : undefined],
      ['Von', who(f)],
      ['Zeit', time(f.at)],
      ...(f.tags.length ? [['Stichworte', f.tags.map((t) => TAG[t] ?? t).join(', '), f.tags.includes('fehler') ? 'warn' : undefined] as Row] : []),
      ...(f.mission ? [['Mission', f.mission] as Row] : []),
      ...(f.side ? [['Seite', f.side === 'west' ? 'Westbund' : 'Ostpakt'] as Row] : []),
      ...(f.cls ? [['Klasse', f.cls] as Row] : []),
      ...(f.won !== undefined ? [['Ausgang', f.won ? 'gewonnen' : 'verloren'] as Row] : []),
      ...(f.quality ? [['Grafik', f.quality] as Row] : []),
    ];
    const title = items.length > 1 ? `Feedback ${i + 1} · ${who(f)}` : 'Feedback';
    return [{ kind: 'rows', title, rows }, ...(f.text.trim() ? [{ kind: 'text', title: 'Kommentar', paras: [f.text.trim()] } as Block] : [])];
  });
  return {
    subject: one ? `Tiefenkontakt Feedback: ${one.rating}/5 von ${who(one)}` : `Tiefenkontakt Feedback: ${items.length} neue (Ø ${avg.toFixed(1)})`,
    tone: bad ? 'warn' : 'info', precedence: 'ROUTINE', from: 'SPIELER-RÜCKMELDUNG', title: 'FEEDBACK NACH DER PARTIE',
    headline: one ? `${stars(one.rating)} von ${who(one)}` : `${items.length} neue Rückmeldungen, Ø ${avg.toFixed(1)}/5`,
    summary: one?.text.trim() ? one.text.trim().slice(0, 140) : undefined,
    blocks: [...blocks, ...more(dropped)], links: links(url),
    footer: ['Gesammelt nach dem Spielende (POST /api/feedback). Die ganze Liste steht im Admin-Bereich.', FOOTER],
  };
}

export interface ReportItem {
  at: number;
  reporter: string;
  reported: string;
  reportedId: string;
  matchId: string;
  reason: string;
  evidence: string;
}

export function playerReport(items: ReportItem[], dropped = 0, url?: string): AdminReport {
  const one = items.length === 1 ? items[0] : undefined;
  const blocks: Block[] = items.flatMap((r, i): Block[] => [
    {
      kind: 'rows', title: items.length > 1 ? `Meldung ${i + 1}` : 'Meldung', rows: [
        ['Gemeldet', r.reported, 'warn'], ['Spieler-ID', r.reportedId], ['Gemeldet von', r.reporter],
        ['Grund', r.reason], ['Partie', r.matchId], ['Zeit', time(r.at)],
      ],
    },
    ...(r.evidence.trim() ? [{ kind: 'log', title: 'Beleg (Funkverkehr)', lines: redact(r.evidence).split('\n').slice(0, 40) } as Block] : []),
  ]);
  return {
    subject: one ? `Tiefenkontakt Meldung: ${one.reporter} meldet ${one.reported}` : `Tiefenkontakt Meldungen: ${items.length} neue`,
    tone: 'warn', precedence: 'DRINGEND', from: 'MODERATION', title: 'MELDUNG ÜBER EINEN SPIELER',
    headline: one ? `${one.reported} gemeldet: ${one.reason}` : `${items.length} neue Meldungen über Spieler`,
    summary: 'Prüfen, verwerfen oder sperren im Admin-Bereich der Lobby (Moderation).',
    blocks: [...blocks, ...more(dropped)], links: links(url),
    footer: ['Ein Spieler hat in einer Partie einen anderen gemeldet (doppelte Meldungen werden nicht gezählt).', FOOTER],
  };
}

export interface ClientErrorItem {
  at: number;
  msg: string;
  stack?: string;
  where?: string;
  ua?: string;
  user?: string;
}

/** Browser errors, grouped by message: how often, where, which browsers, the first stack. */
export function clientErrorReport(items: ClientErrorItem[], dropped = 0, url?: string): AdminReport {
  const groups = new Map<string, ClientErrorItem[]>();
  for (const e of items) groups.set(e.msg, [...(groups.get(e.msg) ?? []), e]);
  const sorted = [...groups.values()].sort((a, b) => b.length - a.length);
  const total = items.length + dropped;
  const uniq = <T>(xs: (T | undefined)[]) => [...new Set(xs.filter((x): x is T => x !== undefined && x !== ''))];
  const blocks: Block[] = [
    { kind: 'table', title: 'Übersicht', head: ['Anzahl', 'Meldung', 'Ort'], align: ['r', 'l', 'l'],
      rows: sorted.map((g) => [String(g.length), redact(g[0]!.msg).slice(0, 120), uniq(g.map((e) => e.where && redact(e.where))).join(', ').slice(0, 60)]) },
    ...sorted.slice(0, 8).flatMap((g, i): Block[] => {
      const e = g[0]!;
      const tone: Tone | undefined = g.length >= 5 ? 'alarm' : undefined;
      return [
        { kind: 'rows', title: `Fehler ${i + 1}`, rows: [
          ['Meldung', redact(e.msg), tone ?? 'warn'], ['Anzahl', String(g.length), tone],
          ['Zuerst / zuletzt', `${time(Math.min(...g.map((x) => x.at)))} / ${time(Math.max(...g.map((x) => x.at)))}`],
          ['Spieler', uniq(g.map((x) => x.user)).join(', ') || 'Gäste'],
          ['Browser', uniq(g.map((x) => x.ua)).slice(0, 3).join(' | ') || '?'],
        ] },
        ...(e.stack ? [{ kind: 'log', lines: redact(e.stack).split('\n').slice(0, 12) } as Block] : []),
      ];
    }),
    ...more(dropped),
  ];
  return {
    subject: `Tiefenkontakt Client-Fehler: ${total} (${groups.size} verschiedene)`,
    tone: sorted[0] && sorted[0].length >= 5 ? 'alarm' : 'warn', precedence: 'HINWEIS', from: 'FEHLERMELDER BROWSER', title: 'FEHLER IN SPIELER-BROWSERN',
    headline: `${total} Fehler, ${groups.size} verschiedene`, summary: redact(sorted[0]?.[0]?.msg ?? '').slice(0, 140),
    blocks, links: links(url),
    footer: ['Ungefangene Fehler aus den Browsern der Spieler (POST /api/client-error), gesammelt und gebündelt.', FOOTER],
  };
}
