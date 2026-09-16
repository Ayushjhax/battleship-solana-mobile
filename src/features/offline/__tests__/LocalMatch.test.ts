import { reduce } from '@engine/match';
import { autoPlaceFleet } from '@engine/placement';
import { createRng } from '@engine/rng';
import type { MatchAction } from '@engine/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalMatch, setLocalAiThinkTime } from '../LocalMatch';

function makeLocal(
  seed: number,
  onResolved: ConstructorParameters<typeof LocalMatch>[0]['onResolved'],
) {
  return new LocalMatch({
    mode: 'ai',
    ruleset: 'classic',
    seed,
    difficulty: 'normal',
    one: { id: 'player', ships: autoPlaceFleet(createRng(seed + 1)), arsenal: [] },
    two: { id: 'ai', ships: autoPlaceFleet(createRng(seed + 2)), arsenal: [] },
    onResolved,
  });
}

afterEach(() => {
  setLocalAiThinkTime(900, 500);
  vi.useRealTimers();
});

describe('LocalMatch', () => {
  it('plays on the exact board each side submitted', () => {
    // The end of the chain the placement screen starts: whatever reaches
    // LocalMatch must be what sits on the board once the match begins.
    const seed = 404;
    const mine = autoPlaceFleet(createRng(seed + 1));
    const theirs = autoPlaceFleet(createRng(seed + 2));
    const local = new LocalMatch({
      mode: 'ai',
      ruleset: 'advanced',
      seed,
      difficulty: 'normal',
      one: { id: 'player', ships: mine, arsenal: [{ id: 'torp-1', kind: 'torpedoBomber' }] },
      two: { id: 'ai', ships: theirs, arsenal: [] },
      onResolved: () => {},
    });

    const [player, ai] = local.state.players;
    expect(player?.board.ships.map((s) => ({ ...s, hits: [] }))).toEqual(
      mine.map((s) => ({ ...s, hits: [] })),
    );
    expect(ai?.board.ships.map((s) => ({ ...s, hits: [] }))).toEqual(
      theirs.map((s) => ({ ...s, hits: [] })),
    );
    expect(player?.board.arsenal).toEqual([{ id: 'torp-1', kind: 'torpedoBomber' }]);
    local.dispose();
  });

  it('reports the reason when it has to replace a rejected layout', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seed = 505;
    const local = new LocalMatch({
      mode: 'ai',
      ruleset: 'classic',
      seed,
      difficulty: 'normal',
      // One ship short: the reducer refuses this composition.
      one: { id: 'player', ships: autoPlaceFleet(createRng(seed)).slice(1), arsenal: [] },
      two: { id: 'ai', ships: autoPlaceFleet(createRng(seed + 2)), arsenal: [] },
      onResolved: () => {},
    });

    // The match still starts — an unplayable match is worse — but the swap is
    // never silent, because it means the board the player arranged is gone.
    expect(local.state.phase).toBe('playing');
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain('rejected');
    error.mockRestore();
    local.dispose();
  });

  it('emits the exact reducer result for a player action', () => {
    const emitted: { action: MatchAction; events: readonly string[] }[] = [];
    const local = makeLocal(11, (action, result) => {
      emitted.push({ action, events: result.events.map((event) => event.type) });
    });
    const actor = local.state.turn;
    const action: MatchAction = { type: 'FIRE', playerId: actor, at: { r: 0, c: 0 } };
    const expected = reduce(local.state, action);

    const actual = local.dispatch(action);

    expect(actual.accepted).toBe(true);
    expect(actual.result).toEqual(expected);
    expect(local.state).toEqual(expected.state);
    expect(emitted).toEqual([{ action, events: expected.events.map((event) => event.type) }]);
    local.dispose();
  });

  it('drives the AI only after its configured thinking delay', () => {
    vi.useFakeTimers();
    setLocalAiThinkTime(900, 0);
    const resolved = vi.fn();
    let seed = 1;
    let local = makeLocal(seed, resolved);
    while (local.state.turn !== 'ai') {
      local.dispose();
      seed += 1;
      local = makeLocal(seed, resolved);
    }

    local.driveAi();
    vi.advanceTimersByTime(899);
    expect(resolved).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(resolved).toHaveBeenCalledTimes(1);
    expect(resolved.mock.calls[0]?.[0].playerId).toBe('ai');
    local.dispose();
  });
});
