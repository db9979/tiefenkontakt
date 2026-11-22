/**
 * Real client address behind reverse proxies. Each proxy appends the address it saw to
 * X-Forwarded-For, so only the rightmost entries are trustworthy: with TRUST_PROXY=n
 * (number of proxies in front, `1` for a single nginx) the n-th entry from the right is
 * the client. Entries further left are whatever the client sent and are ignored.
 */
export function clientIpFrom(forwarded: string | string[] | undefined, remote: string | undefined, trustProxy = process.env.TRUST_PROXY): string {
  const hops = Number(trustProxy ?? 0);
  const header = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
  if (hops > 0 && header) {
    const list = header.split(',').map((s) => s.trim()).filter(Boolean);
    const ip = list[list.length - hops];
    if (ip) return ip;
  }
  return remote ?? '?';
}
