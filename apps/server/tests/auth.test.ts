import { describe, expect, it } from 'vitest';
import { AuthStore, RateLimiter } from '../src/auth.js';

const valid = { callsign: 'Seewolf', email: 'Kapitaen@Beispiel.de', password: 'geheim123', faction: 'east' };

describe('accounts', () => {
  it('registers, logs in and resolves sessions', async () => {
    const a = new AuthStore(':memory:');
    const r = await a.register(valid);
    expect('user' in r && r.user.callsign).toBe('Seewolf');
    const l = await a.login({ email: 'kapitaen@beispiel.de', password: 'geheim123' });
    expect('token' in l).toBe(true);
    if ('token' in l) expect(a.userForToken(l.token)?.callsign).toBe('Seewolf');
    expect(a.userForToken('nope')).toBeUndefined();
  });

  it('never stores the password in plain text', async () => {
    const a = new AuthStore(':memory:');
    await a.register(valid);
    const hash = a.rawPasswordHash('kapitaen@beispiel.de')!;
    expect(hash).not.toContain('geheim123');
    expect(hash.startsWith('scrypt$')).toBe(true);
  });

  it('rejects invalid input, duplicates and wrong passwords', async () => {
    const a = new AuthStore(':memory:');
    expect(await a.register({ ...valid, callsign: 'x' })).toHaveProperty('error');
    expect(await a.register({ ...valid, email: 'kein-mail' })).toHaveProperty('error');
    expect(await a.register({ ...valid, password: 'kurz' })).toHaveProperty('error');
    await a.register(valid);
    expect(await a.register({ ...valid, email: 'anders@beispiel.de', callsign: 'SEEWOLF' })).toEqual({ error: 'Rufzeichen ist schon vergeben' });
    expect(await a.register({ ...valid, callsign: 'Anders' })).toEqual({ error: 'E-Mail ist schon registriert' });
    expect(await a.login({ email: valid.email, password: 'falsch123' })).toEqual({ error: 'E-Mail oder Passwort falsch' });
  });

  it('logout invalidates the session', async () => {
    const a = new AuthStore(':memory:');
    const r = await a.register(valid);
    if (!('token' in r)) throw new Error('register failed');
    a.logout(r.token);
    expect(a.userForToken(r.token)).toBeUndefined();
  });
});

describe('rate limiter', () => {
  it('blocks after the limit within the window', () => {
    const rl = new RateLimiter(3, 60_000);
    expect([1, 2, 3, 4].map(() => rl.allow('ip'))).toEqual([true, true, true, false]);
    expect(rl.allow('other')).toBe(true);
  });
});

describe('account lifecycle', () => {
  it('reset tokens are single-use, expire and change the password; sessions end', async () => {
    const a = new AuthStore(':memory:');
    const r = await a.register(valid);
    if (!('user' in r)) throw new Error('register');
    const t = a.createToken(r.user.id, 'reset', 60_000);
    expect(a.consumeToken('falsch', 'reset')).toBeUndefined();
    expect(a.consumeToken(t, 'verify')).toBeUndefined();
    const uid = a.consumeToken(t, 'reset')!;
    expect(uid).toBe(r.user.id);
    expect(a.consumeToken(t, 'reset')).toBeUndefined();
    expect(await a.setPassword(uid, 'kurz')).toBeDefined();
    expect(await a.setPassword(uid, 'neuesPasswort1')).toBeUndefined();
    expect(a.userForToken(r.token)).toBeUndefined();
    expect(await a.login({ email: valid.email, password: 'neuesPasswort1' })).toHaveProperty('token');
    const old = a.createToken(uid, 'verify', -1);
    expect(a.consumeToken(old, 'verify')).toBeUndefined();
  });

  it('verification and deletion', async () => {
    const a = new AuthStore(':memory:');
    const r = await a.register(valid);
    if (!('user' in r)) throw new Error('register');
    expect(a.isVerified(r.user.id)).toBe(false);
    a.markVerified(r.user.id);
    expect(a.isVerified(r.user.id)).toBe(true);
    expect(await a.checkPassword(r.user.id, 'geheim123')).toBe(true);
    a.deleteUser(r.user.id);
    expect(a.findByEmail(valid.email)).toBeUndefined();
    expect(await a.login({ email: valid.email, password: 'geheim123' })).toHaveProperty('error');
  });
});
