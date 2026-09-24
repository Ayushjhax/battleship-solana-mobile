import { describe, expect, it } from 'vitest';

import { parseSeasonWindows } from '../liveWorld';

describe('living-world server configuration', () => {
  it('accepts the two shipped overlay ids', () => {
    expect(
      parseSeasonWindows(
        JSON.stringify([
          { id: 'winter', startsAt: 10, endsAt: 20 },
          { id: 'lantern-festival', startsAt: 30, endsAt: 40 },
        ]),
      ),
    ).toHaveLength(2);
  });

  it('fails closed for malformed or unknown decoration config', () => {
    expect(parseSeasonWindows('{')).toEqual([]);
    expect(parseSeasonWindows(JSON.stringify([{ id: 'combat-bonus', startsAt: 1, endsAt: 2 }]))).toEqual([]);
    expect(parseSeasonWindows(JSON.stringify([{ id: 'winter', startsAt: 2, endsAt: 1 }]))).toEqual([]);
  });
});
