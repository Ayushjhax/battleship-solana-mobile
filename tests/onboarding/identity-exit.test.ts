/**
 * Where the name and avatar screens go when the player is done.
 *
 * BUG-007: the avatar screen always replaced itself with the menu. Opened from
 * Settings or Profile ("Change avatar"), that put a second menu on top of
 * Settings — [menu, settings, menu] — one more hidden, still-rendering screen
 * per change (the pile-up src/features/matchmaking/exits.ts was written to
 * stop), and the player landed on the menu instead of back where they were.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { identityExit } from '../../src/features/onboarding/identityExit';

const ROOT = join(__dirname, '..', '..');

describe('identityExit', () => {
  it('walks onboarding forward: name -> avatar -> menu', () => {
    expect(identityExit('name', undefined, false)).toBe('avatar');
    expect(identityExit('avatar', undefined, false)).toBe('menu');
  });

  it('returns a name edit to where it was opened', () => {
    expect(identityExit('name', 'back', true)).toBe('back');
    expect(identityExit('name', 'back', false)).toBe('menu');
  });

  it('returns an avatar edit to where it was opened, instead of stacking a menu', () => {
    expect(identityExit('avatar', 'back', true)).toBe('back');
    expect(identityExit('avatar', 'back', false)).toBe('menu');
  });

  it.each(['app/settings.tsx', 'app/profile.tsx'])('%s opens both editors as edits', (file) => {
    const source = readFileSync(join(ROOT, file), 'utf8');
    expect(source).not.toMatch(/router\.push\(\s*['"]\/avatar['"]\s*\)/);
    expect(source).toMatch(/pathname:\s*'\/avatar',\s*params:\s*\{\s*next:\s*'back'\s*\}/);
  });

  it('the avatar screen reads the `next` it was opened with', () => {
    const source = readFileSync(join(ROOT, 'app/(onboarding)/avatar.tsx'), 'utf8');
    expect(source).toMatch(/identityExit\('avatar', next,/);
  });
});
