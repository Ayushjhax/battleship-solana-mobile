/**
 * Render/generation counters for the two performance rules in P01:
 *   - the graph paper renders once, ever
 *   - rough paths are generated on mount and never again
 *
 * Flip DEBUG_RENDERS to true and watch the console (or the kitchen-sink
 * readout). Off by default so it costs nothing in a real match.
 */
export const DEBUG_RENDERS = false;

export const roughStats = {
  /** Rough.js drawables actually generated (cache misses). */
  generated: 0,
  /** Lookups served from the path cache. */
  cacheHits: 0,
};

export const renderStats: Record<string, number> = {};

export function countRender(label: string): void {
  renderStats[label] = (renderStats[label] ?? 0) + 1;
  if (__DEV__ && DEBUG_RENDERS) console.count(`render ${label}`);
}
