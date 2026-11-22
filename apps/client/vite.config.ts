import { defineConfig } from 'vite';
import { pwa } from './build/pwa.js';

/** One id per build: service-worker cache name and the recognition-picture cache key. */
const BUILD_ID = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

export default defineConfig(({ command }) => ({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID), __PROD__: JSON.stringify(command === 'build') },
  plugins: [pwa(BUILD_ID)],
  build: { chunkSizeWarningLimit: 700 },
  server: {
    port: Number(process.env.VITE_PORT ?? 5173),
    proxy: {
      // API_PORT: another game server for tests (e.g. one with a voice server configured)
      '/ws': { target: `ws://localhost:${process.env.API_PORT ?? 8787}`, ws: true },
      '/api': `http://localhost:${process.env.API_PORT ?? 8787}`,
      '/lk': { target: `ws://localhost:${process.env.API_PORT ?? 8787}`, ws: true },
    },
  },
}));
