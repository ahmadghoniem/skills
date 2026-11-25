import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    include: ['tests/**/*.test.mjs'],
    setupFiles: ['tests/setup-home.mjs'],
    testTimeout: 15_000,
    env: { DELEGATE_RELEASE_CHECK: 'off' },
  },
});
