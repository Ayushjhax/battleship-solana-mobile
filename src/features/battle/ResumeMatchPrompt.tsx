/**
 * "You are still in a match." — the choice a player gets when the app comes
 * back and the server has kept their room alive.
 *
 * It is mounted at the root, so it finds the player wherever they are. The
 * match client's own reconnect path is NOT this: that runs while the battle
 * screen is open and needs no prompt. This only appears for a match this
 * session never entered — an app that was killed, crashed, or backgrounded
 * long enough to drop the socket.
 *
 * The prompt is deliberately unskippable. While it is up the socket is
 * attached, so the room is not forfeiting; the choice is the only way out.
 */
import { useRouter, usePathname } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Modal, StyleSheet, Text, View } from 'react-native';

import { useMatchClient } from '@/net/match-client';
import { useBattle } from '@/state/battle';
import { InkButton } from '@/ui/InkButton';
import { InkPanel } from '@/ui/InkPanel';
import { InkSpinner } from '@/ui/InkSpinner';
import { Scale } from '@/ui/Scale';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';

const PANEL_W = 430;
const PANEL_H = 214;

export function ResumeMatchPrompt() {
  const router = useRouter();
  const pathname = usePathname();
  const offer = useMatchClient((s) => s.resumeOffer);
  const status = useMatchClient((s) => s.status);
  const [resigning, setResigning] = useState(false);
  const sawOffer = useRef(false);

  // Ask once the app is past the boot sheet, and again whenever it returns to
  // the foreground — that is exactly when a dropped socket is discovered.
  const booting = pathname === '/' || pathname === '';
  useEffect(() => {
    if (booting) return;
    useMatchClient.getState().discover();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') useMatchClient.getState().discover();
    });
    return () => sub.remove();
  }, [booting]);

  useEffect(() => {
    if (offer) sawOffer.current = true;
  }, [offer]);

  // The match ended underneath the prompt: our own grace ran out elsewhere, or
  // the opponent finished us off. Show the result rather than dropping the
  // player back on the menu with nothing explained.
  useEffect(() => {
    if (status !== 'over' || !sawOffer.current) return;
    sawOffer.current = false;
    setResigning(false);
    const client = useMatchClient.getState();
    const over = client.over;
    if (!over) return;
    router.replace({
      pathname: '/result',
      params: {
        won: over.winnerId === client.playerId ? '1' : '0',
        local: '0',
        mode: 'online',
        ruleset: client.mode ?? 'advanced',
        matchId: client.matchId ?? '',
        wager: client.wagered ? '1' : '0',
        oppName: client.opponent?.name ?? '',
        oppPoints: String(client.opponent?.rankPoints ?? 0),
        oppAvatar: String(client.opponent?.avatarId ?? 2),
        oppTint: client.opponent?.avatarColor ?? '',
        oppFlag: client.opponent?.countryCode ?? '',
      },
    });
  }, [status, router]);

  const rejoin = useCallback(() => {
    // The battle store is rebuilt from the server's snapshot on mount, so wipe
    // anything a previous match left behind before the screen reads it.
    useBattle.getState().reset();
    useMatchClient.getState().enterMatch();
    router.replace('/battle');
  }, [router]);

  const resign = useCallback(() => {
    if (resigning) return;
    setResigning(true);
    // The server turns this into a RESIGN for our seat: the opponent wins at
    // once and is taken to their result screen. Ours follows on `over`.
    if (!useMatchClient.getState().declineResume()) setResigning(false);
  }, [resigning]);

  if (!offer && !resigning) return null;

  const opponentName = offer?.opponentName ?? 'your opponent';
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View style={styles.dim} accessibilityViewIsModal>
        <Scale transparent>
          <View style={styles.card}>
            <InkPanel w={PANEL_W} h={PANEL_H} seedKey="resume-match" padding={space.lg}>
              <Text style={styles.kicker}>STILL AT SEA</Text>
              <Text style={styles.title}>Your battle against {opponentName} is live</Text>
              <Text style={styles.body}>
                {resigning
                  ? 'Striking the colours…'
                  : offer?.wagered
                    ? `Rejoin exactly where you left off, or resign and hand ${opponentName} the win — and your ${offer.wagerStake}-point stake.`
                    : 'Rejoin exactly where you left off, or resign and hand them the win.'}
              </Text>
              <View style={styles.actions}>
                <InkButton
                  label="Rejoin battle"
                  tone="confirm"
                  w={176}
                  h={44}
                  size="sm"
                  disabled={resigning || !offer}
                  onPress={rejoin}
                />
                <InkButton
                  label={resigning ? 'Resigning…' : 'Resign'}
                  tone="danger"
                  w={140}
                  h={44}
                  size="sm"
                  disabled={resigning}
                  onPress={resign}
                />
              </View>
              {resigning ? (
                <InkSpinner size={18} seedKey="resume-resigning" style={styles.spinner} />
              ) : null}
            </InkPanel>
          </View>
        </Scale>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dim: { flex: 1, backgroundColor: 'rgba(28,20,15,0.5)' },
  card: { position: 'absolute', left: (CANVAS_W - PANEL_W) / 2, top: (CANVAS_H - PANEL_H) / 2 },
  kicker: {
    color: color.inkRed,
    fontFamily: font.label,
    fontSize: typeScale.xs,
    textAlign: 'center',
    letterSpacing: 1.1,
  },
  title: {
    color: color.ink,
    fontFamily: font.display,
    fontSize: typeScale.md,
    textAlign: 'center',
    marginTop: space.xs,
  },
  body: {
    color: color.inkSoft,
    fontFamily: font.body,
    fontSize: typeScale.xs,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: space.sm,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.sm,
    marginTop: space.md,
  },
  spinner: { position: 'absolute', right: 18, bottom: 18 },
});
