import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { globals: false, include: ['tests/**/*.test.mjs'], testTimeout: 60_000 },
});
