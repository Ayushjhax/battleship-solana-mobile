/**
 * `over.reveal` on the wire (src/net/protocol.ts): additive, and never able to
 * cost the client the `over` frame itself. Whatever arrives is handed on raw;
 * src/features/reveal/snapshot.ts decides whether it can be drawn.
 */
import { describe, expect, it } from 'vitest';

import { decodeServerMessage } from '../../src/net/protocol';

const OVER = { t: 'over', v: 1, winnerId: 'bob', reason: 'fleet', rewards: { points: 5, coins: 10 } };

describe('the over frame with a reveal', () => {
  it('still decodes without one (an older server)', () => {
    const decoded = decodeServerMessage(OVER);
    expect(decoded.ok).toBe(true);
    if (decoded.ok && decoded.message.t === 'over') expect(decoded.message.reveal).toBeUndefined();
  });

  it('carries a board through untouched', () => {
    const reveal = { ships: [], arsenal: [], marks: { '0,0': 'hit' } };
    const decoded = decodeServerMessage({ ...OVER, reveal });
    expect(decoded.ok).toBe(true);
    if (decoded.ok && decoded.message.t === 'over') expect(decoded.message.reveal).toEqual(reveal);
  });

  it('a malformed reveal does not drop the frame — rewards and all still arrive', () => {
    for (const reveal of [42, 'x', null, { ships: 'nope' }, [1, 2, 3]]) {
      const decoded = decodeServerMessage({ ...OVER, reveal });
      expect(decoded.ok).toBe(true);
      if (decoded.ok && decoded.message.t === 'over') expect(decoded.message.rewards).toEqual({ points: 5, coins: 10 });
    }
  });
});
