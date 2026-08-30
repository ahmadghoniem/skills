// Shared user-facing hints for the job commands.

/**
 * Message shown when a job id the user supplied does not resolve.
 *
 * The common cause is copying Claude Code's own background-command ID
 * ("Command running in background with ID: …") instead of the Grok job id —
 * they are different values, and the real job id is printed in the job's own
 * output, not in Claude Code's background notification. Rather than guess
 * whether `id` looks like a Claude Code id (a fragile, coupling heuristic),
 * always append the recovery hint.
 *
 * @param {string} id
 * @returns {string}
 */
export function jobNotFoundMessage(id) {
  return (
    `No job \`${id}\` found for this repository.\n` +
    `Hint: if you copied this ID from a Claude Code background notification ` +
    `("Command running in background with ID: …"), that is Claude Code's own ID, ` +
    `not the Grok job ID. Run \`/grok:result --list\` to list tracked jobs and ` +
    `copy the real ID.\n`
  );
}
