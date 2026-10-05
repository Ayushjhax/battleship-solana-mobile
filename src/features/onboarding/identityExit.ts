/**
 * Where the name and avatar screens go once the player is done. Pure, so the
 * routing is testable without React Native.
 *
 *   onboarding (no `next`)              name -> avatar -> menu, each replacing the last
 *   an edit from Settings or Profile    (`next=back`) back to where it was opened from
 */
export type IdentityStep = 'name' | 'avatar';
export type IdentityExit = 'back' | 'menu' | 'avatar';

export function identityExit(
  step: IdentityStep,
  next: string | undefined,
  canGoBack: boolean,
): IdentityExit {
  if (step === 'name') {
    if (next === 'back') return canGoBack ? 'back' : 'menu';
    return 'avatar';
  }
  return 'menu';
}
