/**
 * Feature flags — 00-OVERVIEW.md §5, DECISIONS.md D4.
 *
 * There was no flag mechanism in this repo before Part 1. This is the minimum
 * that satisfies "every part ships behind its flag, default OFF in production":
 * environment variables on the server, surfaced at GET /config, cached by the
 * client. It is deliberately not a remote-config system — it is the first
 * flag, shaped so the other eleven can join it without a redesign.
 *
 * Default is OFF for every flag. A flag is on only when its variable is
 * exactly one of "1", "true", "on" or "yes" (case-insensitive), so a typo or
 * an empty string can never accidentally enable a feature in production.
 */

export const FEATURE_KEYS = [
  'portCity.core',
  'portCity.cosmetics',
  'portCity.bounties',
  'portCity.academy',
  'portCity.raids',
  'portCity.fleets',
  'portCity.gazette',
  'portCity.voyages',
  'portCity.captains',
  'portCity.seas',
  'portCity.worldBoss',
  'portCity.empire',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type FeatureMap = Readonly<Record<FeatureKey, boolean>>;

/** 'portCity.core' -> 'PORT_CITY_CORE'. */
export function envNameFor(key: FeatureKey): string {
  const [, feature = ''] = key.split('.');
  const snake = feature.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
  return `PORT_CITY_${snake}`;
}

const TRUTHY = new Set(['1', 'true', 'on', 'yes']);

export function isEnabled(key: FeatureKey): boolean {
  const raw = process.env[envNameFor(key)];
  return raw !== undefined && TRUTHY.has(raw.trim().toLowerCase());
}

export function featureMap(): FeatureMap {
  const out = {} as Record<FeatureKey, boolean>;
  for (const key of FEATURE_KEYS) out[key] = isEnabled(key);
  return out;
}

/**
 * The feature names (minus the `portCity.` prefix) that gate a city plot, in
 * the shape src/engine/city's canStart() wants.
 */
export function enabledPlotFeatures(): ReadonlySet<string> {
  const out = new Set<string>();
  for (const key of FEATURE_KEYS) {
    if (!isEnabled(key)) continue;
    const [, feature] = key.split('.');
    if (feature && feature !== 'core') out.add(feature);
  }
  return out;
}

/** The whole city API is dark unless this is on. */
export function cityEnabled(): boolean {
  return isEnabled('portCity.core');
}
