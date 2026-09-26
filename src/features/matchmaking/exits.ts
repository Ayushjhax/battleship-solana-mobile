/**
 * Leaving a match without leaving a screen behind.
 *
 * Every route here lives in the root native stack, and a native stack keeps
 * EVERY route in its state mounted — hidden, but rendering, subscribed to its
 * stores and running its effects and animations. `router.replace()` only swaps
 * the top route, so the old exits piled screens up:
 *
 *   menu -> placement -> searching -> battle -> result --Play again (replace)-->
 *   [menu, placement, placement]           one more placement per match
 *   [menu, placement, menu]                "Back to menu": two more per match
 *
 * After twenty matches that was twenty hidden placement screens, each
 * re-rendering on every placement-store change (every ship or arsenal drop on
 * the live one), each holding its art in memory, each running the Battle
 * button's endless pulse on the UI thread, and each with a hardware-back
 * handler that outranked the result screen's. It is why the game got slower
 * and warmer the longer a session ran.
 *
 * So the way out of a match is `dismissTo('/menu')`: it pops back to the menu
 * the session started from (or, if the menu is not in the stack — a resumed
 * match replaced it — swaps the current screen for one). "Play again" then
 * pushes the next screen from the menu, the same path the menu's own buttons
 * take. expo-router flushes both in one pass, so the stack goes straight from
 * [menu, placement, result] to [menu, placement] without the menu flashing.
 */
import type { Href } from 'expo-router';

import type { MatchMode } from '@engine/types';

/** The two router calls the exits use — expo-router's `router` satisfies it. */
export interface ExitRouter {
  dismissTo(href: Href): void;
  push(href: Href): void;
}

export type ReplayMode = 'online' | 'ai' | 'hotseat';

/** Back to the menu, dropping every screen of the match on the way. */
export function returnToMenu(router: ExitRouter): void {
  router.dismissTo('/menu');
}

/** Where "Play again" starts: the same screen the menu would open. */
export function replayHref(mode: ReplayMode, ruleset: MatchMode, wagered: boolean): Href {
  if (mode === 'hotseat') return '/hotseat';
  return {
    pathname: '/placement',
    params: { mode, ruleset, wager: wagered ? '1' : '0' },
  };
}

/** "Play again": a fresh placement on top of the menu, never on top of the last one. */
export function playAgain(
  router: ExitRouter,
  mode: ReplayMode,
  ruleset: MatchMode,
  wagered: boolean,
): void {
  returnToMenu(router);
  router.push(replayHref(mode, ruleset, wagered));
}
