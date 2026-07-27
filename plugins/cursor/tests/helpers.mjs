import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `new URL(…).pathname` yields `/C:/…` on Windows, which is not a usable filesystem
// path — `fileURLToPath` is the portable conversion.
const fixture = (rel) => fileURLToPath(new URL(rel, import.meta.url));

export function makeTempHome() {
  const dir = mkdtempSync(join(tmpdir(), 'cursor-plugin-cc-test-'));
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export const STUB_BIN = fixture('./fixtures/cursor-agent-stub.mjs');
export const HAPPY_FIXTURE = fixture('./fixtures/cursor-events/happy-path.ndjson');
export const FAILURE_FIXTURE = fixture('./fixtures/cursor-events/failure.ndjson');
export const BROWSER_HAPPY_FIXTURE = fixture('./fixtures/cursor-events/browser-happy.ndjson');
export const BROWSER_HAPPY_NESTED_FIXTURE = fixture(
  './fixtures/cursor-events/browser-happy-nested.ndjson',
);
export const BROWSER_FALLBACK_FIXTURE = fixture('./fixtures/cursor-events/browser-fallback.ndjson');
export const REVIEW_HAPPY_FIXTURE = fixture('./fixtures/cursor-events/review-happy.ndjson');
export const REVIEW_VIOLATION_FIXTURE = fixture('./fixtures/cursor-events/review-violation.ndjson');
