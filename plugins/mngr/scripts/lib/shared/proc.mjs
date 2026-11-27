// Process and command-line helpers shared by every CLI mngr drives and by the
// council.

import { spawn } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/**
 * Spawn without a shell. A `.mjs`/`.js` path (a test stub) runs under Node,
 * because Windows cannot execute a script file directly.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @param {import('node:child_process').SpawnOptions} options
 */
export function spawnDirect(cmd, args, options) {
  const opts = { shell: false, windowsHide: true, ...options };
  if (/\.(mjs|cjs|js)$/i.test(cmd)) return spawn(process.execPath, [cmd, ...args], opts);
  return spawn(cmd, args, opts);
}

/**
 * Run a short command and collect its output. Never throws: a spawn failure
 * resolves with exit code -1 and the error in `stderr`.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @param {{cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number}} [opts]
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number, timedOut: boolean}>}
 */
export function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawnDirect(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout?.setEncoding('utf8').on('data', (d) => (stdout += d));
    child.stderr?.setEncoding('utf8').on('data', (d) => (stderr += d));
    const timer =
      opts.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill();
          }, opts.timeoutMs)
        : null;
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr: stderr || String(err?.message ?? err), exitCode: -1, timedOut });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: typeof code === 'number' ? code : -1, timedOut });
    });
  });
}

/**
 * Parse a script's argv with Node's `parseArgs`. A leading `--` (how the
 * commands pass arguments through `node script.mjs -- …`) is dropped. Throws
 * on an unknown flag, with parseArgs' own message.
 *
 * @param {string[]} argv
 * @param {import('node:util').ParseArgsConfig['options']} options
 */
export function parseCli(argv, options) {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  const { values, positionals } = parseArgs({ args, options, allowPositionals: true, strict: true });
  return { values, positionals };
}

/**
 * Read a brief written by Claude. Throws when the file is missing or empty.
 *
 * @param {string} path
 * @returns {string}
 */
export function readPromptFile(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8').trim();
  } catch (err) {
    throw new Error(`could not read --prompt-file ${path}: ${err instanceof Error ? err.message : err}`);
  }
  if (!text) throw new Error(`prompt file is empty: ${path}`);
  return text;
}

/**
 * Whether the calling module is the script Node was started with. Compares real
 * paths, since junctions and 8.3 names defeat a plain string compare on Windows.
 *
 * @param {string} moduleUrl  the caller's `import.meta.url`
 */
export function invokedAsScript(moduleUrl) {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

/**
 * Run `main(argv)` as the process entry point and exit with its code.
 *
 * The process ends on its own when nothing is left running, and is made to
 * exit 2 s later otherwise. Calling `process.exit` straight after a `fetch`
 * crashes Node on Windows (`Assertion failed: !(handle->flags &
 * UV_HANDLE_CLOSING)`, exit 127): nodejs/node#56645, fixed in Node 24.20.0.
 *
 * @param {string} moduleUrl
 * @param {(argv: string[]) => Promise<number>} main
 */
export function runAsScript(moduleUrl, main) {
  if (!invokedAsScript(moduleUrl)) return;
  const exit = (code) => {
    process.exitCode = code;
    setTimeout(() => process.exit(code), 2_000).unref();
  };
  main(process.argv.slice(2))
    .then(exit)
    .catch((err) => {
      process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
      exit(1);
    });
}
