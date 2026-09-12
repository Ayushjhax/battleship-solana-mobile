/**
 * The connection UI for an online battle (P13). Four states, one component:
 *
 *   connecting        an ink spinner in the HUD corner
 *   reconnecting      boards dimmed (the screen owns that), the Captain:
 *                     "Lost contact. Trying to raise them." + forfeit countdown
 *   opponent dropped  same treatment: "They've dropped out. Waiting 45 seconds."
 *   failed            an InkPanel with the reason and "Try again" / "Back to menu"
 *
 * Copy is plain and specific, never "something went wrong" — see
 * failureCopy() in src/net/match-client.ts.
 */
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { DISCONNECT_GRACE_MS, failureCopy, useMatchClient } from '@/net/match-client';
import { useBattle } from '@/state/battle';
import { AssetSlot } from '@/ui/AssetSlot';
import { AVATARS } from '@/ui/assets';
import { InkButton } from '@/ui/InkButton';
import { InkPanel } from '@/ui/InkPanel';
import { InkSpinner } from '@/ui/InkSpinner';
import { SpeechBubble } from '@/ui/SpeechBubble';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';

const CAPTAIN = { w: 150, h: 200 } as const;

export type ConnectionKind =
  | 'none'
  | 'connecting'
  /** Matched and our fleet is in; the other side is still placing. */
  | 'waitingForOpponent'
  | 'reconnecting'
  | 'opponentDropped'
  | 'failed';

/** What the battle screen should be showing right now. Only ever non-'none' online. */
export function useConnectionKind(): ConnectionKind {
  const mode = useBattle((s) => s.mode);
  const shown = useBattle((s) => s.shown);
  const status = useMatchClient((s) => s.status);
  const opponentDisconnected = useMatchClient((s) => s.opponentDisconnected);
  if (mode !== 'online') return 'none';
  if (status === 'failed') return 'failed';
  if (status === 'reconnecting') return 'reconnecting';
  if (opponentDisconnected) return 'opponentDropped';
  if (status === 'connecting') return 'connecting';
  if (!shown || shown.phase === 'placing') return 'waitingForOpponent';
  return 'none';
}

/** Whole seconds until `deadline`, re-read twice a second. */
function useCountdown(deadline: number | null): number | null {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (deadline === null) {
      setLeft(null);
      return;
    }
    const update = () => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    update();
    const id = setInterval(update, 500);
    return () => clearInterval(id);
  }, [deadline]);
  return left;
}

function Captain({ text }: { text: string }) {
  const rise = useSharedValue(120);
  useEffect(() => {
    rise.value = withTiming(0, { duration: 320, easing: Easing.out(Easing.cubic) });
  }, [rise]);
  const slide = useAnimatedStyle(() => ({ transform: [{ translateY: rise.value }] }));
  const left = 10;
  const bubbleW = 270;
  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={[
          { position: 'absolute', left, top: CANVAS_H - CAPTAIN.h, width: CAPTAIN.w, height: CAPTAIN.h },
          slide,
        ]}
      >
        <AssetSlot source={AVATARS.captain} w={CAPTAIN.w} h={CAPTAIN.h} label="captain" />
      </Animated.View>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: left + CAPTAIN.w + 2, top: CANVAS_H - CAPTAIN.h + 6 }}
      >
        <SpeechBubble key={text} text={text} tail="left" tailAt={0.3} w={bubbleW} seedKey="connection" />
      </View>
    </>
  );
}

export function ConnectionOverlay() {
  const router = useRouter();
  const kind = useConnectionKind();
  const failure = useMatchClient((s) => s.failure);
  const reconnectDeadline = useMatchClient((s) => s.reconnectDeadline);
  const opponentDroppedAt = useMatchClient((s) => s.opponentDroppedAt);
  const opponentName = useMatchClient((s) => s.opponent?.name ?? null);

  const forfeitIn = useCountdown(kind === 'reconnecting' ? reconnectDeadline : null);
  const opponentIn = useCountdown(
    kind === 'opponentDropped' && opponentDroppedAt !== null ? opponentDroppedAt + DISCONNECT_GRACE_MS : null,
  );

  if (kind === 'none') return null;

  if (kind === 'connecting') {
    return (
      <View pointerEvents="none" style={styles.corner}>
        <InkSpinner size={26} seedKey="hud" />
      </View>
    );
  }

  if (kind === 'waitingForOpponent') {
    const name = opponentName ?? 'the other captain';
    return (
      <>
        <View pointerEvents="none" style={styles.corner}>
          <InkSpinner size={26} seedKey="hud" />
        </View>
        <Captain text={`Waiting for ${name} to place their fleet.`} />
      </>
    );
  }

  if (kind === 'reconnecting') {
    const tail = forfeitIn === null ? '' : ` ${forfeitIn}s until the match counts as lost.`;
    return <Captain text={`Lost contact. Trying to raise them.${tail}`} />;
  }

  if (kind === 'opponentDropped') {
    const secs = opponentIn ?? 45;
    return <Captain text={`They've dropped out. Waiting ${secs} seconds.`} />;
  }

  // failed
  const w = 420;
  const h = 190;
  return (
    <View style={styles.centre} pointerEvents="box-none">
      <InkPanel w={w} h={h} seedKey="connection-failed" padding={space.md}>
        <Text style={styles.failedTitle}>No connection</Text>
        <Text style={styles.failedBody}>{failure ? failureCopy(failure) : 'The match server is out of reach.'}</Text>
        <View style={styles.buttons}>
          <InkButton
            label="Try again"
            tone="confirm"
            size="md"
            w={150}
            seedKey="conn-retry"
            onPress={() => useMatchClient.getState().retry()}
          />
          <InkButton
            label="Back to menu"
            size="md"
            w={150}
            seedKey="conn-menu"
            onPress={() => {
              useMatchClient.getState().disconnect();
              router.replace('/menu');
            }}
          />
        </View>
      </InkPanel>
    </View>
  );
}

const styles = StyleSheet.create({
  corner: { position: 'absolute', left: 12, top: 10 },
  centre: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: CANVAS_W,
    height: CANVAS_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  failedTitle: {
    color: color.inkRed,
    fontFamily: font.display,
    fontSize: typeScale.lg,
    marginBottom: 4,
  },
  failedBody: {
    color: color.ink,
    fontFamily: font.body,
    fontSize: typeScale.sm,
    lineHeight: Math.round(typeScale.sm * 1.35),
    flexGrow: 1,
  },
  buttons: { flexDirection: 'row', gap: space.md, justifyContent: 'flex-end' },
});
