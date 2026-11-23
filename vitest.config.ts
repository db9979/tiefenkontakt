import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/tests/**/*.test.ts', 'apps/*/tests/**/*.test.ts'],
    // Whole bot matches take 3–4 s locally and 6–8 s on CI runners: 5 s is too tight
    testTimeout: 30_000,
  },
});
