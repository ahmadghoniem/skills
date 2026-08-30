import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { jobsDir, pluginHome, repoHash } from '../scripts/lib/paths.mjs';
import { makeTempHome } from './helpers.mjs';

describe('paths', () => {
  let tmp;
  const prevHome = process.env.CGD_HOME;

  beforeEach(() => {
    tmp = makeTempHome();
    process.env.CGD_HOME = tmp.dir;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.CGD_HOME;
    else process.env.CGD_HOME = prevHome;
    tmp.cleanup();
  });

  it('pluginHome honours the env override', () => {
    expect(pluginHome()).toBe(tmp.dir);
  });

  it('repoHash is stable and 12 hex chars', () => {
    const a = repoHash(tmp.dir);
    const b = repoHash(tmp.dir);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });

  it('jobsDir nests under pluginHome using the repo hash', () => {
    const dir = jobsDir(tmp.dir);
    expect(dir.startsWith(tmp.dir)).toBe(true);
    expect(dir).toContain('jobs');
    expect(dir).toContain(repoHash(tmp.dir));
  });
});
