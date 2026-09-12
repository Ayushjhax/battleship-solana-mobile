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
