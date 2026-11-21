import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { z } from 'zod';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const SESSION_DAYS = 30;

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
  private db: DatabaseSync;

  constructor(path = process.env.DB_PATH ?? 'tiefenkontakt.db') {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        callsign TEXT NOT NULL UNIQUE COLLATE NOCASE,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        faction TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        expires_at INTEGER NOT NULL
      );`);
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
