import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    include: ['tests/**/*.test.mjs'],
    setupFiles: ['tests/setup-home.mjs'],
    testTimeout: 15_000,
    env: { CAD_RELEASE_CHECK: 'off' },
  },
});
