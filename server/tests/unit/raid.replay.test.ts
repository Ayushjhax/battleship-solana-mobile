/**
 * Replays — part-06 §8, §11.
 *
 * "Replaying the stored actions reproduces the same stars, destruction and
 * marks, bit for bit, and a version mismatch falls back without throwing."
 */
import { describe, expect, it } from 'vitest';

import { cellsOf } from '@engine/board';
import {
  RAID_DEFAULTS,
  fireShell,
  generateDefaultHarbour,
  raidScore,
  raidView,
  startRaid,
  useKit,
  type RaidAction,
  type RaidState,
} from '@engine/raid';

import { RAID_ENGINE_VERSION } from '../../src/raid/config';
import { buildReplay, replayCaptainLine, type StoredReplay } from '../../src/raid/replay';

const A = 'attacker-1';
const D = 'defender-1';

const context = {
  admiraltyLevel: 5,
  coastalCommandLevel: 5,
  unlocks: ['sonar_net', 'decoy', 'minesweeper'],
};

/** Runs a real raid and returns exactly what the database would have stored. */
function recordRaid(seed = 3): { stored: StoredReplay; live: RaidState } {
  const layout = generateDefaultHarbour(seed, context);
  const kit = { bomber: 1, torpedoBomber: 1 };
  let state = startRaid(layout, kit, 0, RAID_DEFAULTS);

  const actions: RaidAction[] = [];
  const results: unknown[] = [];

  const push = (action: RaidAction, out: { shellDelta: number; events: readonly unknown[] }) => {
    actions.push(action);
    results.push({ shellDelta: out.shellDelta, events: out.events });
  };

  // A mixed script: aimed fire, a bomber, a torpedo run, then loose shells.
  const aimed = cellsOf(layout.ships[0]!);
  for (const at of aimed) {
    if (state.over) break;
    const out = fireShell(state, at);
    if (out.error) continue;
    state = out.state;
    push({ kind: 'fire', at }, out);
  }

  const bomb = useKit(state, 'bomber', { at: { r: 5, c: 5 } });
  if (!bomb.error) {
    state = bomb.state;
    push({ kind: 'use', weapon: 'bomber', at: { r: 5, c: 5 } }, bomb);
  }

  const torpedo = useKit(state, 'torpedoBomber', { row: 3 });
  if (!torpedo.error) {
    state = torpedo.state;
    push({ kind: 'use', weapon: 'torpedoBomber', row: 3 }, torpedo);
  }

  for (let r = 0; r < 10 && !state.over; r++) {
    const out = fireShell(state, { r, c: 9 });
    if (out.error) continue;
    state = out.state;
    push({ kind: 'fire', at: { r, c: 9 } }, out);
  }

  const score = raidScore(state);
  return {
    live: state,
    stored: {
      raidId: 'raid-1',
      attackerId: A,
      defenderId: D,
      coveSeed: null,
      endedAt: '2026-09-23T00:00:00Z',
      stars: score.stars,
      destruction: score.destruction,
      endReason: state.endReason ?? 'retreat',
      layout,
      kit,
      config: RAID_DEFAULTS,
      actions,
      results,
      engineVersion: RAID_ENGINE_VERSION,
    },
  };
}

describe('replay', () => {
  it('reproduces stars, destruction and marks bit for bit', () => {
    const { stored, live } = recordRaid();
    const out = buildReplay(stored, A);
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    expect(out.replay.mode).toBe('replayed');
    expect(out.replay.view).not.toBeNull();
    expect(out.replay.view!.marks).toEqual(raidView(live, 0).marks);
    expect(out.replay.view!.stars).toBe(stored.stars);
    expect(out.replay.view!.destruction).toBe(stored.destruction);
    expect(out.replay.view!.shells).toBe(live.shells);
  });

  it('is deterministic across many different raids', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const { stored, live } = recordRaid(seed);
      const out = buildReplay(stored, A);
      expect(out.ok).toBe(true);
      if (!out.ok) continue;
      expect(out.replay.view!.marks, `seed ${seed}`).toEqual(raidView(live, 0).marks);
      expect(out.replay.view!.stars, `seed ${seed}`).toBe(stored.stars);
    }
  });

  it('falls back to "as recorded" on a version mismatch, without throwing', () => {
    const { stored } = recordRaid();
    const out = buildReplay({ ...stored, engineVersion: 'some-older-build' }, A);
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    expect(out.replay.mode).toBe('as-recorded');
    expect(out.replay.view).toBeNull(); // nothing was recomputed
    expect(out.replay.results).toHaveLength(stored.actions.length);
    // The headline numbers still come from the row, so the screen is not blank.
    expect(out.replay.stars).toBe(stored.stars);
    expect(out.replay.destruction).toBe(stored.destruction);
  });

  it('refuses a raid that is still running', () => {
    const { stored } = recordRaid();
    const out = buildReplay({ ...stored, endedAt: null }, A);
    expect(out.ok === false && out.error).toBe('still-running');
  });

  it('lets both sides watch, and nobody else', () => {
    const { stored } = recordRaid();
    expect(buildReplay(stored, A).ok).toBe(true);
    expect(buildReplay(stored, D).ok).toBe(true);

    const stranger = buildReplay(stored, 'someone-else');
    expect(stranger.ok === false && stranger.error).toBe('not-yours');
  });

  it('shows the layout to both sides — the raid is over (§8)', () => {
    const { stored } = recordRaid();
    for (const viewer of [A, D]) {
      const out = buildReplay(stored, viewer);
      expect(out.ok).toBe(true);
      if (!out.ok) continue;
      expect(out.replay.layout.ships).toHaveLength(8);
    }
  });

  it('warns the defender that their harbour has been seen', () => {
    const { stored } = recordRaid();
    const defender = buildReplay(stored, D);
    const attacker = buildReplay(stored, A);
    expect(defender.ok && replayCaptainLine(defender.replay)).toBe(
      'They have seen your harbour now. Move something.',
    );
    expect(attacker.ok && replayCaptainLine(attacker.replay)).toContain('shell by shell');
  });

  it('says so, in the Captain voice, when a replay is only as-recorded', () => {
    const { stored } = recordRaid();
    const out = buildReplay({ ...stored, engineVersion: 'v0' }, A);
    expect(out.ok && replayCaptainLine(out.replay)).toContain('as it was recorded');
  });

  it('an empty raid replays to an empty board rather than throwing', () => {
    const { stored } = recordRaid();
    const out = buildReplay({ ...stored, actions: [], results: [] }, A);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.replay.view!.marks).toEqual({});
    expect(out.replay.view!.shells).toBe(RAID_DEFAULTS.shells);
  });
});
