import { describe, expect, it } from 'vitest';

import { minimumProtocolForFeatures } from '../protocol';

describe('Port City protocol gate', () => {
  it('preserves protocol 1 when every wire-changing flag is off', () => {
    expect(minimumProtocolForFeatures({ academy: false, captains: false, seas: false })).toBe(1);
  });

  it('requires protocol 2 for Academy layouts', () => {
    expect(minimumProtocolForFeatures({ academy: true, captains: false, seas: false })).toBe(2);
  });

  it.each([
    { academy: false, captains: true, seas: false },
    { academy: false, captains: false, seas: true },
    { academy: true, captains: true, seas: true },
  ])('requires protocol 3 for captain or sea frames: %o', (features) => {
    expect(minimumProtocolForFeatures(features)).toBe(3);
  });
});
