/**
 * Main menu — the 800 x 360 composition:
 *   top-left      RankBadge with avatar thumb (tap: profile), player name, rank progress
 *   top-right     point, coin and gem chips
 *   centre        the title mark, then the vertical stack of actions
 *   bottom-left   settings, sound toggle and the wallet
 *   bottom-right  the version string (P17 makes it the demo-menu tap target)
 *
 * Menu actions deliberately stay as plain views so native-stack reattachment
 * cannot leave invisible-but-clickable animated opacity behind.
 */
import { rankProgress } from '@engine/ranks';
import Constants from 'expo-constants';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useMemo, useRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DemoMenu, useVersionTaps } from '@/features/demo/DemoMenu';
import { useOnlineCount } from '@/net/presence';
import { usePoints } from '@/state/points';
import { usePrivySync } from '@/state/privySync';
import { useProfile } from '@/state/profile';
import { cityEnabled, loadFlags } from '@/city/features';
import { collectable, useCity } from '@/city/store';
import { getCity } from '@/city/api';
import { AVATARS } from '@/ui/assets';
import { CurrencyInfoChip } from '@/features/points/CurrencyInfoChip';
import { attentionCard } from '@/raid/ui/defenceLog';
import { raidedWhileAwayLine } from '@/raid/ui/captainCopy';
import { useRaid } from '@/raid/store';
import { InkButton } from '@/ui/InkButton';
import { InkIconButton } from '@/ui/InkIconButton';
import { LogoMark } from '@/ui/LogoMark';
import { Paper } from '@/ui/Paper';
import { RankBadge } from '@/ui/RankBadge';
import { Scale } from '@/ui/Scale';
import { CANVAS_H, CANVAS_W, PAPER_GRID, color, font, space, type as typeScale } from '@/ui/tokens';

const BUTTON_W = 176;
const BUTTON_H = 36;
const MENU_W = BUTTON_W * 2 + space.xs;
/** Rows are spaced like the columns, so the block reads as one grid. */
const ROW_GAP = space.xs;
/** The online count keeps its line whether or not it has arrived — otherwise
 *  the whole stack jumps down the moment presence resolves. */
const ONLINE_LINE_H = 14;
const MENU_H = BUTTON_H * 4 + ROW_GAP * 3 + ONLINE_LINE_H;
/**
 * Centred in the band under the title rather than on the canvas, so the stack
 * sits clear of the rank badge and reads as the lower half of the sheet.
 */
const MENU_TOP = Math.round((CANVAS_H - MENU_H) / 2) + 16;

interface Action {
  label: string;
  href: Href;
  tone?: 'ink' | 'confirm';
}

const ACTIONS: readonly Action[] = [
  {
    label: 'Play online',
    href: '/placement?mode=online' as Href,
    tone: 'confirm',
  },
  { label: 'Play offline', href: '/placement?mode=ai' as Href },
  { label: 'Two players', href: '/hotseat' as Href },
  { label: 'How to play', href: '/tutorial' },
  { label: 'Leaderboard', href: '/leaderboard' },
  { label: 'Port city', href: '/city' },
  { label: 'Points exchange', href: '/points' },
];
const EXCHANGE_ACTION = ACTIONS[6] as Action;

/**
 * Keep menu actions on the React Native view tree. Reanimated-owned opacity
 * could remain at zero after a native-stack detach/reattach while the touch
 * targets stayed active, producing invisible but clickable buttons.
 */
function Staggered({ children }: { index: number; children: ReactNode }) {
  return <View>{children}</View>;
}

export default function MenuScreen() {
  const router = useRouter();
  const profile = useProfile();
  /** The icon reflects "is anything audible", not just the effects channel. */
  const audioOn = profile.soundOn || profile.musicOn;
  const pointBalance = usePoints((state) => state.balance);
  const onlineCount = useOnlineCount();
  const progress = rankProgress(profile.rankPoints);
  const version = Constants.expoConfig?.version ?? '0.0.0';
  // part-07 §4 — the one-time card for a raid taken while away.
  const raidLog = useRaid((state) => state.log);
  const raidCard = attentionCard(raidLog);
  const onVersionTap = useVersionTaps();

  // Returning home is a safe retry point for an account sync that failed
  // during boot. PrivyProfileSync remains the single owner of the actual
  // create-or-fetch request and of the one-time welcome award.
  useFocusEffect(
    useCallback(() => {
      const sync = usePrivySync.getState();
      if (sync.status === 'error') sync.retry();
    }, []),
  );

  /**
   * The Port City dot (part-02 §8): red ink when anything is collectable or a
   * job has finished. Reads the CACHED snapshot immediately so the dot is
   * right on a cold open, then refreshes on focus — throttled to once a
   * minute, because this is a nicety and not worth a request per navigation.
   */
  const citySnapshot = useCity((state) => state.snapshot);
  const cityOffset = useCity((state) => state.serverOffset);
  const lastCityPoll = useRef(0);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void loadFlags().then(() => {
        if (cancelled || !cityEnabled()) return;
        const now = Date.now();
        if (now - lastCityPoll.current < 60_000) return;
        lastCityPoll.current = now;
        void getCity()
          .then((response) => {
            if (!cancelled) useCity.getState().applyResponse(response);
          })
          .catch(() => {
            /* the cached snapshot is good enough for a dot */
          });
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const cityDot = useMemo(() => {
    if (!citySnapshot) return false;
    if (collectable({ snapshot: citySnapshot }).total > 0) return true;
    // A job whose endsAt has passed is "finished" as far as the dot cares,
    // even before the server has settled it.
    const now = Date.now() + cityOffset;
    return Object.values(citySnapshot.city.buildings).some(
      (b) => b.upgrading !== undefined && b.upgrading.endsAt <= now,
    );
  }, [citySnapshot, cityOffset]);

  return (
    <Scale>
      <Paper variant="full" />

      <View style={styles.topLeft}>
        <RankBadge
          name={profile.name || 'Sailor'}
          rank={progress.rank.name}
          current={progress.current}
          total={progress.total}
          avatar={{ source: AVATARS[profile.avatarId], tint: profile.avatarColor }}
          // The profile lives behind the avatar itself — there is no separate
          // icon for it in the bottom-left row any more.
          onAvatarPress={() => router.push('/profile' as Href)}
          seedKey="menu"
        />
      </View>

      <View style={styles.topRight}>
        <CurrencyInfoChip kind="points" value={pointBalance} />
        <CurrencyInfoChip kind="coins" value={profile.coins} />
        <CurrencyInfoChip kind="gems" value={profile.gems} />
      </View>

      <View style={styles.title} pointerEvents="none">
        <LogoMark w={250} h={50} subtitle="Ocean Warfare" />
      </View>

      <View style={styles.stack}>
        {[ACTIONS.slice(0, 2), ACTIONS.slice(2, 4), ACTIONS.slice(4, 6)].map((row, rowIndex) => (
          <View key={`menu-row-${rowIndex}`} style={styles.actionRow}>
            {row.map((action, columnIndex) => (
              <Staggered key={action.label} index={rowIndex * 2 + columnIndex}>
                <InkButton
                  label={action.label}
                  tone={action.tone ?? 'ink'}
                  w={BUTTON_W}
                  h={BUTTON_H}
                  size="sm"
                  onPress={() => router.push(action.href)}
                />
                {action.label === 'Play online' ? (
                  <Text style={styles.online} numberOfLines={1}>
                    {onlineCount !== null ? `${onlineCount} sailors online` : ' '}
                  </Text>
                ) : null}
                {/* part-02 §8 — something is waiting in the Port City. */}
                {action.label === 'Port city' && cityDot ? (
                  <View style={styles.cityDot} pointerEvents="none" />
                ) : null}
              </Staggered>
            ))}
          </View>
        ))}
        <View style={styles.exchangeRow}>
          <InkButton
            label={EXCHANGE_ACTION.label}
            w={BUTTON_W}
            h={BUTTON_H}
            size="sm"
            onPress={() => router.push(EXCHANGE_ACTION.href)}
          />
        </View>
      </View>

      {/* part-07 §4 — "a raid that took >= 2 stars while the player was away
          also shows a one-time card on the menu". It reads the cached defence
          log, so it is right the moment the menu opens rather than after a
          round trip; opening the log marks it read and it does not come back. */}
      {raidCard ? (
        <Pressable
          style={styles.raidCard}
          accessibilityRole="button"
          onPress={() => router.push('/harbour-log')}
        >
          <Text style={styles.raidCardText} numberOfLines={2}>
            {raidedWhileAwayLine(raidCard.stars, raidCard.takenSteel)}
          </Text>
          <Text style={styles.raidCardAction}>Revenge →</Text>
        </Pressable>
      ) : null}

      <View style={styles.bottomLeft}>
        <InkIconButton
          icon="settings"
          accessibilityLabel="Settings"
          onPress={() => router.push('/settings')}
        />
        <InkIconButton
          icon={audioOn ? 'sound-on' : 'sound-off'}
          accessibilityLabel={audioOn ? 'Sound on' : 'Sound off'}
          onPress={() => {
            // One button, so it has to be a master mute. It only moved
            // `soundOn`, which silences effects but not the menu loop — so
            // turning "sound" off left music playing and looked like a
            // decorative toggle. Settings still exposes the two separately.
            const next = !audioOn;
            profile.setSetting('soundOn', next);
            profile.setSetting('musicOn', next);
          }}
        />
        <InkIconButton
          icon="wallet"
          accessibilityLabel="Solana wallet"
          onPress={() => router.push('/wallet' as Href)}
        />
      </View>

      {/* Five taps here open the demo menu (P17) — a plain Pressable, no visible affordance. */}
      <Pressable
        style={styles.version}
        onPress={onVersionTap}
        hitSlop={12}
        accessibilityLabel={`Version ${version}`}
      >
        <Text style={styles.versionText}>v{version}</Text>
      </Pressable>
      <DemoMenu />
    </Scale>
  );
}

const styles = StyleSheet.create({
  // Corner blocks sit just under the red margin rule; only the title crosses it.
  topLeft: { position: 'absolute', left: space.md, top: PAPER_GRID.ruleY + 6 },
  topRight: {
    position: 'absolute',
    right: space.md,
    top: PAPER_GRID.ruleY + 6,
    flexDirection: 'row',
    gap: space.xs,
  },
  title: { position: 'absolute', left: (CANVAS_W - 250) / 2, top: 0 },
  stack: {
    position: 'absolute',
    left: (CANVAS_W - MENU_W) / 2,
    top: MENU_TOP,
    width: MENU_W,
    gap: ROW_GAP,
  },
  actionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xs },
  /**
   * A small red ink dot on the Port city button. Square, not round: this
   * design has no rounded corners, so a 6x6 ink square reads as a pen mark
   * rather than a UI-kit badge.
   */
  cityDot: {
    position: 'absolute',
    right: 4,
    top: 4,
    width: 6,
    height: 6,
    backgroundColor: color.inkRed,
  },
  exchangeRow: { alignItems: 'center' },
  online: {
    color: color.inkSoft,
    fontFamily: font.body,
    fontSize: typeScale.xxs,
    height: ONLINE_LINE_H,
    lineHeight: ONLINE_LINE_H,
    textAlign: 'center',
  },
  bottomLeft: {
    position: 'absolute',
    left: space.sm,
    bottom: space.sm,
    flexDirection: 'row',
    gap: space.xs,
  },
  raidCard: {
    position: 'absolute',
    left: space.md,
    top: space.sm,
    width: 250,
    paddingVertical: 6,
    paddingHorizontal: space.sm,
    backgroundColor: color.paper,
    borderWidth: 1.5,
    borderColor: color.inkRed,
  },
  raidCardText: { color: color.ink, fontFamily: font.body, fontSize: typeScale.xxs },
  raidCardAction: {
    color: color.inkRed,
    fontFamily: font.label,
    fontSize: typeScale.xxs,
    marginTop: 2,
  },
  version: { position: 'absolute', right: space.md, bottom: space.sm },
  versionText: { color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.xxs },
});
