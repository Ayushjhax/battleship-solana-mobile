/**
 * The performance budgets from part-02 §9 and §10, as plain values.
 *
 * They live outside the components on purpose: this repo has no React renderer
 * in its test setup, so anything imported from a .tsx drags react-native into
 * vitest and fails to parse. Keeping the budgets here is what makes them
 * assertable at all — see tests/city/cityUi.test.ts.
 */

/**
 * How many animated nodes AmbientLayer mounts: 2 gulls + 1 boat + 1 crane arm.
 * §9 caps the whole ambient system at 30.
 */
export const AMBIENT_NODE_BUDGET = 4;

/** §9's ceiling, for the test to compare against. */
export const AMBIENT_NODE_LIMIT = 30;

/**
 * Dock workers cap at four (NUMBERS.md), so at most four plots can have a job
 * running — which is the real bound on §10's "only the building under
 * construction re-renders on the 1 s tick".
 */
export const MAX_TICKING_PLOTS = 4;

/** How many plots currently have a job. Drives the tick subscription. */
export function runningJobCount(
  buildings: Readonly<Record<string, { readonly upgrading?: unknown }>>,
): number {
  return Object.values(buildings).filter((b) => b.upgrading !== undefined).length;
}
