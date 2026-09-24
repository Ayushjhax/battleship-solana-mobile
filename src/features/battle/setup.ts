/**
 * Builds a BattleSetup from what the placement screen left behind and the
 * player's profile. Pure: the screen calls it once on mount.
 */
import { validateSubmission } from '@engine/match';
import { validateArsenalPlacement } from '@engine/placement';
import { autoPlaceFleet } from '@engine/placement';
import { createRng, type Rng } from '@engine/rng';
import { terrainForSea, WATER, type SeaId, type Terrain } from '@engine/terrain';
import type { ArsenalItem, Board, CaptainId, Coord, MatchMode, Ship } from '@engine/types';
import type { Difficulty } from '@engine/ai';

import { useMatchClient } from '@/net/match-client';
import type { BattleMode, BattleSetup, Combatant } from '@/state/battle';
import type { PlacementMode } from '@/state/placement';

export interface PlacementSnapshot {
  /**
   * The placement store's full mode, not `BattleMode`. Part 7 added
   * `'harbour'` (the defence editor), which is a layout that must never
   * become a battle — see the guard in buildBattleSetup.
   */
  readonly mode: PlacementMode;
  readonly difficulty: Difficulty;
  readonly ruleset: MatchMode;
  readonly ships: readonly Ship[];
  readonly arsenal: readonly ArsenalItem[];
  /** Part 10A. */
  readonly captainId: CaptainId | null;
  /** Part 10B — the sea this layout was arranged for. */
  readonly seaId: SeaId;
  readonly playerOneShips: readonly Ship[] | null;
  readonly playerTwoShips: readonly Ship[] | null;
  readonly playerOneArsenal: readonly ArsenalItem[] | null;
  readonly playerTwoArsenal: readonly ArsenalItem[] | null;
  readonly playerOneCaptain: CaptainId | null;
  readonly playerTwoCaptain: CaptainId | null;
  readonly playerOneName: string;
  readonly playerTwoName: string;
}

export interface ProfileSnapshot {
  readonly name: string;
  readonly rankPoints: number;
  readonly avatarId: number;
  readonly avatarColor: string;
  readonly countryCode: string;
}

/** A modest kit for the AI in advanced mode: defences on free cells, two strikes. */
export function aiKit(rng: Rng, ships: readonly Ship[]): ArsenalItem[] {
  const items: ArsenalItem[] = [
    { id: 'ai-atomic', kind: 'atomicBomber' },
    { id: 'ai-torpedo', kind: 'torpedoBomber' },
  ];
  const board: Board = { ships, arsenal: [], marks: {} };
  const wanted: ArsenalItem['kind'][] = ['mine', 'mine', 'aaGun'];
  wanted.forEach((kind, n) => {
    for (let attempt = 0; attempt < 60; attempt++) {
      const at: Coord = { r: rng.int(10), c: rng.int(10) };
      const item: ArsenalItem = { id: `ai-${kind}-${n}`, kind, at };
      if (validateArsenalPlacement({ ...board, arsenal: items }, item).ok) {
        items.push(item);
        break;
      }
    }
  });
  return items;
}

export interface Layout {
  readonly ships: readonly Ship[];
  readonly arsenal: readonly ArsenalItem[];
  /** Part 10A — the captain that survived validation, or null. */
  readonly captainId: CaptainId | null;
}

/**
 * The layout a combatant actually takes into the match.
 *
 * It is checked with the SAME function the reducer will use, because that is
 * the only test that matters: anything this returns must survive
 * SUBMIT_LAYOUT. Ships and arsenal travel together and are replaced together
 * — an arsenal validated against one fleet means nothing against another, and
 * mixing a fresh fleet with the old defences is what produced boards with a
 * random layout and no arsenal on them at all.
 *
 * A fallback here means the placement screen let something illegal through,
 * so it is loud. It is never silent, and it is never partial.
 */
export function usableLayout(
  ruleset: MatchMode,
  ships: readonly Ship[],
  arsenal: readonly ArsenalItem[],
  rng: Rng,
  who: string,
  captainId: CaptainId | null = null,
  terrain: Terrain = WATER,
): Layout {
  // Classic carries no arsenal and no captain; the reducer rejects a
  // submission that brings either, so drop them before asking.
  const wanted = ruleset === 'advanced' ? arsenal : [];
  const captain = ruleset === 'advanced' ? captainId : null;
  const check = validateSubmission(ruleset, ships, wanted, undefined, captain, terrain);
  if (check.ok) return { ships, arsenal: wanted, captainId: captain };
  console.error(
    `[battle] ${who}'s layout cannot be used (${check.reason}); auto-placing a fleet instead. ` +
      'This is a bug: placement should not have allowed it.',
  );
  return { ships: autoPlaceFleet(rng, terrain), arsenal: [], captainId: null };
}

export function buildBattleSetup(
  placement: PlacementSnapshot,
  profile: ProfileSnapshot,
  seed: number,
): BattleSetup {
  const rng = createRng(seed);
  // 'online' has no local opponent and 'harbour' (Part 7's defence editor) is
  // not a match at all. Both fall back to the AI rather than crashing, and
  // both say so: reaching here with either is a routing bug upstream.
  const playable: BattleMode =
    placement.mode === 'online' || placement.mode === 'harbour' ? 'ai' : placement.mode;
  const mode: BattleMode = playable;
  if (placement.mode === 'online')
    console.warn(
      '[battle] online setup requested without a match — see buildOnlineSetup; playing the AI',
    );
  if (placement.mode === 'harbour')
    console.warn(
      '[battle] a harbour layout cannot start a battle — it defends one; playing the AI',
    );

  const myShips = (placement.mode === 'hotseat' ? placement.playerOneShips : placement.ships) ?? [];
  const myArsenal =
    (placement.mode === 'hotseat' ? placement.playerOneArsenal : placement.arsenal) ?? [];
  const myCaptain =
    (placement.mode === 'hotseat' ? placement.playerOneCaptain : placement.captainId) ?? null;
  const advanced = placement.ruleset === 'advanced';
  const terrain = terrainForSea(placement.seaId);
  const mine = usableLayout(
    placement.ruleset,
    myShips,
    myArsenal,
    rng,
    'player one',
    myCaptain,
    terrain,
  );

  const one: Combatant = {
    id: 'p1',
    name: placement.mode === 'hotseat' ? placement.playerOneName : profile.name || 'Player',
    points: profile.rankPoints,
    avatarId: profile.avatarId,
    avatarColor: profile.avatarColor,
    countryCode: profile.countryCode,
    ships: mine.ships,
    arsenal: mine.arsenal,
    captainId: mine.captainId,
  };

  let two: Combatant;
  if (placement.mode === 'hotseat') {
    const theirs = usableLayout(
      placement.ruleset,
      placement.playerTwoShips ?? [],
      placement.playerTwoArsenal ?? [],
      rng,
      'player two',
      placement.playerTwoCaptain ?? null,
      terrain,
    );
    two = {
      id: 'p2',
      name: placement.playerTwoName,
      points: 0,
      avatarId: 2,
      avatarColor: '#8A5A2B',
      countryCode: profile.countryCode,
      ships: theirs.ships,
      arsenal: theirs.arsenal,
      captainId: theirs.captainId,
    };
  } else {
    const ships = autoPlaceFleet(rng, terrain);
    two = {
      id: 'ai',
      name: 'Berhan',
      points: 13365,
      avatarId: 4,
      avatarColor: '#3A3A3A',
      countryCode: 'RU',
      ships,
      arsenal: advanced ? aiKit(rng, ships) : [],
      // Part 10A — Hard brings Berhan. Easy and Normal bring none.
      captainId: advanced && placement.difficulty === 'hard' ? 'berhan' : null,
    };
  }

  return {
    mode,
    ruleset: placement.ruleset,
    seed,
    one,
    two,
    difficulty: placement.difficulty,
    // Part 10B — the sea the local match is played on.
    terrain,
  };
}

/**
 * Online: both combatants come from the server's `matched` message, never
 * from placement. The opponent's ships are — by design — unknown here; the
 * empty arrays are placeholders the offline `start()` path never reads
 * (see src/state/battle.ts). Null until `matched` has arrived.
 */
export function buildOnlineSetup(profile: ProfileSnapshot): BattleSetup | null {
  const mc = useMatchClient.getState();
  if (!mc.matchId || !mc.you || !mc.opponent || !mc.mode) return null;
  const one: Combatant = {
    id: mc.you.id,
    name: profile.name || mc.you.name,
    points: profile.rankPoints || mc.you.rankPoints,
    avatarId: profile.avatarId || mc.you.avatarId,
    avatarColor: profile.avatarColor || mc.you.avatarColor,
    countryCode: profile.countryCode || mc.you.countryCode || '??',
    ships: [],
    arsenal: [],
  };
  const two: Combatant = {
    id: mc.opponent.id,
    name: mc.opponent.name,
    points: mc.opponent.rankPoints,
    avatarId: mc.opponent.avatarId,
    avatarColor: mc.opponent.avatarColor,
    countryCode: mc.opponent.countryCode ?? '??',
    ships: [],
    arsenal: [],
  };
  return { mode: 'online', ruleset: mc.mode, seed: 0, one, two, matchId: mc.matchId };
}
