/**
 * Minimal structured logging. LOG_FORMAT=json writes one JSON object per line (for log
 * collectors); otherwise readable lines. LOG_LEVEL=debug|info|warn|error (default info).
 */
type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  const min = ORDER[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? 20;
  if (ORDER[level] < min) return;
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  if (process.env.LOG_FORMAT === 'json') {
    out(JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields }));
  } else {
    const extra = Object.entries(fields).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' ');
    out(`${level === 'info' ? '' : `[${level.toUpperCase()}] `}${msg}${extra ? ` ${extra}` : ''}`);
  }
}
