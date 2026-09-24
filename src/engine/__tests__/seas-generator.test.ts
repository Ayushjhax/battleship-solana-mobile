/**
 * Part 10B — the two generator measurements the design names.
 *
 *   1. Each sea admits at least 100,000 legal fleet placements. The real
 *      `autoPlaceFleet` is run 100,000 times on the real sea and EVERY result
 *      is checked with `validateLayout`; the first illegal fleet fails the
 *      build. If a sea's cells left the fleet unplaceable, this hangs or
 *      throws long before the count is reached.
 *   2. Shuffle: 10,000 attempts per sea, zero failures.
 *
 * These are deliberately in their own file with long timeouts so the fast
 * suite stays fast; they are the part's heaviest proof.
 */
import { describe, expect, it } from 'vitest';
import { autoPlaceFleet, validateLayout } from '../placement';
import { createRng } from '../rng';
import { SEAS } from '../terrain';

const PLACEMENTS = 100_000;
const SHUFFLE_ATTEMPTS = 10_000;

describe('the fleet generator on every sea', () => {
  for (const sea of SEAS) {
    it(
      `${sea.id}: admits ${PLACEMENTS.toLocaleString()} legal fleet placements`,
      { timeout: 600_000 },
      () => {
        const rng = createRng(0xc0ffee);
        const problems: string[] = [];
        for (let n = 0; n < PLACEMENTS && problems.length === 0; n++) {
          const fleet = autoPlaceFleet(rng, sea.terrain);
          const check = validateLayout(fleet, sea.terrain);
          if (!check.ok) problems.push(`#${n}: ${check.reason}`);
        }
        expect(problems).toEqual([]);
      },
    );
  }

  for (const sea of SEAS) {
    it(
      `${sea.id}: Shuffle — ${SHUFFLE_ATTEMPTS.toLocaleString()} attempts, zero failures`,
      { timeout: 300_000 },
      () => {
        let failures = 0;
        let firstReason: string | null = null;
        for (let seed = 0; seed < SHUFFLE_ATTEMPTS; seed++) {
          try {
            const fleet = autoPlaceFleet(createRng(seed), sea.terrain);
            const check = validateLayout(fleet, sea.terrain);
            if (!check.ok) {
              failures++;
              firstReason ??= `seed ${seed}: ${check.reason}`;
            }
          } catch (error) {
            failures++;
            firstReason ??= `seed ${seed}: ${String(error)}`;
          }
        }
        expect({ failures, firstReason }).toEqual({ failures: 0, firstReason: null });
      },
    );
  }
});
