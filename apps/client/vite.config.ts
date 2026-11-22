import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: Number(process.env.VITE_PORT ?? 5173),
    proxy: {
      // API_PORT: another game server for tests (e.g. one with a voice server configured)
      '/ws': { target: `ws://localhost:${process.env.API_PORT ?? 8787}`, ws: true },
      '/api': `http://localhost:${process.env.API_PORT ?? 8787}`,
      '/lk': { target: `ws://localhost:${process.env.API_PORT ?? 8787}`, ws: true },
    },
  },
});
