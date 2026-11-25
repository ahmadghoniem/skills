#!/usr/bin/env node
// `/mngr:delegate`: `delegate.mjs -- <grok|agy|opencode> [flags] <task...>` runs that CLI's delegate.
import { dispatch } from './lib/clis.mjs';
import { runAsScript } from './lib/shared/proc.mjs';

/** @param {string[]} argv */
export const main = (argv) => dispatch('delegate', argv);

runAsScript(import.meta.url, main);
