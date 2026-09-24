/**
 * The 5x5 pirate skirmish — part-09 §3.
 *
 * "The skirmish runs on the client for speed, and the client submits the event
 *  log; the server replays it with the same seeded AI and layout and refuses
 *  anything that does not reproduce."
 *
 * So this screen really does play the game locally — that is the point, and it
 * is safe because the server verifies. What it plays against is NOT its own
 * board: the seed comes from the voyage, and the same `startSkirmish(seed)`
 * the server will replay with builds the same two fleets here.
 *
 * REUSE, NOT A FORK. `GridBoard` with `grid={5}` — the prop added for this,
 * which leaves the 10x10 path byte-identical. `CellMark` draws the marks, so a
 * hit on a pirate cutter looks exactly like a hit in a match.
 *
 * A SKIRMISH NEVER ENDS WITHOUT A RESULT THE PLAYER CAN SEE. Part 7's rule,
 * and it applies here too: if the submission fails, the screen says so and
 * offers to try again rather than dropping the player back at the docks with
 * nothing.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { createRng } from '@engine/rng';
import type { Coord, Marks } from '@engine/types';
import {
  TURN_MS,
  cellsOf,
  key,
  pirateMove,
  shoot,
  startSkirmish,
  type Cell,
  type SkirmishState,
} from '@engine/voyages';

import { GridBoard } from '@/board/GridBoard';
import { submitSkirmish, type Collected } from '@/daily/api';
import { InkButton } from '@/ui/InkButton';
import { InkSpinner } from '@/ui/InkSpinner';
import { Paper } from '@/ui/Paper';
import { Scale } from '@/ui/Scale';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';

/** The pirate's reply delay — the same 900-1400 ms window the match AI uses. */
const PIRATE_DELAY_MS = 900;

/** The engine's marks, in the shape `GridBoard` draws. */
function asMarks(marks: Readonly<Record<string, string>>): Marks {
  return marks as Marks;
}

const RESULT_COPY: Record<string, string> = {
  won: 'The pirates broke off. Full cargo, and a bonus.',
  lost: 'They took half the hold.',
  unverified: 'The log did not check out ashore. Half the hold.',
  ignored: 'Nobody sailed out to meet them. Half the hold.',
  none: 'Home safe.',
};

export default function SkirmishScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; seed?: string }>();
  const voyageId = typeof params.id === 'string' ? params.id : '';

  // The seed the SERVER stored. It arrives with the voyage; this screen does
  // not invent one, because a board the server cannot reproduce is a board
  // whose log will always be rejected.
  const seed = Number(params.seed ?? 0) || 1;

  const [state, setState] = useState<SkirmishState | null>(() => startSkirmish(seed));
  const [shots, setShots] = useState<Cell[]>([]);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<Collected | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pirateRng = useRef(createRng(seed ^ 0x5bf0_3a9d));

  // The pirate answers whenever the turn passes to it.
  useEffect(() => {
    if (!state || state.over || state.turn !== 'pirate') return;

    const timer = setTimeout(() => {
      setState((current) => {
        if (!current || current.over || current.turn !== 'pirate') return current;
        const move = pirateMove(current.pirateMarks, pirateRng.current);
        if (!move) return current;
        return shoot(current, { side: 'pirate', at: move }).state;
      });
    }, PIRATE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [state]);

  const submit = useCallback(async () => {
    if (!state?.over || sending || !voyageId) return;
    setSending(true);
    try {
      setResult(
        await submitSkirmish(voyageId, {
          seed,
          shots,
          claimedWinner: state.winner ?? 'pirate',
        }),
      );
      setError(null);
    } catch {
      // §3's rule, restated: the player must see an outcome. The log is still
      // in state, so "Try again" resubmits the same one rather than replaying.
      setError('The report did not reach the harbour master.');
    } finally {
      setSending(false);
    }
  }, [seed, sending, shots, state, voyageId]);

  // Submit as soon as the fight is over, without a tap.
  useEffect(() => {
    if (state?.over && !result && !error && !sending) void submit();
  }, [error, result, sending, state?.over, submit]);

  const onCell = useCallback(
    (at: Coord) => {
      setState((current) => {
        if (!current || current.over || current.turn !== 'player') return current;
        const outcome = shoot(current, { side: 'player', at });
        if (outcome.rejected) return current;
        setShots((previous) => [...previous, { r: at.r, c: at.c }]);
        return outcome.state;
      });
    },
    [],
  );

  if (!state) {
    return (
      <Scale>
        <Paper>
          <View style={styles.centre}>
            <Text style={styles.error}>That skirmish could not be set up.</Text>
            <InkButton label="Back to the docks" onPress={() => router.back()} seedKey="sk-back" />
          </View>
        </Paper>
      </Scale>
    );
  }

  const myFleetLeft = state.playerShips.filter(
    (ship) => !cellsOf(ship).every((cell) => state.pirateMarks[key(cell)] !== undefined),
  ).length;

  return (
    <Scale>
      <Paper>
        <Text style={styles.title}>Pirates</Text>

        {/* Their board — you shoot at this one. */}
        <GridBoard
          x={190}
          y={96}
          grid={5}
          cells={asMarks(state.playerMarks)}
          interactive={!state.over && state.turn === 'player'}
          onCellPress={onCell}
          columnLabels
          labels="left"
          seedKey="skirmish-them"
        />

        {/* Yours — they shoot at this one, so your ships show. */}
        <GridBoard
          x={430}
          y={96}
          grid={5}
          cells={asMarks(state.pirateMarks)}
          interactive={false}
          columnLabels={false}
          labels="right"
          seedKey="skirmish-me"
        />

        <View style={styles.hud}>
          {!state.over ? (
            <Text style={styles.turn}>
              {state.turn === 'player' ? 'Your shot' : 'They are aiming…'}
            </Text>
          ) : (
            <Text style={styles.turn}>
              {state.winner === 'player' ? 'They broke off.' : 'Boarded.'}
            </Text>
          )}
          <Text style={styles.meta}>{`${myFleetLeft} of yours afloat`}</Text>
          <Text style={styles.meta}>{`${Math.round(TURN_MS / 1000)} s a turn`}</Text>
        </View>

        {state.over ? (
          <View style={styles.outcome}>
            {sending ? <InkSpinner /> : null}

            {result ? (
              <>
                <Text style={styles.outcomeText}>
                  {RESULT_COPY[result.result] ?? RESULT_COPY.none}
                </Text>
                <Text style={styles.cargo}>
                  {[
                    result.coins > 0 ? `${result.coins} coins` : null,
                    result.steel > 0 ? `${result.steel} steel` : null,
                    result.gems > 0 ? `${result.gems} gems` : null,
                  ]
                    .filter(Boolean)
                    .join('  ')}
                </Text>
                <InkButton
                  label="Back to the docks"
                  tone="confirm"
                  onPress={() => router.back()}
                  w={180}
                  h={32}
                  seedKey="sk-done"
                />
              </>
            ) : null}

            {error ? (
              <>
                <Text style={styles.error}>{error}</Text>
                <InkButton
                  label="Try again"
                  onPress={() => {
                    setError(null);
                    void submit();
                  }}
                  w={140}
                  h={30}
                  seedKey="sk-retry"
                />
              </>
            ) : null}
          </View>
        ) : null}

        <Pressable style={styles.back} onPress={() => router.back()}>
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      </Paper>
    </Scale>
  );
}

const styles = StyleSheet.create({
  centre: {
    width: CANVAS_W,
    height: CANVAS_H,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  title: {
    fontFamily: font.display,
    fontSize: typeScale.xl,
    color: color.inkRed,
    textAlign: 'center',
    marginTop: space.sm,
  },
  hud: {
    position: 'absolute',
    left: space.md,
    top: 120,
    width: 150,
    gap: 2,
  },
  turn: {
    fontFamily: font.label,
    fontSize: typeScale.md,
    color: color.ink,
  },
  meta: {
    fontFamily: font.body,
    fontSize: typeScale.xs,
    color: color.inkSoft,
  },
  outcome: {
    position: 'absolute',
    right: space.md,
    top: 110,
    width: 180,
    alignItems: 'flex-start',
    gap: space.xs,
  },
  outcomeText: {
    fontFamily: font.body,
    fontSize: typeScale.sm,
    color: color.ink,
  },
  cargo: {
    fontFamily: font.label,
    fontSize: typeScale.md,
    color: color.inkGreen,
  },
  error: {
    fontFamily: font.body,
    fontSize: typeScale.sm,
    color: color.inkRed,
  },
  back: {
    position: 'absolute',
    left: space.md,
    top: space.sm,
  },
  backText: {
    fontFamily: font.label,
    fontSize: typeScale.sm,
    color: color.inkSoft,
  },
});
