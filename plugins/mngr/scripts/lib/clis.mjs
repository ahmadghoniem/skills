// The CLIs mngr drives, and how a top-level script hands its arguments to one.
// Each CLI keeps its own scripts under `clis/<cli>/scripts/`.

export const CLIS = Object.freeze(['grok', 'agy', 'opencode']);

// A relative specifier: Node and Vite (the tests) both resolve it against this file.
const load = (cli, script) => import(`../../clis/${cli}/scripts/${script}.mjs`);

/**
 * Run `script` for the CLI named first in argv, passing it the rest. With
 * `all`, naming none (or `all`) runs it for every CLI in turn and returns the
 * worst exit code.
 *
 * @param {string} script
 * @param {string[]} argv
 * @param {{all?: boolean}} [opts]
 */
export async function dispatch(script, argv, { all = false } = {}) {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  const [first, ...rest] = args;
  if (CLIS.includes(first)) return (await load(first, script)).main(rest);
  if (all && (first === undefined || first === 'all')) {
    let worst = 0;
    for (const cli of CLIS) worst = Math.max(worst, await (await load(cli, script)).main([]));
    return worst;
  }
  const which = all ? `${CLIS.join(', ')}, or none for all of them` : CLIS.join(', ');
  process.stderr.write(`Error: name the CLI first: ${which}.\n`);
  return 2;
}
