/**
 * The client's view of the server's feature flags — DECISIONS.md D4.
 *
 * `portCity.core` OFF must reproduce today's app exactly, so this defaults to
 * every flag off and only turns one on when the server says so. A failed or
 * absent /config leaves the city dark, which is the safe direction.
 *
 * Cached in memory for the session and refreshed on demand; there is no
 * polling. A flag flipping mid-session is handled by the endpoints returning
 * `feature-off`, which the city screen already has to cope with (§6).
 */
import { fetchConfig } from './api';
import type { CityFlag } from './flagKeys';
import type { FeatureConfig } from './types';

// The names live in an import-free module so they can be read (and pinned
// against the server's list) without loading the whole RN stack.
export { CITY_FLAGS, type CityFlag } from './flagKeys';

let cached: Readonly<Record<string, boolean>> | null = null;
let inFlight: Promise<Readonly<Record<string, boolean>>> | null = null;
let configCache: FeatureConfig | null = null;

/** Flags as last seen. Everything is off until /config says otherwise. */
export function flags(): Readonly<Record<string, boolean>> {
  return cached ?? {};
}

export function livingWorldConfig(): FeatureConfig['livingWorld'] {
  return configCache?.livingWorld;
}

/**
 * Part 10B — the season sea as /config last announced it, or null when the
 * seas flag is off / the server could not be reached. Ranked players need
 * this BEFORE placement, which is why it rides the unauthenticated config.
 */
export function seasonSea(): { id: string; name: string } | null {
  return configCache?.seasonSea ?? null;
}

export function isFlagOn(flag: CityFlag): boolean {
  return flags()[flag] === true;
}

/** True when the Port City should do anything at all. */
export function cityEnabled(): boolean {
  return isFlagOn('portCity.core');
}

/**
 * Fetches once per session unless `force` is set. Never throws: a server that
 * cannot be reached leaves every flag off.
 */
export async function loadFlags(force = false): Promise<Readonly<Record<string, boolean>>> {
  if (cached && !force) return cached;
  if (inFlight && !force) return inFlight;

  inFlight = (async () => {
    try {
      const config = await fetchConfig();
      configCache = config;
      cached = config.features ?? {};
    } catch {
      cached = cached ?? {};
    } finally {
      inFlight = null;
    }
    return cached ?? {};
  })();

  return inFlight;
}

/** Test-only, and used by sign-out so a new account re-reads the server. */
export function __resetFlagsForTests(next: Readonly<Record<string, boolean>> | null = null): void {
  cached = next;
  configCache = null;
  inFlight = null;
}
