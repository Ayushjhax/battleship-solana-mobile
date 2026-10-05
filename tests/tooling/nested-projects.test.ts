/**
 * BUG-008: `npm run typecheck` failed (68 errors) and `npm run lint` crashed
 * (ESLint 10 picked up launch-film's own config and parser) — all from the two
 * Remotion video projects nested in the repo, none from the game. While those
 * checks were red they could not catch a real regression, so the root configs
 * leave the nested projects to their own tooling.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const NESTED = ['launch-film', 'demo-assets'];

describe('root tooling leaves the nested video projects alone', () => {
  it('tsconfig.json excludes them', () => {
    const config = JSON.parse(readFileSync(join(ROOT, 'tsconfig.json'), 'utf8')) as { exclude: string[] };
    for (const dir of NESTED) expect(config.exclude).toContain(dir);
  });

  it('eslint.config.js ignores them', async () => {
    const config = (await import(join(ROOT, 'eslint.config.js'))) as { default: { ignores?: string[] }[] };
    const ignores = config.default.flatMap((entry) => entry.ignores ?? []);
    for (const dir of NESTED) expect(ignores).toContain(`${dir}/**`);
  });
});
