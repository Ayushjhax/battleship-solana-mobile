import type { SeasonOverlayId, SeasonWindow } from '@engine/liveWorld';

const IDS = new Set<SeasonOverlayId>(['winter', 'lantern-festival']);

/**
 * PORT_CITY_SEASON_WINDOWS is a JSON array. Invalid operations config fails
 * closed to no overlays; decoration must never prevent the server starting.
 */
export function parseSeasonWindows(raw: string | undefined): readonly SeasonWindow[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry): SeasonWindow[] => {
      if (!entry || typeof entry !== 'object') return [];
      const candidate = entry as Record<string, unknown>;
      if (
        !IDS.has(candidate.id as SeasonOverlayId) ||
        typeof candidate.startsAt !== 'number' ||
        typeof candidate.endsAt !== 'number' ||
        candidate.endsAt <= candidate.startsAt
      )
        return [];
      return [
        {
          id: candidate.id as SeasonOverlayId,
          startsAt: candidate.startsAt,
          endsAt: candidate.endsAt,
        },
      ];
    });
  } catch {
    return [];
  }
}

