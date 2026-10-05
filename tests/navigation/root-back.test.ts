/**
 * Where Android's back button goes on each route (app/_layout.tsx asks
 * rootBackAction()). The root handler is the newest listener after every
 * route change, so it runs before any screen's own: a screen only gets the
 * press when this says 'screen'.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { rootBackAction } from '../../src/features/navigation/rootBack';

const ROOT = join(__dirname, '..', '..');

describe('rootBackAction', () => {
  it.each([
    ['/battle', 'screen'],
    ['/demo-battle', 'screen'],
    ['/tutorial', 'screen'],
    ['/placement', 'screen'],
    ['/city', 'screen'],
    ['/', 'ignore'],
    ['/menu', 'ignore'],
    ['/reveal', 'ignore'],
    ['/result', 'menu'],
    ['/leaderboard', 'back'],
    ['/settings', 'back'],
  ] as const)('%s -> %s', (pathname, action) => {
    expect(rootBackAction(pathname)).toBe(action);
  });

  // BUG-004: back on "Finding an opponent" popped the screen without leaving
  // the queue. The socket stayed in line (with any stake held); when a match
  // came, nobody sent the fleet or opened the battle, and the player lost on
  // timeouts without ever seeing it. The screen cancels on back itself.
  it('lets the searching screen handle back, so leaving it also leaves the queue', () => {
    expect(rootBackAction('/searching')).toBe('screen');
  });

  it('the searching screen answers back by cancelling the search', () => {
    const source = readFileSync(join(ROOT, 'app/(game)/searching.tsx'), 'utf8');
    const handler = /BackHandler\.addEventListener\(\s*'hardwareBackPress',[\s\S]{0,200}?cancel/i;
    expect(source).toMatch(handler);
  });
});
