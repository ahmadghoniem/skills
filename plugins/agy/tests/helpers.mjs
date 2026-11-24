import { fileURLToPath } from 'node:url';

const fixture = (rel) => fileURLToPath(new URL(rel, import.meta.url));

export const STUB_BIN = fixture('./fixtures/agy-stub.mjs');
export const READ_AND_COMMAND = fixture('./fixtures/agy-events/read-and-command.ndjson');
export const PERMISSION_DENIED = fixture('./fixtures/agy-events/permission-denied.ndjson');
export const ERROR_BUT_SUCCEEDED = fixture('./fixtures/agy-events/error-but-succeeded.json');
