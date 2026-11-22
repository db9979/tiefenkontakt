import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import type { Plugin } from 'vite';

/**
 * Build steps for fast starts:
 *  - sw.js: a service worker with this build's id and the full list of output files. On the
 *    first visit it downloads everything in the background (3D view, models, voice client);
 *    later starts come from the cache. A new build installs alongside and waits until the
 *    page asks it to take over ("Neue Version – neu laden").
 *  - precompressed .br and .gz next to every text asset, served by the game server, so the
 *    Pi never compresses at request time.
 */

const COMPRESS = /\.(js|css|html|svg|json|webmanifest|txt)$/;

function swSource(id: string, files: string[]): string {
  return `// Generated at build time (apps/client/build/pwa.ts) – build ${id}
const VERSION = ${JSON.stringify(id)};
const CACHE = 'tk-' + VERSION;
const PRECACHE = ${JSON.stringify(['/', ...files])};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tk-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Live traffic never comes from the cache
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws') || url.pathname.startsWith('/lk/')) return;
  if (req.mode === 'navigate') {
    // The page: fresh when online (mail links, invites), the cached app when the network fails
    e.respondWith(fetch(req).catch(() => caches.match('/')));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    // Hashed file names never change: cache first
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  // Everything else (icons, handbook): from the cache if there, refreshed in the background
  e.respondWith(caches.match(req).then((hit) => {
    const net = fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});
`;
}

function walk(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p, base) : [p];
  });
}

export function pwa(buildId: string): Plugin {
  return {
    name: 'tk-pwa',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => f.startsWith('assets/')).map((f) => `/${f}`);
      // Small public files worth having offline; the 4 MB handbook is cached only when opened
      files.push('/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png');
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: swSource(buildId, files) });
    },
    writeBundle(opts) {
      const out = opts.dir!;
      for (const f of walk(out)) {
        if (!COMPRESS.test(f)) continue;
        const buf = readFileSync(f);
        if (buf.length < 1024) continue;
        writeFileSync(`${f}.br`, brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
        writeFileSync(`${f}.gz`, gzipSync(buf, { level: 9 }));
      }
    },
  };
}
