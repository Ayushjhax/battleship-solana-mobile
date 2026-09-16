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
import { AppState, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
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
  EmblemChip,
  EmoteFloat,
  EmotePanel,
  FlagChip,
  PlayerBlock,
  PointsBlock,
  ShieldChip,
} from '@/features/battle/Hud';
import { ConnectionOverlay, useConnectionKind } from '@/features/battle/ConnectionOverlay';
import { buildBattleSetup, buildOnlineSetup } from '@/features/battle/setup';
import { ArsenalTargetingOverlay, BattleArsenalPopover } from '@/features/arsenal/BattleArsenal';
import { createBattleEffects } from '@/fx/battleEffects';
import { FxLayer } from '@/fx/FxLayer';
import { useFx } from '@/fx/fxStore';
import { sendEmote, subscribeEmotes } from '@/net/chat';
import { useMatchClient } from '@/net/match-client';
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
import { InkButton } from '@/ui/InkButton';
import { InkIconButton } from '@/ui/InkIconButton';
import { InkPanel } from '@/ui/InkPanel';
import { InkSpinner } from '@/ui/InkSpinner';
import { Paper } from '@/ui/Paper';
import { Scale } from '@/ui/Scale';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';

const ORIGINS = boardOrigins(BATTLE_BOARD_TOP);
// Rank line + 22-unit name line end at 74, clear of the board frame at BATTLE_BOARD_TOP (78).
const HUD_Y = 36;

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

function ResignDialog({
  tutorial,
  onCancel,
  onConfirm,
}: {
  tutorial: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <View style={styles.resignOverlay} accessibilityViewIsModal>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Paper variant="full" />
      </View>
      <InkPanel w={310} h={146} seedKey="resign-confirm" padding={space.md}>
        <View style={styles.resignContent}>
          <Text style={styles.resignTitle}>Resign the match?</Text>
          <Text style={styles.resignBody}>
            {tutorial
              ? 'Leave the lesson and return to port?'
              : 'This battle will count as a loss.'}
          </Text>
          <View style={styles.resignButtons}>
            <InkButton label="Keep playing" w={126} h={42} onPress={onCancel} />
            <InkButton label="Resign" tone="danger" w={100} h={42} onPress={onConfirm} />
          </View>
        </View>
      </InkPanel>
    </View>
  );
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
  const pending = useBattle((s) => s.pending);
  const pendingShotAt = useBattle((s) => s.pendingShotAt);
  const mode = useBattle((s) => s.mode);
  const opponent = useBattle(selectOpponent);
  const connection = useConnectionKind();
  const [emotesOpen, setEmotesOpen] = useState(false);
  const [resignOpen, setResignOpen] = useState(false);
  const started = useRef(false);
  const reduceMotion = useReducedMotion();

  // ---- start the match once, from what placement (or the server) left behind ----
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const placement = usePlacement.getState();
    const profile = useProfile.getState();
    const matchClient = useMatchClient.getState();
    const hasServerMatch =
      Boolean(matchClient.matchId) &&
      matchClient.status !== 'idle' &&
      matchClient.status !== 'failed' &&
      matchClient.status !== 'over';
    let setup = presetSetup;
    if (!setup && hasServerMatch) {
      const online = buildOnlineSetup(profile);
      if (!online) {
        // No `matched` behind us (a stale route): nothing to play. Back out.
        router.replace('/menu');
        return;
      }
      // This session now owns the match, so a reconnect from here is the match
      // client's own business and must never raise the rejoin prompt again.
      matchClient.enterMatch();
      setup = online;
    } else if (!setup && placement.mode === 'online') {
      // An online route without a live authoritative match is stale.
      router.replace('/menu');
      return;
    }
    useBattle
      .getState()
      .start(setup ?? buildBattleSetup(placement, profile, Date.now() % 1_000_000));
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

  // ---- opponent emotes (server matches only) ----
  const matchId = useBattle((s) => s.matchId);
  useEffect(() => {
    if (!matchId) return;
    return subscribeEmotes(matchId, (m) => {
      if (m.from !== useBattle.getState().me) useBattle.getState().showEmote(m.emoteId);
    });
  }, [matchId]);

  // ---- online: back from the background, probe the socket at once ----
  useEffect(() => {
    if (mode !== 'online') return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') useMatchClient.getState().nudge();
    });
    return () => sub.remove();
  }, [mode]);

  // Close transient layers first. A second back press asks before forfeiting;
  // Android never drops the player out of a live match silently.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      const state = useBattle.getState();
      if (state.targeting) state.selectArsenal(null);
      else if (state.arsenalOpen) state.setArsenalOpen(false);
      else if (emotesOpen) setEmotesOpen(false);
      else if (resignOpen) setResignOpen(false);
      else setResignOpen(true);
      return true;
    });
    return () => subscription.remove();
  }, [emotesOpen, resignOpen]);

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

  // ---- online: "…" on the target once the shell has landed with no verdict yet ----
  useEffect(() => {
    const show = pendingShotAt && !animating;
    useFx
      .getState()
      .setPendingShot(
        show ? { at: pendingShotAt, centre: cellCentre(pendingShotAt, ORIGINS.enemy) } : null,
      );
  }, [pendingShotAt, animating]);

  // ---- online: dim the boards to 60 % while someone is out of contact ----
  const dimmed = connection === 'reconnecting' || connection === 'opponentDropped';
  const dim = useSharedValue(1);
  useEffect(() => {
    dim.value = withTiming(dimmed ? 0.6 : 1, { duration: reduceMotion ? 0 : 220 });
  }, [dim, dimmed, reduceMotion]);

  // ---- camera shake: boards only, never the HUD ----
  const shakeNonce = useFx((s) => s.shakeNonce);
  const shakeX = useSharedValue(0);
  const shakeY = useSharedValue(0);
  useEffect(() => {
    if (shakeNonce === 0) return;
    shakeX.value = withSequence(
      withTiming(6, { duration: reduceMotion ? 0 : 40, easing: Easing.out(Easing.cubic) }),
      withTiming(-6, { duration: reduceMotion ? 0 : 60 }),
      withTiming(4, { duration: reduceMotion ? 0 : 50 }),
      withTiming(-2, { duration: reduceMotion ? 0 : 50 }),
      withTiming(0, { duration: reduceMotion ? 0 : 60 }),
    );
    shakeY.value = withSequence(
      withTiming(-3, { duration: reduceMotion ? 0 : 50 }),
      withTiming(3, { duration: reduceMotion ? 0 : 60 }),
      withTiming(0, { duration: reduceMotion ? 0 : 80 }),
    );
  }, [reduceMotion, shakeNonce, shakeX, shakeY]);
  const boardStyle = useAnimatedStyle(() => ({
    opacity: dim.value,
    transform: [{ translateX: shakeX.value }, { translateY: shakeY.value }],
  }));

  // ---- leave for the result once GAME_OVER has played out ----
  useEffect(() => {
    if (!finished || tutorial) return;
    const state = useBattle.getState();
    const won = state.shown?.winner === state.ownerId;
    // The store resets when this screen unmounts, so the result gets what it
    // needs as params: the verdict, how to "Play again", and the other card.
    const them = selectOpponent(state);
    const matchClient = useMatchClient.getState();
    const serverBacked = Boolean(matchClient.matchId);
    const serverBot = serverBacked && matchClient.opponent?.isBot === true;
    // An offline wager has no socket behind it — the battle store captured it
    // at start(), so a settlement still queued from an earlier match cannot
    // make this result read as wagered.
    const wagered = matchClient.wagered || state.wagered;
    router.replace({
      pathname: '/result',
      params: {
        won: won ? '1' : '0',
        local: serverBacked || state.mode === 'online' ? '0' : '1',
        mode: serverBot ? 'ai' : state.mode,
        ruleset: state.ruleset,
        matchId: state.matchId ?? '',
        wager: wagered ? '1' : '0',
        oppName: them?.name ?? '',
        oppPoints: String(them?.points ?? 0),
        oppAvatar: String(them?.avatarId ?? 2),
        oppTint: them?.avatarColor ?? '',
        oppFlag: them?.countryCode ?? '',
      },
    });
  }, [finished, tutorial, router]);

  const onEnemyPress = useCallback((at: Coord) => useBattle.getState().aim(at), []);
  const onSkip = useCallback(() => useBattle.getState().skip(), []);
  const onEmote = useCallback(
    (id: number) => {
      setEmotesOpen(false);
      useBattle.getState().showEmote(id);
      const id2 = useBattle.getState().matchId;
      if (id2) void sendEmote({ matchId: id2, from: me, emoteId: id });
    },
    [me],
  );
  const onLeave = useCallback(() => setResignOpen(true), []);
  const confirmResign = useCallback(() => {
    setResignOpen(false);
    if (tutorial) {
      router.replace('/menu');
      return;
    }
    const state = useBattle.getState();
    if (state.shown?.phase === 'playing') {
      state.act({ type: 'RESIGN', playerId: state.me });
    } else {
      router.replace('/menu');
    }
  }, [router, tutorial]);

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
        <View style={styles.loading}>
          <InkSpinner size={34} seedKey="battle-start" />
        </View>
        {mode === 'online' ? <ConnectionOverlay /> : null}
        {resignOpen ? (
          <ResignDialog
            tutorial={tutorial}
            onCancel={() => setResignOpen(false)}
            onConfirm={confirmResign}
          />
        ) : null}
      </Scale>
    );
  }

  const mine = combatants[me];
  const myTurn = shown.phase === 'playing' && shown.turn === me;
  const turn = shown.phase === 'over' ? 'idle' : myTurn ? 'yours' : 'theirs';
  const arsenalLeft = shown.you.board.arsenal.filter((i) => !i.used && !i.destroyed).length;

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
        interactive={
          myTurn &&
          !animating &&
          !pending &&
          !aiming &&
          !arsenalOpen &&
          !targeting &&
          !resignOpen &&
          connection === 'none'
        }
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
            onPress={onLeave}
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
        {shown.mode === 'advanced' ? (
          <View style={{ position: 'absolute', left: 176, top: 4 }}>
            <ArsenalTab
              count={arsenalLeft}
              onPress={() => {
                setEmotesOpen(false);
                useBattle.getState().setArsenalOpen(!arsenalOpen);
              }}
            />
          </View>
        ) : null}
        {/* IMG_9770: emblem + shield under the tab; rank/name from x=220; "Points:" at 340 and 424. */}
        <View
          style={{
            position: 'absolute',
            left: 160,
            top: HUD_Y + 6,
            flexDirection: 'row',
            gap: 6,
            alignItems: 'center',
          }}
        >
          <EmblemChip seedKey="me" />
          <ShieldChip seedKey="me" />
        </View>
        <View style={{ position: 'absolute', left: 220, top: HUD_Y }}>
          <PlayerBlock
            name={mine?.name ?? 'Player'}
            points={mine?.points ?? 0}
            align="left"
            maxWidth={116}
          />
        </View>
        <View style={{ position: 'absolute', left: 340, top: HUD_Y }}>
          <PointsBlock points={mine?.points ?? 0} align="left" />
        </View>

        <View style={{ position: 'absolute', left: 424, top: HUD_Y }}>
          <PointsBlock points={opponent?.points ?? 0} align="left" />
        </View>
        <View style={{ position: 'absolute', right: CANVAS_W - 586, top: HUD_Y }}>
          <PlayerBlock
            name={opponent?.name ?? '—'}
            points={opponent?.points ?? 0}
            align="right"
            maxWidth={100}
          />
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
        <BattleArsenalPopover
          arsenal={shown.you.board.arsenal}
          canUse={myTurn && !animating && !pending}
          onPick={(selected) => useBattle.getState().selectArsenal(selected.itemId)}
          onClose={() => useBattle.getState().setArsenalOpen(false)}
        />
      ) : null}
      {targeting ? (
        <ArsenalTargetingOverlay
          target={targeting}
          marks={shown.enemy.marks}
          onFire={onEnemyPress}
          onCancel={() => useBattle.getState().selectArsenal(null)}
        />
      ) : null}
      {emotesOpen ? <EmotePanel onPick={onEmote} onClose={() => setEmotesOpen(false)} /> : null}
      {curtain ? (
        <Curtain
          name={combatants[shown.turn]?.name ?? 'the other player'}
          onReady={() => useBattle.getState().dismissCurtain()}
        />
      ) : null}
      {mode === 'online' ? <ConnectionOverlay /> : null}
      {resignOpen ? (
        <ResignDialog
          tutorial={tutorial}
          onCancel={() => setResignOpen(false)}
          onConfirm={confirmResign}
        />
      ) : null}
    </Scale>
  );
}

const styles = StyleSheet.create({
  loading: {
    position: 'absolute',
    left: CANVAS_W / 2 - 17,
    top: CANVAS_H / 2 - 17,
  },
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
  resignOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 200,
    backgroundColor: color.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resignContent: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  resignTitle: { color: color.inkRed, fontFamily: font.display, fontSize: typeScale.lg },
  resignBody: { color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.sm },
  resignButtons: { flexDirection: 'row', gap: space.sm },
});

/** The route: a normal match built from what placement left behind. */
export default function BattleRoute() {
  return <BattleScreen />;
}
