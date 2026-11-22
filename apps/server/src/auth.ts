import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { z } from 'zod';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const SESSION_DAYS = 30;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export const registerSchema = z.object({
  callsign: z.string().regex(/^[A-Za-z0-9_-]{3,16}$/, '3–16 Zeichen, nur Buchstaben, Ziffern, - und _'),
  email: z.string().trim().toLowerCase().email('Ungültige E-Mail-Adresse').max(200),
  password: z.string().min(8, 'Mindestens 8 Zeichen').max(200),
  faction: z.enum(['west', 'east']),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(200),
  password: z.string().max(200),
});

export interface User {
  id: number;
  callsign: string;
  email: string;
  faction: 'west' | 'east';
}

/** Password hashing with scrypt (memory-hard, built into Node; no native addon needed). */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [algo, saltB64, keyB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scryptAsync(pw, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(key, expected);
}

export class AuthStore {
  readonly db: DatabaseSync;

  constructor(path = process.env.DB_PATH ?? 'tiefenkontakt.db') {
    this.db = new DatabaseSync(path);
    // A restarting server may still hold the file for a moment
    this.db.exec('PRAGMA busy_timeout = 3000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        callsign TEXT NOT NULL UNIQUE COLLATE NOCASE,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        faction TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tokens (
        hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        kind TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        expires_at INTEGER NOT NULL
      );`);
    this.migrate();
  }

  private migrate(): void {
    const cols = (this.db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes('verified')) this.db.exec('ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 0');
  }

  /** One-time token (password reset, e-mail verification); only its hash is stored. */
  createToken(userId: number, kind: 'reset' | 'verify', ttlMs: number): string {
    const raw = randomBytes(32).toString('base64url');
    this.db.prepare('DELETE FROM tokens WHERE user_id = ? AND kind = ?').run(userId, kind);
    this.db.prepare('INSERT INTO tokens (hash, user_id, kind, expires_at) VALUES (?, ?, ?, ?)').run(sha(raw), userId, kind, Date.now() + ttlMs);
    return raw;
  }

  consumeToken(raw: unknown, kind: 'reset' | 'verify'): number | undefined {
    if (typeof raw !== 'string' || raw.length > 100) return undefined;
    const row = this.db.prepare('SELECT user_id FROM tokens WHERE hash = ? AND kind = ? AND expires_at > ?').get(sha(raw), kind, Date.now()) as { user_id: number } | undefined;
    if (!row) return undefined;
    this.db.prepare('DELETE FROM tokens WHERE hash = ?').run(sha(raw));
    return row.user_id;
  }

  findByEmail(email: unknown): User | undefined {
    if (typeof email !== 'string') return undefined;
    const row = this.db.prepare('SELECT id, callsign, email, faction FROM users WHERE email = ?').get(email.trim().toLowerCase()) as User | undefined;
    return row ? { ...row } : undefined;
  }

  isVerified(userId: number): boolean {
    return !!(this.db.prepare('SELECT verified FROM users WHERE id = ?').get(userId) as { verified: number } | undefined)?.verified;
  }

  markVerified(userId: number): void {
    this.db.prepare('UPDATE users SET verified = 1 WHERE id = ?').run(userId);
  }

  /** New password; all sessions end (the reset link may have been the only way in). */
  async setPassword(userId: number, password: unknown): Promise<string | undefined> {
    const r = registerSchema.shape.password.safeParse(password);
    if (!r.success) return r.error.issues[0]?.message ?? 'Ungültiges Passwort';
    this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(r.data), userId);
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    return undefined;
  }

  async checkPassword(userId: number, password: unknown): Promise<boolean> {
    if (typeof password !== 'string') return false;
    const row = this.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as { password_hash: string } | undefined;
    return !!row && (await verifyPassword(password, row.password_hash));
  }

  /** Delete an account with everything that belongs to it. */
  deleteUser(userId: number): void {
    for (const table of ['sessions', 'tokens', 'results', 'campaign', 'campaign_runs']) {
      try {
        this.db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
      } catch {
        /* table may not exist (stats not initialised) */
      }
    }
    this.db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  }

  newSession(userId: number): string {
    return this.createSession(userId);
  }

  async register(input: unknown): Promise<{ user: User; token: string } | { error: string }> {
    const r = registerSchema.safeParse(input);
    if (!r.success) return { error: r.error.issues[0]?.message ?? 'Ungültige Eingabe' };
    const { callsign, email, password, faction } = r.data;
    if (this.db.prepare('SELECT 1 FROM users WHERE callsign = ?').get(callsign)) return { error: 'Rufzeichen ist schon vergeben' };
    if (this.db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return { error: 'E-Mail ist schon registriert' };
    const hash = await hashPassword(password);
    const res = this.db
      .prepare('INSERT INTO users (callsign, email, password_hash, faction, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(callsign, email, hash, faction, Date.now());
    const user: User = { id: Number(res.lastInsertRowid), callsign, email, faction };
    return { user, token: this.createSession(user.id) };
  }

  async login(input: unknown): Promise<{ user: User; token: string } | { error: string }> {
    const r = loginSchema.safeParse(input);
    const fail = { error: 'E-Mail oder Passwort falsch' };
    if (!r.success) return fail;
    const row = this.db.prepare('SELECT id, callsign, email, faction, password_hash FROM users WHERE email = ?').get(r.data.email) as
      | (User & { password_hash: string })
      | undefined;
    if (!row || !(await verifyPassword(r.data.password, row.password_hash))) return fail;
    const user: User = { id: row.id, callsign: row.callsign, email: row.email, faction: row.faction };
    return { user, token: this.createSession(user.id) };
  }

  private createSession(userId: number): string {
    const token = randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
      .run(token, userId, Date.now() + SESSION_DAYS * 86_400_000);
    return token;
  }

  userForToken(token: string | undefined): User | undefined {
    if (!token) return undefined;
    const row = this.db
      .prepare('SELECT u.id, u.callsign, u.email, u.faction FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?')
      .get(token, Date.now()) as User | undefined;
    return row ? { ...row } : undefined;
  }

  logout(token: string | undefined): void {
    if (token) this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  rawPasswordHash(email: string): string | undefined {
    const row = this.db.prepare('SELECT password_hash FROM users WHERE email = ?').get(email) as { password_hash: string } | undefined;
    return row?.password_hash;
  }
}

/** Fixed-window rate limiter keyed by e.g. IP. */
export class RateLimiter {
  private hits = new Map<string, { n: number; since: number }>();
  constructor(private max: number, private windowMs: number) {}

  allow(key: string): boolean {
    const now = Date.now();
    const h = this.hits.get(key);
    if (!h || now - h.since > this.windowMs) {
      this.hits.set(key, { n: 1, since: now });
      return true;
    }
    h.n++;
    return h.n <= this.max;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
