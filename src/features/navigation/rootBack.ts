/**
 * What the root layout's Android back handler (app/_layout.tsx) does on each
 * route. Pure, so the routing can be tested without React Native.
 *
 * The root handler is re-registered on every route change, which makes it the
 * NEWEST listener, and React Native calls the newest listener first. A screen
 * with back behaviour of its own therefore only sees the press when this says
 * 'screen'.
 */
export type RootBackAction =
  /** Let the screen's own handler have it (the root handler returns false). */
  | 'screen'
  /** Swallow the press. */
  | 'ignore'
  /** Leave the match's screens for the menu. */
  | 'menu'
  /** Pop one screen, or go to the menu when there is nothing to pop. */
  | 'back';

export function rootBackAction(pathname: string): RootBackAction {
  // Battle/tutorial, placement and the port city own richer back behaviour
  // (the city's plays its exit and returns home exactly once). Searching
  // cancels the search: popping it alone left the socket in line (BUG-004).
  // How to Play turns back a page before it leaves (BUG-014).
  if (
    pathname.includes('battle') ||
    pathname === '/tutorial' ||
    pathname.includes('placement') ||
    pathname === '/city' ||
    pathname === '/searching' ||
    pathname === '/how-to-play'
  ) {
    return 'screen';
  }
  if (pathname === '/' || pathname === '/menu') return 'ignore';
  // The winner's-base reveal leaves by itself in five seconds, to the defeat
  // screen. Back neither skips it nor returns to the battle.
  if (pathname === '/reveal') return 'ignore';
  if (pathname.includes('result')) return 'menu';
  return 'back';
}
