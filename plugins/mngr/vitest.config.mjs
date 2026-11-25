import { defineConfig } from 'vitest/config';

// The top-level scripts only; each CLI's tests run from its own folder (`npm run test:<cli>`).
export default defineConfig({
  test: {
    globals: false,
    include: ['tests/**/*.test.mjs'],
    testTimeout: 15_000,
    env: { DELEGATE_RELEASE_CHECK: 'off' },
  },
});
