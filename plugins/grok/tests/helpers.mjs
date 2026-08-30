import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `new URL(…).pathname` yields `/C:/…` on Windows, which is not a usable filesystem
// path — `fileURLToPath` is the portable conversion.
const fixture = (rel) => fileURLToPath(new URL(rel, import.meta.url));

export function makeTempHome() {
  const dir = mkdtempSync(join(tmpdir(), 'cgd-test-'));
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export const STUB_BIN = fixture('./fixtures/grok-stub.mjs');
export const HAPPY_FIXTURE = fixture('./fixtures/grok-events/happy-path.ndjson');
export const FAILED_COMMAND_FIXTURE = fixture('./fixtures/grok-events/failed-command.ndjson');
export const RELATIVE_ABSOLUTE_FIXTURE = fixture('./fixtures/grok-events/relative-and-absolute.ndjson');
