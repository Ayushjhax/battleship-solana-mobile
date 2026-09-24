/**
 * Raid replays — part-06 §8.
 *
 * "The replay is produced by RE-RUNNING the engine over the actions, not by
 * storing rendered frames. If engineVersion no longer matches, fall back to
 * the stored per-action results (keep them: they are small) and mark the
 * replay 'as recorded'."
 *
 * So there are two modes, and which one you get is a fact about the data, not
 * a failure:
 *
 *   replayed     the stored engineVersion matches this build. The engine is
 *                re-run and the result is authoritative — same stars, same
 *                destruction, same marks, bit for bit.
 *   as-recorded  it does not. The stored per-action results are replayed
 *                verbatim. Nothing is recomputed and nothing throws.
 *
 * SECRECY. Unlike a live raid, a replay MAY show the layout: §8 says so
 * explicitly for both sides ("once the raid is over, the full layout, exactly
 * as Clash of Clans does"). The guard is that this module only ever loads a
 * raid whose `ended_at` is set — a running raid has no replay.
 */
import {
  raidView,
  replayRaid,
  type HarbourLayout,
  type KitCounts,
  type RaidAction,
  type RaidConfig,
  type RaidView,
} from '@engine/raid';

import { RAID_ENGINE_VERSION } from './config';

export type ReplayMode = 'replayed' | 'as-recorded';

export interface StoredReplay {
  readonly raidId: string;
  readonly attackerId: string;
  readonly defenderId: string | null;
  readonly coveSeed: number | null;
  readonly endedAt: string | null;
  readonly stars: number;
  readonly destruction: number;
  readonly endReason: string | null;
  readonly layout: HarbourLayout;
  readonly kit: KitCounts;
  readonly config: RaidConfig;
  /**
   * Straight out of a jsonb column, so untyped on purpose: a row written by
   * an older build, or a corrupted one, must fall back rather than crash.
   * `parseActions` below is the only thing that may promote it.
   */
  readonly actions: readonly unknown[];
  readonly results: readonly unknown[];
  readonly engineVersion: string;
}

export interface Replay {
  readonly raidId: string;
  readonly mode: ReplayMode;
  /** Who is watching, and therefore what the Captain says about it. */
  readonly viewer: 'attacker' | 'defender';
  /**
   * In 'replayed' mode these are validated `RaidAction`s. In 'as-recorded'
   * they are whatever was stored, which is the point of that mode — the
   * viewer shows the scrub bar and the stored results without re-running.
   */
  readonly actions: readonly unknown[];
  /** Present only in 'as-recorded' mode — the per-action outcomes as stored. */
  readonly results?: readonly unknown[];
  readonly stars: number;
  readonly destruction: number;
  readonly endReason: string | null;
  /** The board as it ended. Safe: the raid is over. */
  readonly view: RaidView | null;
  /** §8 — the full layout, for both sides, once it is over. */
  readonly layout: HarbourLayout;
}

export type ReplayError = 'not-found' | 'still-running' | 'not-yours';

const ACTION_KINDS = new Set(['fire', 'use', 'retreat']);

/**
 * Promotes stored JSON to `RaidAction[]`, or returns null if ANY entry is not
 * one. Null means "do not re-run the engine over this" — §8's fallback — and
 * is the difference between a replay that degrades and one that throws inside
 * `replayRaid` with the viewer already on screen.
 */
function parseActions(raw: readonly unknown[]): RaidAction[] | null {
  const out: RaidAction[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) return null;
    const kind = (entry as { kind?: unknown }).kind;
    if (typeof kind !== 'string' || !ACTION_KINDS.has(kind)) return null;
    out.push(entry as RaidAction);
  }
  return out;
}

export function buildReplay(
  stored: StoredReplay,
  viewerId: string,
): { ok: true; replay: Replay } | { ok: false; error: ReplayError } {
  if (!stored.endedAt) return { ok: false, error: 'still-running' };

  const viewer =
    viewerId === stored.attackerId
      ? ('attacker' as const)
      : viewerId === stored.defenderId
        ? ('defender' as const)
        : null;
  if (!viewer) return { ok: false, error: 'not-yours' };

  // The engine has moved on, or the stored actions are not actions any more:
  // do not recompute, do not throw, say so.
  const actions = parseActions(stored.actions);
  if (stored.engineVersion !== RAID_ENGINE_VERSION || actions === null) {
    return {
      ok: true,
      replay: {
        raidId: stored.raidId,
        mode: 'as-recorded',
        viewer,
        actions: stored.actions,
        results: stored.results,
        stars: stored.stars,
        destruction: stored.destruction,
        endReason: stored.endReason,
        view: null,
        layout: stored.layout,
      },
    };
  }

  const state = replayRaid(stored.layout, stored.kit, actions, stored.config, 0);
  return {
    ok: true,
    replay: {
      raidId: stored.raidId,
      mode: 'replayed',
      viewer,
      actions,
      stars: stored.stars,
      destruction: stored.destruction,
      endReason: stored.endReason,
      view: raidView(state, 0),
      layout: stored.layout,
    },
  };
}

/**
 * §8 — "The Captain warns the defender: 'They have seen your harbour now.
 * Move something.'" The copy lives with the rule that makes it true.
 */
export function replayCaptainLine(replay: Replay): string {
  if (replay.viewer === 'defender') {
    return 'They have seen your harbour now. Move something.';
  }
  return replay.mode === 'as-recorded'
    ? 'The log is older than the charts, Captain. This is as it was recorded.'
    : 'Here is how it went, shell by shell.';
}
