import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    include: ['plugins/agy/tests/**/*.test.mjs'],
    testTimeout: 15_000,
  },
});
