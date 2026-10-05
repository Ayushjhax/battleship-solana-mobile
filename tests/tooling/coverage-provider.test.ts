/**
 * BUG-024: `npm run test:coverage` — the command tests/README.md gives for the
 * app's coverage — died with MISSING DEPENDENCY. vitest.config.ts asks for the
 * v8 provider, but `@vitest/coverage-v8` was only ever a devDependency of the
 * server. The provider also pins vitest's exact version as a peer, so the two
 * have to move together.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

describe('app coverage tooling', () => {
  it('declares the coverage provider vitest.config.ts uses', () => {
    expect(read('vitest.config.ts')).toMatch(/provider:\s*'v8'/);
    const pkg = JSON.parse(read('package.json')) as { devDependencies: Record<string, string> };
    expect(pkg.devDependencies['@vitest/coverage-v8']).toBeDefined();
  });

  it('has the provider installed on the same version as vitest', () => {
    const provider = 'node_modules/@vitest/coverage-v8/package.json';
    expect(existsSync(join(ROOT, provider))).toBe(true);
    const version = (path: string) => (JSON.parse(read(path)) as { version: string }).version;
    expect(version(provider)).toBe(version('node_modules/vitest/package.json'));
  });
});
