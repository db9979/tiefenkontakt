/**
 * Balance from real matches: win rate per mission and side and per class, from the finished
 * matches in the server database (only matches with humans; Mensch–Mensch and Mensch–KI apart).
 * Same numbers as the moderator panel. Opens the database read-only.
 * Usage: npx tsx scripts/real-balance.ts [path]   (default: DB_PATH, else tiefenkontakt.db)
 */
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { formatRealBalance, realBalance } from '../apps/server/src/real-balance.js';

const path = process.argv[2] ?? process.env.DB_PATH ?? 'tiefenkontakt.db';
if (!existsSync(path)) {
  console.error(`Datenbank nicht gefunden: ${path} (Pfad als Argument oder DB_PATH setzen)`);
  process.exit(1);
}
const db = new DatabaseSync(path, { readOnly: true });
console.log(`Datenbank: ${path}\n`);
console.log(formatRealBalance(realBalance(db)));
db.close();
