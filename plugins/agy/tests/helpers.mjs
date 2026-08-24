import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixture = (rel) => fileURLToPath(new URL(rel, import.meta.url));

export function makeTempHome() {
  const dir = mkdtempSync(join(tmpdir(), 'cad-test-'));
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export const STUB_BIN = fixture('./fixtures/agy-stub.mjs');
export const READ_AND_COMMAND = fixture('./fixtures/agy-events/read-and-command.ndjson');
export const ADD_DIR_WORKS = fixture('./fixtures/agy-events/add-dir-works.ndjson');
export const PERMISSION_DENIED = fixture('./fixtures/agy-events/permission-denied.ndjson');
export const SCRATCH_WANDER_IN_GIT = fixture('./fixtures/agy-events/scratch-wander-in-git-repo.ndjson');
export const SCRATCH_WANDER = fixture('./fixtures/agy-events/scratch-wander.ndjson');
export const ERROR_BUT_SUCCEEDED = fixture('./fixtures/agy-events/error-but-succeeded.json');
