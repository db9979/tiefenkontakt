/**
 * Printable recognition book: starts a throwaway vite dev server for the client, lets headless
 * Chrome render apps/client/dev/recog-print.html (the silhouettes come from the 3D models, so
 * WebGL runs in software) and prints it to apps/client/public/erkennungsheft.pdf (A4).
 * Run: npx tsx scripts/handbook/recog-pdf.ts
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const client = join(root, 'apps', 'client');
const pdf = join(client, 'public', 'erkennungsheft.pdf');
const PORT = 5297;
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(chrome)) throw new Error('Google Chrome not found for PDF printing');

const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: client, env: { ...process.env, VITE_PORT: String(PORT) }, stdio: 'ignore', detached: true });
const stop = () => {
  try {
    process.kill(-vite.pid!, 'SIGTERM');
  } catch {
    // already gone
  }
};

try {
  const url = `http://localhost:${PORT}/dev/recog-print.html`;
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    try {
      up = (await fetch(url)).ok;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (!up) throw new Error('vite did not start');
  // First load compiles the modules; the second print gets a warm server
  execFileSync(chrome, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--virtual-time-budget=30000', '--dump-dom', url], { stdio: 'ignore', timeout: 180_000 });
  execFileSync(chrome, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--virtual-time-budget=30000', '--no-pdf-header-footer', `--print-to-pdf=${pdf}`, url], { stdio: 'ignore', timeout: 180_000 });
  console.log('PDF', pdf, `${Math.round(statSync(pdf).size / 1024)} KB`);
} finally {
  stop();
}
