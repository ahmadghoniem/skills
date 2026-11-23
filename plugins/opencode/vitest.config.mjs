import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    include: ['tests/**/*.test.mjs'],
    testTimeout: 30_000,
    env: { DELEGATE_RELEASE_CHECK: 'off' },
  },
});
