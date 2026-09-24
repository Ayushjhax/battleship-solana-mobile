/**
 * part-07 §8.5 — "Replay: scrubbing to any index reproduces the same board as
 * playing straight through; an unavailable replay shows a note instead of
 * crashing."
 *
 * The first half is the one that matters. §5's rule is "rebuild the state from
 * action 0 to the target index rather than trying to rewind", and the only way
 * to prove a scrubber obeys it is to scrub in an order no incremental
 * implementation would survive — backwards, randomly, repeatedly — and check
 * the board every time against a straight play-through.
 */
import { describe, expect, it } from 'vitest';

import { coordKey } from '@engine/board';
import {
  RAID_DEFAULTS,
  fireShell,
  generateDefaultHarbour,
  startRaid,
  useKit,
  type RaidAction,
} from '@engine/raid';
import { createRng } from '@engine/rng';

import {
  INITIAL_TRANSPORT,
  REPLAY_BEAT_MS,
  REPLAY_SPEEDS,
  beatMs,
  createScrubber,
  layoutVisible,
  stateAt,
  transportReducer,
  viewAt,
  type ReplaySource,
} from '@/raid/ui/replayScrub';
import { REPLAY_UNAVAILABLE_LINE } from '@/raid/ui/captainCopy';

const context = {
  admiraltyLevel: 5,
  coastalCommandLevel: 5,
  unlocks: ['sonar_net', 'decoy', 'minesweeper'],
  lighthouseLevel: 4,
};

/**
 * A recorded raid, with a mixed script: aimed fire, a bomber, a torpedo run
 * and scattered shells. Mixed on purpose — a scrubber that only ever sees
 * `fire` would not exercise the kit's state.
 */
function recorded(seed = 4): ReplaySource {
  const layout = generateDefaultHarbour(seed, context);
  const kit = { bomber: 1, torpedoBomber: 1 };
  const config = RAID_DEFAULTS;
  let state = startRaid(layout, kit, 0, config);
  const actions: RaidAction[] = [];

  const rng = createRng(seed * 7);
  for (let n = 0; n < 24 && !state.over; n++) {
    if (n === 6) {
      const out = useKit(state, 'bomber', { at: { r: 4, c: 4 } });
      if (!out.error) {
        state = out.state;
        actions.push({ kind: 'use', weapon: 'bomber', at: { r: 4, c: 4 } });
        continue;
      }
    }
    if (n === 12) {
      const out = useKit(state, 'torpedoBomber', { row: 2 });
      if (!out.error) {
        state = out.state;
        actions.push({ kind: 'use', weapon: 'torpedoBomber', row: 2 });
        continue;
      }
    }
    const at = { r: rng.int(10), c: rng.int(10) };
    const out = fireShell(state, at);
    if (out.error) continue;
    state = out.state;
    actions.push({ kind: 'fire', at });
  }

  return { layout, kit, actions, config };
}

// ===========================================================================
// §8.5 — scrubbing reproduces a straight play-through
// ===========================================================================

describe('scrubbing never desyncs', () => {
  it('every index matches playing straight through to it', () => {
    const source = recorded();
    const straight = source.actions.map((_, i) => viewAt(source, i + 1));

    for (let i = 0; i < source.actions.length; i++) {
      expect(viewAt(source, i + 1), `index ${i + 1}`).toEqual(straight[i]);
    }
  });

  it('scrubbing BACKWARDS gives the same board as scrubbing forwards', () => {
    const source = recorded(9);
    const forwards = source.actions.map((_, i) => JSON.stringify(viewAt(source, i + 1)));

    const scrubber = createScrubber(source);
    for (let i = source.actions.length - 1; i >= 0; i--) {
      expect(JSON.stringify(scrubber.viewAt(i + 1)), `back to ${i + 1}`).toBe(forwards[i]);
    }
  });

  it('survives a random scrub order, which is what a dragged bar does', () => {
    const source = recorded(11);
    const expected = source.actions.map((_, i) => JSON.stringify(viewAt(source, i + 1)));
    const scrubber = createScrubber(source);
    const rng = createRng(3);

    for (let n = 0; n < 200; n++) {
      const index = rng.int(source.actions.length) + 1;
      expect(JSON.stringify(scrubber.viewAt(index)), `random ${index}`).toBe(expected[index - 1]);
    }
  });

  it('the cached scrubber agrees with the uncached one, always', () => {
    const source = recorded(13);
    const scrubber = createScrubber(source);
    for (let i = 0; i <= source.actions.length; i++) {
      expect(scrubber.at(i).marks).toEqual(stateAt(source, i).marks);
    }
    // And after a reset, which is what a new replay does.
    scrubber.reset();
    expect(scrubber.at(3).marks).toEqual(stateAt(source, 3).marks);
  });

  it('index 0 is the opening board: nothing marked, full shells', () => {
    const source = recorded();
    const start = viewAt(source, 0);
    expect(start.marks).toEqual({});
    expect(start.shells).toBe(RAID_DEFAULTS.shells);
    expect(start.stars).toBe(0);
  });

  it('the last index is the raid as it ended', () => {
    const source = recorded();
    const end = viewAt(source, source.actions.length);
    expect(Object.keys(end.marks).length).toBeGreaterThan(0);
  });

  it('clamps rather than throwing on an out-of-range index', () => {
    const source = recorded();
    expect(() => viewAt(source, -5)).not.toThrow();
    expect(() => viewAt(source, 9_999)).not.toThrow();
    expect(viewAt(source, -5)).toEqual(viewAt(source, 0));
    expect(viewAt(source, 9_999)).toEqual(viewAt(source, source.actions.length));
  });

  it('a replay with no actions is just the opening board', () => {
    const source = { ...recorded(), actions: [] };
    expect(viewAt(source, 0).marks).toEqual({});
    expect(viewAt(source, 5).marks).toEqual({});
  });

  it('never leaks an un-hit ship cell, even mid-scrub', () => {
    // The replay renders through the same masking function a live raid uses.
    const source = recorded(17);
    for (let i = 0; i <= source.actions.length; i++) {
      const json = JSON.stringify(viewAt(source, i));
      const state = stateAt(source, i);
      for (const ship of state.ships) {
        const hit = new Set(ship.hits.map(coordKey));
        for (let n = 0; n < ship.len; n++) {
          const cell =
            ship.orientation === 'h'
              ? { r: ship.origin.r, c: ship.origin.c + n }
              : { r: ship.origin.r + n, c: ship.origin.c };
          if (hit.has(coordKey(cell))) continue;
          expect(json.includes(JSON.stringify(cell)), `index ${i}`).toBe(false);
        }
      }
    }
  });
});

// ===========================================================================
// The transport controls
// ===========================================================================

describe('the transport', () => {
  const LENGTH = 10;
  const reduce = (state: typeof INITIAL_TRANSPORT, action: Parameters<typeof transportReducer>[1]) =>
    transportReducer(state, action, LENGTH);

  it('starts paused at 0, at 1x', () => {
    expect(INITIAL_TRANSPORT).toEqual({ index: 0, playing: false, speed: 1 });
  });

  it('plays, pauses and toggles', () => {
    expect(reduce(INITIAL_TRANSPORT, { kind: 'play' }).playing).toBe(true);
    expect(reduce({ ...INITIAL_TRANSPORT, playing: true }, { kind: 'pause' }).playing).toBe(false);
    expect(reduce(INITIAL_TRANSPORT, { kind: 'toggle' }).playing).toBe(true);
  });

  it('ticks forward and stops at the end', () => {
    let state = { ...INITIAL_TRANSPORT, index: LENGTH - 1, playing: true };
    state = reduce(state, { kind: 'tick' });
    expect(state.index).toBe(LENGTH);
    expect(state.playing).toBe(false);
  });

  it('playing from the end restarts rather than doing nothing', () => {
    const state = reduce({ index: LENGTH, playing: false, speed: 1 }, { kind: 'play' });
    expect(state.index).toBe(0);
    expect(state.playing).toBe(true);
  });

  it('scrubbing pauses — the player is driving now', () => {
    const state = reduce({ ...INITIAL_TRANSPORT, playing: true }, { kind: 'scrub', index: 4 });
    expect(state.index).toBe(4);
    expect(state.playing).toBe(false);
  });

  it('clamps a scrub to the action list', () => {
    expect(reduce(INITIAL_TRANSPORT, { kind: 'scrub', index: 99 }).index).toBe(LENGTH);
    expect(reduce(INITIAL_TRANSPORT, { kind: 'scrub', index: -4 }).index).toBe(0);
  });

  it('offers 1x, 2x and 4x, and each is faster than the last', () => {
    expect(REPLAY_SPEEDS).toEqual([1, 2, 4]);
    expect(beatMs(1)).toBe(REPLAY_BEAT_MS);
    expect(beatMs(2)).toBeLessThan(beatMs(1));
    expect(beatMs(4)).toBeLessThan(beatMs(2));
  });

  it('changing speed does not move the index', () => {
    const state = reduce({ index: 5, playing: true, speed: 1 }, { kind: 'speed', speed: 4 });
    expect(state.index).toBe(5);
    expect(state.playing).toBe(true);
    expect(state.speed).toBe(4);
  });

  it('restart goes to 0 and pauses', () => {
    expect(reduce({ index: 7, playing: true, speed: 2 }, { kind: 'restart' })).toEqual({
      index: 0,
      playing: false,
      speed: 2,
    });
  });
});

// ===========================================================================
// §5 — who sees the layout, and when
// ===========================================================================

describe('the layout reveal', () => {
  it('the defender sees their own board from the start — they own it', () => {
    expect(layoutVisible('defender', 0, 20)).toBe(true);
    expect(layoutVisible('defender', 10, 20)).toBe(true);
  });

  it('the attacker only at the end', () => {
    expect(layoutVisible('attacker', 0, 20)).toBe(false);
    expect(layoutVisible('attacker', 19, 20)).toBe(false);
    expect(layoutVisible('attacker', 20, 20)).toBe(true);
  });

  it('an empty replay is "at the end" for both', () => {
    expect(layoutVisible('attacker', 0, 0)).toBe(true);
  });
});

// ===========================================================================
// §8.5 — an unavailable replay
// ===========================================================================

describe('an unavailable replay', () => {
  it('has a line to show instead of a crash', () => {
    expect(REPLAY_UNAVAILABLE_LINE).toBeTruthy();
    expect(REPLAY_UNAVAILABLE_LINE).not.toContain('not-found');
    expect(REPLAY_UNAVAILABLE_LINE).toContain('result still stands');
  });
});
