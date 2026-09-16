/**
 * Builds a BattleSetup from what the placement screen left behind and the
 * player's profile. Pure: the screen calls it once on mount.
 */
import { validateSubmission } from '@engine/match';
import { validateArsenalPlacement } from '@engine/placement';
import { autoPlaceFleet } from '@engine/placement';
import { createRng, type Rng } from '@engine/rng';
import type { ArsenalItem, Board, Coord, MatchMode, Ship } from '@engine/types';
import type { Difficulty } from '@engine/ai';

import { useMatchClient } from '@/net/match-client';
import type { BattleMode, BattleSetup, Combatant } from '@/state/battle';

export interface PlacementSnapshot {
  readonly mode: BattleMode;
  readonly difficulty: Difficulty;
  readonly ruleset: MatchMode;
  readonly ships: readonly Ship[];
  readonly arsenal: readonly ArsenalItem[];
  readonly playerOneShips: readonly Ship[] | null;
  readonly playerTwoShips: readonly Ship[] | null;
  readonly playerOneArsenal: readonly ArsenalItem[] | null;
  readonly playerTwoArsenal: readonly ArsenalItem[] | null;
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
): Layout {
  // Classic carries no arsenal at all; the reducer rejects a submission that
  // brings one, so drop it before asking.
  const wanted = ruleset === 'advanced' ? arsenal : [];
  const check = validateSubmission(ruleset, ships, wanted);
  if (check.ok) return { ships, arsenal: wanted };
  console.error(
    `[battle] ${who}'s layout cannot be used (${check.reason}); auto-placing a fleet instead. ` +
      'This is a bug: placement should not have allowed it.',
  );
  return { ships: autoPlaceFleet(rng), arsenal: [] };
}

export function buildBattleSetup(
  placement: PlacementSnapshot,
  profile: ProfileSnapshot,
  seed: number,
): BattleSetup {
  const rng = createRng(seed);
  const mode: BattleMode = placement.mode === 'online' ? 'ai' : placement.mode;
  if (placement.mode === 'online')
    console.warn(
      '[battle] online setup requested without a match — see buildOnlineSetup; playing the AI',
    );

  const myShips = (placement.mode === 'hotseat' ? placement.playerOneShips : placement.ships) ?? [];
  const myArsenal =
    (placement.mode === 'hotseat' ? placement.playerOneArsenal : placement.arsenal) ?? [];
  const advanced = placement.ruleset === 'advanced';
  const mine = usableLayout(placement.ruleset, myShips, myArsenal, rng, 'player one');

  const one: Combatant = {
    id: 'p1',
    name: placement.mode === 'hotseat' ? placement.playerOneName : profile.name || 'Player',
    points: profile.rankPoints,
    avatarId: profile.avatarId,
    avatarColor: profile.avatarColor,
    countryCode: profile.countryCode,
    ships: mine.ships,
    arsenal: mine.arsenal,
  };

  let two: Combatant;
  if (placement.mode === 'hotseat') {
    const theirs = usableLayout(
      placement.ruleset,
      placement.playerTwoShips ?? [],
      placement.playerTwoArsenal ?? [],
      rng,
      'player two',
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
    };
  } else {
    const ships = autoPlaceFleet(rng);
    two = {
      id: 'ai',
      name: 'Berhan',
      points: 13365,
      avatarId: 4,
      avatarColor: '#3A3A3A',
      countryCode: 'RU',
      ships,
      arsenal: advanced ? aiKit(rng, ships) : [],
    };
  }

  return { mode, ruleset: placement.ruleset, seed, one, two, difficulty: placement.difficulty };
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
