/**
 * Regression: "The app becomes progressively slower after playing many
 * matches in one session ... dropping an arsenal item takes around two
 * seconds to appear ... the phone becomes hot during extended play."
 *
 * The cause was the navigation stack, not the network. Every route lives in
 * one native stack, and a native stack keeps every route in its state
 * MOUNTED (NativeStackView renders `state.routes`), hidden but alive. The way
 * out of a match was `router.replace()`, which only swaps the top route:
 *
 *   Play again     [menu, placement, result] -> [menu, placement, placement]
 *   Back to menu   [menu, placement, result] -> [menu, placement, menu]
 *
 * so each match left one or two screens behind for good. After twenty online
 * matches that was 22 mounted screens: twenty placement screens re-rendering
 * on every placement-store change (every ship or arsenal drop on the live
 * one), holding their art, running the Battle button's endless pulse on the
 * UI thread, and each registering a hardware-back handler that outranked the
 * result screen's own.
 *
 * These drive expo-router's REAL StackRouter reducer — the one the app's
 * native stack runs — with the navigation calls the screens make, and the
 * exits from src/features/matchmaking/exits.ts that the result screen uses.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Href } from 'expo-router';
// The reducer itself: pure JS, no React Native, the same file the app bundles.
import { StackRouter } from 'expo-router/build/react-navigation/routers/StackRouter';
import { describe, expect, it } from 'vitest';

import { playAgain, replayHref, returnToMenu } from '../../src/features/matchmaking/exits';

const ROUTE_NAMES = [
  'index',
  'menu',
  '(game)/placement',
  '(game)/searching',
  '(game)/battle',
  '(game)/result',
  '(game)/hotseat',
  'tutorial',
  'how-to-play',
];

type StackState = { routes: { name: string; params?: object }[]; index: number };

/** A router whose calls go through the real reducer, the way expo-router dispatches them. */
function nativeStack() {
  const options = { routeNames: ROUTE_NAMES, routeParamList: {}, routeGetIdList: {} };
  const reducer = StackRouter({});
  let state = reducer.getInitialState(options) as unknown as StackState;

  const nameOf = (href: Href): { name: string; params?: object } => {
    const pathname = typeof href === 'string' ? (href.split('?')[0] as string) : href.pathname;
    const params = typeof href === 'string' ? undefined : (href.params as object | undefined);
    const bare = pathname.replace(/^\//, '');
    const name = ROUTE_NAMES.includes(bare) ? bare : `(game)/${bare}`;
    if (!ROUTE_NAMES.includes(name)) throw new Error(`no route for ${pathname}`);
    return { name, params };
  };
  const dispatch = (type: 'PUSH' | 'REPLACE' | 'POP_TO', href: Href) => {
    const next = reducer.getStateForAction(
      state as never,
      { type, payload: nameOf(href) } as never,
      options as never,
    );
    if (!next) throw new Error(`${type} ${String(href)} refused`);
    state = next as unknown as StackState;
  };

  return {
    router: {
      push: (href: Href) => dispatch('PUSH', href),
      replace: (href: Href) => dispatch('REPLACE', href),
      dismissTo: (href: Href) => dispatch('POP_TO', href),
    },
    /** Every one of these is a mounted screen. */
    routes: () => state.routes.map((route) => route.name),
  };
}

/** app/index.tsx: the boot replaces itself with the menu. */
function booted() {
  const stack = nativeStack();
  stack.router.replace('/menu');
  return stack;
}

const MATCHES = 25;

describe('an online session never accumulates screens', () => {
  it('stays at [menu, placement] however many times "Play again" is pressed', () => {
    const { router, routes } = booted();
    router.push('/placement?mode=online'); // menu.tsx
    let deepest = 0;
    for (let n = 0; n < MATCHES; n += 1) {
      router.push({ pathname: '/searching', params: { wager: '0', opponent: 'player' } }); // placement.tsx
      router.replace('/battle'); // searching.tsx handoff
      router.replace({ pathname: '/result', params: { won: '1' } }); // battle.tsx
      deepest = Math.max(deepest, routes().length);
      playAgain(router, 'online', 'advanced', false); // result.tsx
      expect(routes()).toEqual(['menu', '(game)/placement']);
    }
    expect(deepest).toBe(3);
  });

  it('is back to just the menu after "Menu", match after match', () => {
    const { router, routes } = booted();
    for (let n = 0; n < MATCHES; n += 1) {
      router.push('/placement?mode=online');
      router.push({ pathname: '/searching', params: { wager: '0', opponent: 'player' } });
      router.replace('/battle');
      router.replace({ pathname: '/result', params: { won: '0' } });
      returnToMenu(router); // result.tsx "Menu", and _layout.tsx hardware back on the result
      expect(routes()).toEqual(['menu']);
    }
  });

  it('leaves searching without stranding the placement under a second menu', () => {
    const { router, routes } = booted();
    for (let n = 0; n < MATCHES; n += 1) {
      router.push('/placement?mode=online');
      router.push('/searching');
      returnToMenu(router); // searching.tsx failed panel, "Back to menu"
    }
    expect(routes()).toEqual(['menu']);
  });

  it('recovers a menu when a resumed match had replaced it', () => {
    // ResumeMatchPrompt replaces whatever is on top with the battle, so the
    // menu may not be in the stack at all by the time the result shows.
    const { router, routes } = booted();
    router.replace('/battle');
    router.replace('/result');
    returnToMenu(router);
    expect(routes()).toEqual(['menu']);
  });
});

describe('offline sessions never accumulate screens either', () => {
  it('vs the AI: [menu, placement] after every "Play again"', () => {
    const { router, routes } = booted();
    router.push('/placement?mode=ai');
    for (let n = 0; n < MATCHES; n += 1) {
      router.push('/battle'); // placement.tsx
      router.replace('/result');
      playAgain(router, 'ai', 'classic', false);
      expect(routes()).toEqual(['menu', '(game)/placement']);
    }
  });

  it('hot-seat: back to [menu, hotseat] after every "Play again"', () => {
    const { router, routes } = booted();
    router.push('/hotseat'); // menu tile
    for (let n = 0; n < MATCHES; n += 1) {
      router.push('/placement?mode=hotseat'); // hotseat.tsx
      router.push('/battle');
      router.replace('/result');
      playAgain(router, 'hotseat', 'advanced', false);
      expect(routes()).toEqual(['menu', '(game)/hotseat']);
    }
  });

  it('the tutorial and the rulebook hand back a single menu', () => {
    const { router, routes } = booted();
    for (let n = 0; n < MATCHES; n += 1) {
      router.push('/tutorial');
      returnToMenu(router); // app/tutorial.tsx finish
      router.push('/how-to-play');
      returnToMenu(router); // HowToPlayScreen leave
    }
    expect(routes()).toEqual(['menu']);
  });
});

describe('"Play again" starts the same match the menu would', () => {
  it('keeps the ruleset and the wager for an online rematch', () => {
    expect(replayHref('online', 'classic', true)).toEqual({
      pathname: '/placement',
      params: { mode: 'online', ruleset: 'classic', wager: '1' },
    });
  });

  it('opens a fresh placement against the AI', () => {
    expect(replayHref('ai', 'advanced', false)).toEqual({
      pathname: '/placement',
      params: { mode: 'ai', ruleset: 'advanced', wager: '0' },
    });
  });

  it('goes back through the hot-seat names screen', () => {
    expect(replayHref('hotseat', 'advanced', false)).toBe('/hotseat');
  });

  it('pops to the menu BEFORE pushing, so the push lands on the menu', () => {
    const calls: string[] = [];
    playAgain(
      {
        dismissTo: (href) => calls.push(`dismissTo ${String(href)}`),
        push: () => calls.push('push'),
      },
      'online',
      'advanced',
      false,
    );
    expect(calls).toEqual(['dismissTo /menu', 'push']);
  });
});

describe('no exit from a match replaces its way to the menu', () => {
  // A static guard: `router.replace('/menu')` from inside the match loop is
  // exactly the call that stranded a screen per match.
  const ROOT = join(__dirname, '..', '..');
  const FILES = [
    'app/(game)/battle.tsx',
    'app/(game)/result.tsx',
    'app/(game)/searching.tsx',
    'app/tutorial.tsx',
    'src/features/battle/ConnectionOverlay.tsx',
    'src/features/howToPlay/HowToPlayScreen.tsx',
  ];
  for (const file of FILES) {
    it(`${file} leaves through returnToMenu`, () => {
      const source = readFileSync(join(ROOT, file), 'utf8');
      expect(source).not.toMatch(/router\.replace\(\s*['"]\/menu['"]/);
    });
  }

  it('result.tsx never replaces itself with the next match', () => {
    const source = readFileSync(join(ROOT, 'app/(game)/result.tsx'), 'utf8');
    expect(source).not.toMatch(/router\.replace\(/);
  });

  it("the root back handler's result branch pops to the menu", () => {
    const source = readFileSync(join(ROOT, 'app/_layout.tsx'), 'utf8');
    expect(source).toMatch(/pathname\.includes\('result'\)\) returnToMenu\(router\)/);
  });
});
