/**
 * The Flag Hall — part-08 §5, tested by §7.7.
 *
 * "every country whose captain you have beaten in a ranked online match or a
 *  raid hangs its flag. A counter ('37 / 250') and a wall that fills up."
 *
 * The rule that matters is "recorded ONCE": the wall shows a country, not a
 * tally, and `first_at` is the date you first beat someone from there. The
 * uniqueness is the SQL's (primary key on (user_id, country_code)); this
 * module decides WHEN a flag is earned at all, which is the part with game
 * rules in it.
 */
import type { LayoutContext } from './types';

/** §5 — "beaten in a ranked online match or a raid". */
export function earnsFlag(
  context: LayoutContext,
  outcome: { won: boolean; stars?: number },
): boolean {
  switch (context) {
    case 'ranked':
      // An online win. Offline AI and hot-seat have no captain behind them.
      return outcome.won;
    case 'raid':
      // A raid is "beaten" when it earned at least one star — a raid that
      // achieved nothing did not beat anybody.
      return (outcome.stars ?? 0) > 0;
    case 'war':
    case 'friendly':
      // A fleetmate's flag is not a conquest, and a war is against people you
      // were paired with rather than people you sought out.
      return false;
    default:
      return false;
  }
}

/**
 * The counter's denominator. The wall is "37 / 250", so the total is the size
 * of the country list the picker offers — one number, from one place, or the
 * wall can never be completed.
 */
export function flagProgress(
  earned: readonly string[],
  totalCountries: number,
): { earned: number; total: number; label: string } {
  const unique = new Set(earned.map((c) => c.toUpperCase())).size;
  return { earned: unique, total: totalCountries, label: `${unique} / ${totalCountries}` };
}

/** Newest first is wrong here: a wall fills up, so the order is when you got it. */
export function wallOrder(
  flags: readonly { countryCode: string; firstAt: number }[],
): readonly { countryCode: string; firstAt: number }[] {
  return [...flags].sort((a, b) => a.firstAt - b.firstAt);
}
