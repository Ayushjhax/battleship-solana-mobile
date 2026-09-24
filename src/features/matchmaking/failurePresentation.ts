export type SearchFailureReason =
  | 'insufficient_points'
  | 'match_cancelled'
  | 'layout_rejected'
  | 'upgrade_required'
  | string;

export interface SearchFailurePresentation {
  readonly title: string;
  readonly primaryAction: 'buy_points' | 'arrange_fleet' | 'retry' | null;
  readonly primaryLabel: string | null;
}

/** Pure presentation policy for terminal matchmaking failures. */
export function searchFailurePresentation(
  reason: SearchFailureReason | undefined,
): SearchFailurePresentation {
  switch (reason) {
    case 'insufficient_points':
      return { title: 'Not enough points', primaryAction: 'buy_points', primaryLabel: 'Buy points' };
    case 'match_cancelled':
      return { title: 'Match cancelled', primaryAction: 'retry', primaryLabel: 'Try again' };
    case 'layout_rejected':
      return { title: 'Fleet not accepted', primaryAction: 'arrange_fleet', primaryLabel: 'Arrange fleet' };
    case 'upgrade_required':
      // Retrying the same binary can never satisfy the protocol gate. Keep
      // this a terminal update screen, with the menu as its only action.
      return { title: 'Update required', primaryAction: null, primaryLabel: null };
    default:
      return { title: 'No connection', primaryAction: 'retry', primaryLabel: 'Try again' };
  }
}
