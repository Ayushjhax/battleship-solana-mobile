/**
 * The daily puzzle — part-09 §2.
 *
 * REUSE, NOT A FORK. The board is `GridBoard` at its normal 10x10 with
 * `cells` and `onCellPress` — the same component the battle and the harbour
 * use. There is no puzzle board component, because a puzzle board is a board.
 *
 * THE CLIENT RENDERS ONLY WHAT THE SERVER SENT. Every shot is a round trip;
 * nothing here resolves a cell, computes a grade or decides a reward. The
 * marks come back from `/puzzle/fire` and go straight into `cells`. There is
 * deliberately no optimistic mark: a puzzle shot has no animation to cover
 * the latency, and a mark that flips colour after the fact reads as a bug.
 */
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { emojiGrid, grade, shareText, type PuzzleGrade } from '@engine/puzzle';
import type { Coord, Marks } from '@engine/types';

import { GridBoard } from '@/board/GridBoard';
import {
  firePuzzle,
  getPuzzle,
  getPuzzleLeaderboard,
  type PuzzleLeaderboard,
  type PuzzleResponseDto,
} from '@/daily/api';
import { InkButton } from '@/ui/InkButton';
import { InkPanel } from '@/ui/InkPanel';
import { InkSpinner } from '@/ui/InkSpinner';
import { Paper } from '@/ui/Paper';
import { Scale } from '@/ui/Scale';
import { TitleRibbon } from '@/ui/TitleRibbon';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';

const GRADE_COPY: Record<PuzzleGrade, string> = {
  'admirals-round': "An Admiral's round.",
  'under-par': 'Under par.',
  par: 'Level par.',
  'over-par': 'Over par.',
};

export default function PuzzleScreen() {
  const router = useRouter();
  const [state, setState] = useState<PuzzleResponseDto | null>(null);
  const [board, setBoard] = useState<PuzzleLeaderboard | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await getPuzzle());
      setError(null);
    } catch {
      setError('The back page is not available just now.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const finished = state?.view.finished ?? false;

  useEffect(() => {
    if (!finished) return;
    void getPuzzleLeaderboard()
      .then(setBoard)
      .catch(() => setBoard(null));
  }, [finished]);

  const onCell = useCallback(
    async (at: Coord) => {
      // One shot in flight at a time. The server refuses a repeat cell anyway,
      // but a double-tap should not queue two round trips.
      if (busy || finished) return;
      setBusy(true);
      try {
        setState(await firePuzzle(at));
        setError(null);
      } catch {
        setError('That shot did not reach the Gazette. Try it again.');
      } finally {
        setBusy(false);
      }
    },
    [busy, finished],
  );

  const onShare = useCallback(async () => {
    if (!state) return;
    await Clipboard.setStringAsync(
      shareText(state.view.date, state.view.shots, state.view.marks as Marks, state.view.par),
    );
    setCopied(true);
  }, [state]);

  if (!state) {
    return (
      <Scale>
        <Paper>
          <View style={styles.centre}>
            {error ? <Text style={styles.error}>{error}</Text> : <InkSpinner />}
          </View>
        </Paper>
      </Scale>
    );
  }

  const { view } = state;
  const result = grade(view.shots, view.par);

  return (
    <Scale>
      <Paper>
        <View style={styles.ribbon}>
          <TitleRibbon title={`Puzzle #${view.number}`} w={220} h={36} size="md" seedKey="puzzle" />
        </View>

        <GridBoard
          x={40}
          y={62}
          cells={view.marks as Marks}
          interactive={!finished && !busy}
          onCellPress={onCell}
          columnLabels
          labels="left"
          seedKey="puzzle-board"
        />

        <View style={styles.side}>
          <InkPanel w={300} h={124} seedKey="puzzle-score">
            <View style={styles.scoreBody}>
              <Text style={styles.shots}>{view.shots}</Text>
              <Text style={styles.shotsLabel}>{view.shots === 1 ? 'shot' : 'shots'}</Text>
              <Text style={styles.par}>{`par ${view.par}`}</Text>
              <Text style={styles.remaining}>
                {`${view.shipsRemaining} ${view.shipsRemaining === 1 ? 'ship' : 'ships'} left`}
              </Text>
              {state.streak > 0 ? (
                <Text style={styles.streak}>{`${state.streak}-day streak`}</Text>
              ) : null}
            </View>
          </InkPanel>

          {finished ? (
            <View style={styles.done}>
              <Text style={styles.gradeText}>{GRADE_COPY[result]}</Text>

              {state.reward ? (
                <Text style={styles.reward}>
                  {`+${state.reward.coins}c  +${state.reward.steel}s  +${state.reward.ink} ink` +
                    (state.reward.gems > 0 ? `  +${state.reward.gems}g` : '')}
                </Text>
              ) : null}

              <ScrollView style={styles.gridScroll} contentContainerStyle={styles.gridBody}>
                <Text style={styles.grid}>{emojiGrid(view.marks as Marks)}</Text>
              </ScrollView>

              <InkButton
                label={copied ? 'Copied' : 'Copy result'}
                onPress={onShare}
                w={140}
                h={30}
                seedKey="puzzle-share"
              />
            </View>
          ) : null}

          {board?.me ? (
            <Text style={styles.place}>{`${ordinal(board.me.place)} today`}</Text>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>

        <Pressable style={styles.back} onPress={() => router.back()}>
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      </Paper>
    </Scale>
  );
}

function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

const styles = StyleSheet.create({
  ribbon: {
    position: 'absolute',
    left: CANVAS_W / 2 - 110,
    top: 6,
  },
  centre: {
    width: CANVAS_W,
    height: CANVAS_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  side: {
    position: 'absolute',
    left: 420,
    top: 62,
    width: 340,
    alignItems: 'flex-start',
  },
  scoreBody: {
    flex: 1,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  shots: {
    fontFamily: font.display,
    fontSize: typeScale.xxxl,
    color: color.ink,
    lineHeight: typeScale.xxxl,
  },
  shotsLabel: {
    fontFamily: font.label,
    fontSize: typeScale.sm,
    color: color.inkSoft,
  },
  par: {
    fontFamily: font.body,
    fontSize: typeScale.sm,
    color: color.inkFaint,
    marginTop: 2,
  },
  remaining: {
    fontFamily: font.body,
    fontSize: typeScale.sm,
    color: color.inkSoft,
    marginTop: space.xs,
  },
  streak: {
    fontFamily: font.label,
    fontSize: typeScale.xs,
    color: color.inkGreen,
    marginTop: 2,
  },
  done: {
    marginTop: space.sm,
    width: 300,
  },
  gradeText: {
    fontFamily: font.display,
    fontSize: typeScale.lg,
    color: color.ink,
  },
  reward: {
    fontFamily: font.label,
    fontSize: typeScale.sm,
    color: color.inkGreen,
    marginTop: 2,
  },
  gridScroll: {
    maxHeight: 96,
    marginVertical: space.xs,
  },
  gridBody: {
    paddingVertical: 2,
  },
  grid: {
    fontSize: 11,
    lineHeight: 13,
  },
  place: {
    fontFamily: font.label,
    fontSize: typeScale.sm,
    color: color.inkSoft,
    marginTop: space.xs,
  },
  error: {
    fontFamily: font.body,
    fontSize: typeScale.sm,
    color: color.inkRed,
    marginTop: space.xs,
    maxWidth: 300,
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
