/**
 * BUG-001: only a match the server runs from start to finish may carry a
 * stake. The app used to stake points on a match against its own AI and then
 * report the result itself, which the server paid out on its word. The server
 * routes are gone; this keeps the app from growing a path back to them.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = join(dir, name);
    if (name === '__tests__' || name === 'node_modules') return [];
    if (statSync(join(ROOT, rel)).isDirectory()) return sources(rel);
    return /\.(ts|tsx)$/.test(name) ? [rel] : [];
  });
}

const REMOVED = ['/points/wager/reserve', '/points/wager/settle', 'stakeOfflineWager', 'settleOfflineWager'];

describe('the app has no offline wager left', () => {
  it('never calls the removed reserve/settle routes', () => {
    const offenders = [...sources('app'), ...sources('src')].flatMap((file) => {
      const text = readFileSync(join(ROOT, file), 'utf8');
      return REMOVED.filter((needle) => text.includes(needle)).map((needle) => `${file}: ${needle}`);
    });
    expect(offenders).toEqual([]);
  });
});
