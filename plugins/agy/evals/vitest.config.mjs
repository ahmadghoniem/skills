import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Evals are kept apart from the unit tests: `npm test` never runs them.
// Offline evals always run; live ones skip unless AGY_EVAL_LIVE=1 (npm run eval:live).
export default defineConfig({
  test: {
    globals: false,
    root: fileURLToPath(new URL('..', import.meta.url)),
    include: ['evals/**/*.eval.mjs'],
    testTimeout: 60_000,
    hookTimeout: 3_600_000,
    fileParallelism: false,
  },
});
