/**
 * The battle. HUD strip on top (IMG_9770), DualBoards under it, the FX layer
 * and the EventPlayer driving everything the player sees.
 *
 * The screen does not care which mode it is in: 'ai', 'hotseat' and (P13)
 * 'online' all feed the same EventPlayer through src/state/battle.ts.
 */
import { coordKey } from '@engine/board';
import type { Coord, Ship } from '@engine/types';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { playSfx } from '@/audio/sfx';
import { DualBoards } from '@/board/DualBoards';
import { BATTLE_BOARD_TOP, BOARD_SIZE, boardOrigins, cellCentre } from '@/board/layout';
import {
  ArsenalTab,
  AvatarCard,
  Curtain,
  EmoteFloat,
  EmotePanel,
  FlagChip,
  PlayerBlock,
  PointsBlock,
  ShieldChip,
} from '@/features/battle/Hud';
import { ArsenalPopover } from '@/features/battle/ArsenalPopover';
import { buildBattleSetup } from '@/features/battle/setup';
import { createBattleEffects } from '@/fx/battleEffects';
import { FxLayer } from '@/fx/FxLayer';
import { useFx } from '@/fx/fxStore';
import { sendEmote } from '@/net/chat';
import {
  battlePlayer,
  commitEvent,
  commitReveal,
  markFinished,
  selectOpponent,
  useBattle,
  type BattleSetup,
} from '@/state/battle';
import { usePlacement } from '@/state/placement';
import { useProfile } from '@/state/profile';
import { InkIconButton } from '@/ui/InkIconButton';
import { Paper } from '@/ui/Paper';
import { Scale } from '@/ui/Scale';
import { CANVAS_H, CANVAS_W } from '@/ui/tokens';

const ORIGINS = boardOrigins(BATTLE_BOARD_TOP);
const HUD_Y = 44;

/** Sunk enemy ships come back as cells; rebuild a Ship for the wreck sprite. */
function wrecksOf(
  sunk: readonly { id: string; class: Ship['class']; cells: readonly Coord[] }[],
): Ship[] {
  return sunk.map((s) => {
    const first = s.cells[0] as Coord;
    const second = s.cells[1];
    return {
      id: s.id,
      class: s.class,
      len: s.cells.length,
      origin: first,
      orientation: second && second.r === first.r ? 'h' : 'v',
      hits: [...s.cells],
    };
  });
}

export interface BattleScreenProps {
  /** A prepared match (the tutorial's rigged one). Omitted: built from the placement store. */
  setup?: BattleSetup;
  /** The tutorial never routes to the result screen. */
  tutorial?: boolean;
}

export function BattleScreen({ setup: presetSetup, tutorial = false }: BattleScreenProps) {
  const router = useRouter();
  const shown = useBattle((s) => s.shown);
  const me = useBattle((s) => s.me);
  const animating = useBattle((s) => s.animating);
  const seconds = useBattle((s) => s.seconds);
  const snapTurn = useBattle((s) => s.snapTurn);
  const aiming = useBattle((s) => s.aiming);
  const curtain = useBattle((s) => s.curtain);
  const finished = useBattle((s) => s.finished);
  const emote = useBattle((s) => s.emote);
  const combatants = useBattle((s) => s.combatants);
  const arsenalOpen = useBattle((s) => s.arsenalOpen);
  const targeting = useBattle((s) => s.targeting);
  const opponent = useBattle(selectOpponent);
  const [emotesOpen, setEmotesOpen] = useState(false);
  const started = useRef(false);

  // ---- start the match once, from what placement left behind ----
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const placement = usePlacement.getState();
    const profile = useProfile.getState();
    const setup = presetSetup ?? buildBattleSetup(placement, profile, Date.now() % 1_000_000);
    useBattle.getState().start(setup);
    return () => {
      useBattle.getState().reset();
      useFx.getState().clear();
    };
  }, []);

  // ---- wire the animated effects into the player for the life of the screen ----
  useEffect(() => {
    battlePlayer.setEffects(
      createBattleEffects({
        me: () => useBattle.getState().me,
        boardTop: BATTLE_BOARD_TOP,
        commit: commitEvent,
        commitReveal,
        onMatchOver: markFinished,
      }),
    );
    return () => battlePlayer.setEffects({ animate: async () => {}, commit: commitEvent });
  }, []);

  // ---- the turn clock ----
  useEffect(() => {
    const id = setInterval(() => useBattle.getState().tick(), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (seconds > 0 && seconds < 5 && shown?.turn === me && !animating) playSfx('turnTick');
  }, [seconds, shown?.turn, me, animating]);

  // ---- crosshair mirrors the store's aim ----
  useEffect(() => {
    useFx
      .getState()
      .setCrosshair(aiming ? { at: aiming, centre: cellCentre(aiming, ORIGINS.enemy) } : null);
  }, [aiming]);

  // ---- camera shake: boards only, never the HUD ----
  const shakeNonce = useFx((s) => s.shakeNonce);
  const shakeX = useSharedValue(0);
  const shakeY = useSharedValue(0);
  useEffect(() => {
    if (shakeNonce === 0) return;
    shakeX.value = withSequence(
      withTiming(6, { duration: 40, easing: Easing.linear }),
      withTiming(-6, { duration: 60 }),
      withTiming(4, { duration: 50 }),
      withTiming(-2, { duration: 50 }),
      withTiming(0, { duration: 60 }),
    );
    shakeY.value = withSequence(
      withTiming(-3, { duration: 50 }),
      withTiming(3, { duration: 60 }),
      withTiming(0, { duration: 80 }),
    );
  }, [shakeNonce, shakeX, shakeY]);
  const boardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }, { translateY: shakeY.value }],
  }));

  // ---- leave for the result once GAME_OVER has played out ----
  useEffect(() => {
    if (finished && !tutorial) router.replace('/result');
  }, [finished, tutorial, router]);

  const onEnemyPress = useCallback((at: Coord) => useBattle.getState().aim(at), []);
  const onSkip = useCallback(() => useBattle.getState().skip(), []);
  const onEmote = useCallback(
    (id: number) => {
      setEmotesOpen(false);
      useBattle.getState().showEmote(id);
      const match = useBattle.getState().match;
      if (match) void sendEmote({ matchId: match.id, from: me, emoteId: id });
    },
    [me],
  );

  const wrecks = useMemo(() => (shown ? wrecksOf(shown.enemy.sunkShips) : []), [shown]);
  const revealed = useMemo(
    () =>
      shown
        ? shown.enemy.revealedItems.map((i, n) => ({
            id: `rev-${n}-${coordKey(i.at)}`,
            kind: i.kind,
            at: i.at,
            destroyed: i.destroyed,
            revealed: true,
          }))
        : [],
    [shown],
  );

  if (!shown) {
    return (
      <Scale>
        <Paper variant="full" />
      </Scale>
    );
  }

  const mine = combatants[me];
  const myTurn = shown.phase === 'playing' && shown.turn === me;
  const turn = shown.phase === 'over' ? 'idle' : myTurn ? 'yours' : 'theirs';
  const arsenalLeft = shown.you.board.arsenal.filter(
    (i) => !i.used && !i.destroyed && i.at === undefined,
  ).length;

  return (
    <Scale>
      <Paper variant="full" />

      {/* ---- boards, triangle, fx — the only things that shake ---- */}
      <DualBoards
        top={BATTLE_BOARD_TOP}
        columnLabels={false}
        own={{
          cells: shown.you.board.marks,
          ships: shown.you.board.ships,
          arsenal: shown.you.board.arsenal,
        }}
        enemy={{
          cells: shown.enemy.marks,
          wrecks,
          revealed,
          highlight: aiming ? [aiming] : undefined,
          highlightTone: 'red',
        }}
        turn={turn}
        seconds={shown.phase === 'playing' ? seconds : undefined}
        snapTurn={snapTurn}
        interactive={myTurn && !animating && !aiming}
        onEnemyCellPress={onEnemyPress}
        boardStyle={boardStyle}
      >
        <FxLayer />
        <View style={styles.gutterTop}>
          <InkIconButton
            icon="chat"
            size={36}
            accessibilityLabel="Emotes"
            onPress={() => setEmotesOpen((v) => !v)}
          />
        </View>
        <View style={styles.gutterBottom}>
          <InkIconButton
            icon="home"
            size={36}
            accessibilityLabel="Leave the match"
            onPress={() => router.replace('/menu')}
          />
        </View>
        {animating ? (
          <Pressable style={styles.skip} onPress={onSkip} accessibilityLabel="Skip animation" />
        ) : null}
      </DualBoards>

      {/* ---- HUD strip ---- */}
      <View style={styles.hud} pointerEvents="box-none">
        <View style={{ position: 'absolute', left: 106, top: 10 }}>
          <AvatarCard
            avatarId={mine?.avatarId ?? 1}
            tint={mine?.avatarColor ?? '#3E2FB8'}
            seedKey="me"
          />
        </View>
        <View style={{ position: 'absolute', left: 170, top: 0 }}>
          <ArsenalTab
            count={arsenalLeft}
            onPress={() => useBattle.getState().setArsenalOpen(!arsenalOpen)}
          />
        </View>
        <View
          style={{ position: 'absolute', left: 170, top: HUD_Y + 4, flexDirection: 'row', gap: 6 }}
        >
          <FlagChip code={mine?.countryCode ?? 'IN'} seedKey="me" />
          <ShieldChip seedKey="me" />
        </View>
        <View style={{ position: 'absolute', left: 236, top: HUD_Y }}>
          <PlayerBlock name={mine?.name ?? 'Player'} points={mine?.points ?? 0} align="left" />
        </View>
        <View style={{ position: 'absolute', left: 352, top: HUD_Y }}>
          <PointsBlock points={mine?.points ?? 0} align="left" />
        </View>

        <View style={{ position: 'absolute', right: CANVAS_W - 470, top: HUD_Y }}>
          <PointsBlock points={opponent?.points ?? 0} align="right" />
        </View>
        <View style={{ position: 'absolute', right: CANVAS_W - 586, top: HUD_Y }}>
          <PlayerBlock name={opponent?.name ?? '—'} points={opponent?.points ?? 0} align="right" />
        </View>
        <View
          style={{ position: 'absolute', left: 590, top: HUD_Y + 4, flexDirection: 'row', gap: 6 }}
        >
          <ShieldChip seedKey="them" />
          <FlagChip code={opponent?.countryCode ?? '??'} seedKey="them" />
        </View>
        <View style={{ position: 'absolute', left: 640, top: 10 }}>
          <AvatarCard
            avatarId={opponent?.avatarId ?? 2}
            tint={opponent?.avatarColor ?? '#3A3A3A'}
            seedKey="them"
          />
          {emote ? (
            <View style={{ position: 'absolute', left: 9, top: -4 }}>
              <EmoteFloat id={emote.id} nonce={emote.nonce} />
            </View>
          ) : null}
        </View>
      </View>

      {arsenalOpen ? (
        <ArsenalPopover onClose={() => useBattle.getState().setArsenalOpen(false)} />
      ) : null}
      {emotesOpen ? <EmotePanel onPick={onEmote} onClose={() => setEmotesOpen(false)} /> : null}
      {curtain ? (
        <Curtain
          name={combatants[shown.turn]?.name ?? 'the other player'}
          onReady={() => useBattle.getState().dismissCurtain()}
        />
      ) : null}
    </Scale>
  );
}

const styles = StyleSheet.create({
  hud: { position: 'absolute', left: 0, top: 0, width: CANVAS_W, height: BATTLE_BOARD_TOP },
  gutterTop: { position: 'absolute', left: ORIGINS.gutterCentre.x - 18, top: BATTLE_BOARD_TOP + 4 },
  gutterBottom: {
    position: 'absolute',
    left: ORIGINS.gutterCentre.x - 18,
    top: BATTLE_BOARD_TOP + BOARD_SIZE - 40,
  },
  skip: {
    position: 'absolute',
    left: 0,
    top: BATTLE_BOARD_TOP,
    width: CANVAS_W,
    height: CANVAS_H - BATTLE_BOARD_TOP,
  },
});

/** The route: a normal match built from what placement left behind. */
export default function BattleRoute() {
  return <BattleScreen />;
}
