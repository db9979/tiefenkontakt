import { describe, expect, it } from 'vitest';
import { clientIpFrom } from '../src/client-ip.js';

describe('client address behind a proxy', () => {
  it('takes the address the proxy appended, not one the client made up', () => {
    // Client sent "X-Forwarded-For: 6.6.6.6", nginx appended the real address
    expect(clientIpFrom('6.6.6.6, 84.10.20.30', '172.18.0.1', '1')).toBe('84.10.20.30');
    expect(clientIpFrom('84.10.20.30', '172.18.0.1', '1')).toBe('84.10.20.30');
  });

  it('two proxies: the second entry from the right', () => {
    expect(clientIpFrom('6.6.6.6, 84.10.20.30, 10.0.0.2', '10.0.0.3', '2')).toBe('84.10.20.30');
  });

  it('without TRUST_PROXY the header is ignored', () => {
    expect(clientIpFrom('6.6.6.6', '84.10.20.30', undefined)).toBe('84.10.20.30');
    expect(clientIpFrom(undefined, '84.10.20.30', '1')).toBe('84.10.20.30');
  });
});
