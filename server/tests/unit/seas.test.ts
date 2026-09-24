/**
 * Part 10B — the season sea on the server.
 *
 * The rotation itself is the engine's (pinned there); this file pins the two
 * things only the server can get wrong: the ops override, and falling back to
 * the rotation instead of crashing on a bad one.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { currentSeasonSea, seasonNumber, seasonSeaAnnouncement } from '../../src/seas';

describe('the season sea', () => {
  afterEach(() => {
    delete process.env.SEASON_SEA;
  });

  it('follows the rotation with no override', () => {
    expect(currentSeasonSea(0)).toBe(currentSeasonSea(0));
    const a = currentSeasonSea(Date.now());
    expect(['open', 'archipelago', 'coral', 'fogbank', 'strait']).toContain(a);
  });

  it('honours SEASON_SEA when it names a real sea', () => {
    process.env.SEASON_SEA = 'fogbank';
    expect(currentSeasonSea(Date.now())).toBe('fogbank');
    process.env.SEASON_SEA = ' STRAIT ';
    expect(currentSeasonSea(Date.now())).toBe('strait');
  });

  it('falls back to the rotation on a typo rather than failing ranked', () => {
    process.env.SEASON_SEA = 'atlantis';
    const expected = seasonSeaAnnouncement(Date.now()).id;
    process.env.SEASON_SEA = 'atlantis';
    expect(currentSeasonSea(Date.now())).toBe(expected);
    expect(expected).not.toBe('atlantis');
  });

  it('announces the id and the name the Gazette prints', () => {
    process.env.SEASON_SEA = 'coral';
    expect(seasonSeaAnnouncement(123)).toEqual({ id: 'coral', name: 'Coral Reef' });
  });

  it('the season number is the engine’s 28-day period', () => {
    expect(seasonNumber(0)).toBe(1);
    expect(seasonNumber(28 * 24 * 60 * 60 * 1000)).toBe(2);
  });
});
