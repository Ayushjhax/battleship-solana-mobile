/**
 * The Port City feature APIs' retry policy — three numbers, no imports.
 *
 * Split out of `featureClient.ts` because that file imports `@/state/demo`,
 * which installs expo-sqlite's localStorage shim at module scope. Under
 * vitest's node environment that import fails, so a test that only wanted to
 * assert "we retry three times" could not load the module at all
 * (DECISIONS.md D18 — the same hoisting hazard Part 1 hit).
 *
 * A policy is data. It does not need a transport to be read.
 */

/** Network-error retries only. A 409 is never retried. */
export const MAX_ATTEMPTS = 3;

/** Backoff between attempts, multiplied by the attempt number. */
export const RETRY_DELAY_MS = 600;

/**
 * Longer than a 3G round trip, shorter than a player's patience. A raid
 * action that takes longer than this has already lost the player's attention.
 */
export const TIMEOUT_MS = 12_000;
