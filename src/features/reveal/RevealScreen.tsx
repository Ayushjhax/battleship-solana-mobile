/**
 * "Enemy waters revealed" — the LOSER's five seconds with the winner's base,
 * between the last shot and the existing defeat screen. Nothing on it is
 * touchable and nothing skips it; it leaves by itself, once.
 *
 *   left    the winner: their portrait in the rope frame, their flag, their
 *           name and rank as live text (never the pack's baked name art)
 *   centre  the title banner over the winner's final board, drawn by the
 *           battle's own GridBoard, read-only: every ship where it lay, whole,
 *           hit or sunk, their defences as they ended, every shot the loser
 *           fired at it — rows A-J down the left, columns 1-10 across the top,
 *           exactly as that board was aimed at during the match
 *   right   MATCH COMPLETE, a legend of only what is on the board, and the
 *           countdown (RevealCountdown)
 *
 * The session (winner + board) is read ONCE, so neither a store change nor the
 * countdown ever re-renders the board. The deadline is set once, in the store,
 * the first time the board is on screen, so a re-mount carries on rather than
 * starting again. A missing session (a stale route) goes straight on.
 */
import { rankFor } from '@engine/ranks';
import type { Board } from '@engine/types';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { GridBoard } from '@/board/GridBoard';
import { LABEL_MARGIN, shipRect } from '@/board/layout';
import { FlagBadge, flagBadgeHeight } from '@/features/flags/FlagBadge';
import { BOARD_ART, FLEET_ART, REVEAL_ART } from '@/ui/assets';
import { portraitFor } from '@/ui/portraits';
import { Scale } from '@/ui/Scale';
import { CANVAS_H, CANVAS_W, artColor, font } from '@/ui/tokens';

import type { RevealWinner } from './plan';
import { RevealCountdown } from './RevealCountdown';
import {
  BANNER,
  BOARD_CX,
  BOARD_K,
  BOX,
  BOX_LEFT,
  BOX_TOP,
  COUNTDOWN_H,
  FLAG_W,
  FRAME,
  HOLE,
  LEFT_COL,
  LEFT_STACK,
  RIGHT_COL,
  RIGHT_STACK,
  SUNK_MARK,
} from './revealLayout';
import { useReveal, type RevealSession } from './revealStore';
import { hasDefences, sunkShipsOf } from './snapshot';

const ENTER_MS = 220;

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function WinnerCard({ winner }: { winner: RevealWinner }) {
  // The portrait art's picture is its middle 78% (its own frame and mat around it).
  const pic = HOLE.d / 0.78;
  return (
    <View style={styles.card}>
      <View style={{ width: FRAME.w, height: FRAME.h }}>
        <View
          style={[
            styles.hole,
            { left: HOLE.cx - HOLE.d / 2, top: HOLE.cy - HOLE.d / 2, width: HOLE.d, height: HOLE.d, borderRadius: HOLE.d / 2 },
          ]}
        >
          <Image
            source={portraitFor(winner.avatarId, winner.avatarColor)}
            style={{ position: 'absolute', left: (HOLE.d - pic) / 2, top: (HOLE.d - pic) / 2 + 2, width: pic, height: pic }}
            contentFit="cover"
            cachePolicy="memory-disk"
            accessibilityIgnoresInvertColors
          />
        </View>
        <Image source={REVEAL_ART.portraitFrame} style={StyleSheet.absoluteFill} contentFit="fill" />
        <FlagBadge
          code={winner.countryCode}
          w={FLAG_W}
          style={{
            position: 'absolute',
            left: FRAME.w - FLAG_W + 6,
            top: FRAME.h - flagBadgeHeight(FLAG_W) - 2,
            transform: [{ rotate: '-7deg' }],
          }}
        />
      </View>
      <Text style={styles.name} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
        {winner.name}
      </Text>
      <Text style={styles.rank} numberOfLines={1}>
        {rankFor(winner.points).name}
      </Text>
      <Image source={REVEAL_ART.anchorDivider} style={styles.divider} contentFit="contain" />
      <Image
        source={REVEAL_ART.quotePanel}
        style={styles.quote}
        contentFit="contain"
        accessibilityLabel="The fleet behind the fog."
      />
    </View>
  );
}

/** The winner's board, read-only. Memoised on the snapshot: it renders once. */
const WinnerBoard = memo(function WinnerBoard({ board }: { board: Board }) {
  const sunk = sunkShipsOf(board);
  return (
    <View style={styles.boardBox} pointerEvents="none">
      <GridBoard
        origin={{ x: LABEL_MARGIN, y: LABEL_MARGIN }}
        cells={board.marks}
        ships={board.ships}
        arsenal={board.arsenal}
        interactive={false}
        labels="left"
        columnLabels
        seedKey="reveal"
        watermark={BOARD_ART.watermarkKraken}
        animateMarks={false}
        skin="art"
      >
        {sunk.map((ship) => {
          const rect = shipRect(ship);
          return (
            <Image
              key={ship.id}
              source={REVEAL_ART.sunkCross}
              style={{
                position: 'absolute',
                left: rect.x + rect.w / 2 - SUNK_MARK / 2,
                top: rect.y + rect.h / 2 - SUNK_MARK / 2,
                width: SUNK_MARK,
                height: SUNK_MARK,
              }}
              contentFit="contain"
            />
          );
        })}
      </GridBoard>
    </View>
  );
});

function Legend({ board }: { board: Board }) {
  const sunk = sunkShipsOf(board).length > 0;
  const defences = hasDefences(board);
  if (!sunk && !defences) return null;
  return (
    <View style={styles.legend}>
      {sunk ? (
        <View style={styles.legendRow}>
          <Image source={REVEAL_ART.sunkCross} style={styles.legendIcon} contentFit="contain" />
          <Text style={styles.legendText}>Sunk</Text>
        </View>
      ) : null}
      {defences ? (
        <View style={styles.legendRow}>
          <Image source={FLEET_ART.aaGun} style={styles.legendIcon} contentFit="contain" />
          <Text style={styles.legendText}>Defences</Text>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

export function RevealScreen({
  revealKey,
  resultParams,
}: {
  revealKey: string;
  /** The defeat screen's params, exactly as the battle built them. */
  resultParams: Record<string, string>;
}) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [session] = useState<RevealSession | null>(() => {
    const s = useReveal.getState().session;
    return s && s.key === revealKey ? s : null;
  });
  const [deadline, setDeadline] = useState<number | null>(session?.deadline ?? null);

  const alive = useRef(true);
  const navigated = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const leave = useCallback(() => {
    if (!alive.current || navigated.current) return;
    navigated.current = true;
    // Releases the board and records the match as done.
    useReveal.getState().leave(revealKey);
    router.replace({ pathname: '/result', params: resultParams });
  }, [resultParams, revealKey, router]);

  // The board is on screen from this commit: the five seconds start now — or,
  // for a re-mount, carry on from when they first started.
  useEffect(() => {
    if (!session) {
      leave();
      return;
    }
    const at = useReveal.getState().start(revealKey, Date.now());
    if (at === null) leave();
    else setDeadline(at);
  }, [leave, revealKey, session]);

  // The entrance: the route's own cross-fade (the stack fades every screen in)
  // plus a short settle. The content is never drawn transparent — an entrance
  // that starts at opacity 0 is a blank page whenever its animation stalls.
  const enter = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) return;
    enter.value = withTiming(1, { duration: ENTER_MS, easing: Easing.out(Easing.cubic) });
  }, [enter, reduceMotion]);
  const enterStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - enter.value) * 6 }, { scale: 0.985 + 0.015 * enter.value }],
  }));

  return (
    <Scale backgroundImage={REVEAL_ART.paper}>
      {session ? (
        <Animated.View style={[styles.page, enterStyle]} pointerEvents="none">
          <View style={styles.banner} accessibilityRole="header" accessibilityLabel="Enemy waters revealed">
            <Image source={REVEAL_ART.titleBanner} style={StyleSheet.absoluteFill} contentFit="contain" />
          </View>
          <WinnerBoard board={session.board} />
          <View style={[styles.column, LEFT_COL]}>
            <WinnerCard winner={session.winner} />
          </View>
          <View style={[styles.column, RIGHT_COL]}>
            <Image source={REVEAL_ART.matchComplete} style={styles.stamp} contentFit="contain" accessibilityLabel="Match complete" />
            <Legend board={session.board} />
            <View style={styles.countdown}>
              {deadline !== null ? <RevealCountdown deadline={deadline} onDone={leave} /> : null}
            </View>
          </View>
        </Animated.View>
      ) : null}
    </Scale>
  );
}

const styles = StyleSheet.create({
  page: { position: 'absolute', left: 0, top: 0, width: CANVAS_W, height: CANVAS_H },
  banner: {
    position: 'absolute',
    left: BOARD_CX - BANNER.w / 2,
    top: BANNER.top,
    width: BANNER.w,
    height: BANNER.h,
  },
  boardBox: {
    position: 'absolute',
    left: BOX_LEFT,
    top: BOX_TOP,
    width: BOX,
    height: BOX,
    transform: [{ scale: BOARD_K }],
  },
  column: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },

  card: { alignItems: 'center', width: '100%' },
  hole: { position: 'absolute', overflow: 'hidden' },
  name: {
    marginTop: LEFT_STACK.name.gap,
    maxWidth: '100%',
    color: artColor.revealInk,
    fontFamily: font.display,
    fontSize: 20,
    lineHeight: LEFT_STACK.name.h,
    textAlign: 'center',
  },
  rank: {
    color: artColor.revealInk,
    fontFamily: font.body,
    fontSize: 14,
    lineHeight: LEFT_STACK.rank.h,
    textAlign: 'center',
  },
  divider: { marginTop: LEFT_STACK.divider.gap, width: LEFT_STACK.divider.w, height: LEFT_STACK.divider.h },
  quote: { marginTop: LEFT_STACK.quote.gap, width: LEFT_STACK.quote.w, height: LEFT_STACK.quote.h },

  stamp: { width: RIGHT_STACK.stamp.w, height: RIGHT_STACK.stamp.h },
  legend: { marginTop: RIGHT_STACK.legend.gap, gap: RIGHT_STACK.legend.rowGap, alignSelf: 'center' },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8, height: RIGHT_STACK.legend.row },
  legendIcon: { width: RIGHT_STACK.legend.iconW, height: RIGHT_STACK.legend.iconW },
  legendText: { color: artColor.revealInk, fontFamily: font.label, fontSize: 14 },
  /** Holds its place before the deadline is set, so nothing shifts when it is. */
  countdown: { marginTop: RIGHT_STACK.countdown.gap, minHeight: COUNTDOWN_H },
});
