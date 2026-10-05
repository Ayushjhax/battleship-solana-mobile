/**
 * The database checks (supabase/verify-offline.mjs) as part of `npm test`.
 *
 * That script applies every migration twice to an in-process Postgres (PGlite)
 * and then exercises RLS, settlement, wagers and the point ledger. It used to
 * run only when someone remembered to run it by hand, so a migration could
 * break money logic with the whole vitest suite still green.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');

describe('supabase migrations against an in-process Postgres', () => {
  it('passes every check in supabase/verify-offline.mjs', () => {
    const run = spawnSync(process.execPath, [join(ROOT, 'supabase', 'verify-offline.mjs')], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120_000,
    });
    const failed = `${run.stdout}${run.stderr}`
      .split('\n')
      .filter((line) => line.startsWith('FAIL'));
    // The failing lines are the whole story; print them rather than a bare exit code.
    expect(failed).toEqual([]);
    expect(run.status).toBe(0);
  }, 120_000);
});
