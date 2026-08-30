import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `new URL(…).pathname` yields `/C:/…` on Windows, which is not a usable filesystem
// path — `fileURLToPath` is the portable conversion.
const fixture = (rel) => fileURLToPath(new URL(rel, import.meta.url));

export function makeTempHome() {
  const dir = mkdtempSync(join(tmpdir(), 'ccd-test-'));
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export const STUB_BIN = fixture('./fixtures/cursor-agent-stub.mjs');
export const HAPPY_FIXTURE = fixture('./fixtures/cursor-events/happy-path.ndjson');
export const FAILURE_FIXTURE = fixture('./fixtures/cursor-events/failure.ndjson');
export const NESTED_TOOL_USE_FIXTURE = fixture('./fixtures/cursor-events/nested-tool-use.ndjson');
export const NATIVE_TOOL_CALL_FIXTURE = fixture('./fixtures/cursor-events/native-tool-call.ndjson');
