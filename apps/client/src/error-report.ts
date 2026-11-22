/**
 * Sends uncaught browser errors to the server log (POST /api/client-error), so problems on
 * players' phones become visible. At most 5 distinct reports per page load, no personal data
 * beyond what the server already knows (session, browser).
 */
const seen = new Set<string>();
const MAX = 5;

function report(msg: string, stack?: string): void {
  const key = msg.slice(0, 120);
  if (seen.has(key) || seen.size >= MAX) return;
  seen.add(key);
  const body = JSON.stringify({ msg: msg.slice(0, 300), stack: stack?.slice(0, 1200), where: location.hash.slice(0, 40) || location.pathname });
  try {
    if (!navigator.sendBeacon?.('/api/client-error', new Blob([body], { type: 'application/json' }))) {
      void fetch('/api/client-error', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => undefined);
    }
  } catch {
    // Reporting must never break the game
  }
}

export function installErrorReporting(): void {
  window.addEventListener('error', (e) => {
    // Resource load errors (img/script) carry no message; skip them
    if (!e.message) return;
    report(e.message, (e.error as Error | undefined)?.stack);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as Error | string | undefined;
    report(typeof r === 'string' ? r : r?.message ?? 'unhandled rejection', typeof r === 'object' ? r?.stack : undefined);
  });
}
