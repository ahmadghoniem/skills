import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    include: ['evals/**/*.eval.mjs'],
    // One live session can run for minutes; the suite gates itself on
    // OPENCODE_EVAL_LIVE, so an offline run finishes instantly anyway.
    testTimeout: 4 * 3_600_000,
    hookTimeout: 4 * 3_600_000,
  },
});
