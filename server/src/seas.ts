/**
 * The season sea — part-10 §10B, DECISIONS.md D37.
 *
 * Ranked picks ONE sea for both players; the Lighthouse never changes it. The
 * rotation is the engine's table (`seasonSeaFor`), and the date-based season
 * number mirrors the 28-day Captain's Log period. `SEASON_SEA` is the ops
 * override: set it to a sea id to pin the season, and anything unparseable
 * falls back to the rotation rather than crashing ranked.
 */
import { currentSeasonSeaAt, isSeaId, seaSpec, seasonNumberAt, type SeaId } from '@engine/terrain';

export function seasonNumber(now: number): number {
  return seasonNumberAt(now);
}

export function currentSeasonSea(now: number): SeaId {
  const override = process.env.SEASON_SEA?.trim().toLowerCase();
  if (override && isSeaId(override)) return override;
  return currentSeasonSeaAt(now);
}

/** What the Gazette and /config announce: the id and the name. */
export function seasonSeaAnnouncement(now: number): { id: SeaId; name: string } {
  const id = currentSeasonSea(now);
  return { id, name: seaSpec(id).name };
}
