/**
 * Main menu — the 800 x 360 composition:
 *   top-left      RankBadge with avatar thumb, player name, rank progress
 *   top-right     point, coin and gem chips
 *   centre        the title mark, then the vertical stack of actions
 *   bottom-left   settings and sound toggle
 *   bottom-right  the version string (P17 makes it the demo-menu tap target)
 *
 * Menu actions deliberately stay as plain views so native-stack reattachment
 * cannot leave invisible-but-clickable animated opacity behind.
 */
import { rankProgress } from '@engine/ranks';
import Constants from 'expo-constants';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DemoMenu, useVersionTaps } from '@/features/demo/DemoMenu';
import { useOnlineCount } from '@/net/presence';
import { useProfile } from '@/state/profile';
import { usePoints } from '@/state/points';
import { usePrivySync } from '@/state/privySync';
import { AVATARS } from '@/ui/assets';
import { CurrencyChip } from '@/ui/CurrencyChip';
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
  const pointBalance = usePoints((state) => state.balance);
  const onlineCount = useOnlineCount();
  const progress = rankProgress(profile.rankPoints);
  const version = Constants.expoConfig?.version ?? '0.0.0';
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
          seedKey="menu"
        />
      </View>

      <View style={styles.topRight}>
        <CurrencyChip kind="points" value={pointBalance} />
        <CurrencyChip kind="coins" value={profile.coins} />
        <CurrencyChip kind="gems" value={profile.gems} />
      </View>

      <View style={styles.title} pointerEvents="none">
        <LogoMark w={250} h={50} subtitle="Sea Battle" />
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

      <View style={styles.bottomLeft}>
        <InkIconButton
          icon="settings"
          accessibilityLabel="Settings"
          onPress={() => router.push('/settings')}
        />
        <InkIconButton
          icon={profile.soundOn ? 'sound-on' : 'sound-off'}
          accessibilityLabel={profile.soundOn ? 'Sound on' : 'Sound off'}
          onPress={() => profile.setSetting('soundOn', !profile.soundOn)}
        />
        <InkIconButton
          icon="profile"
          accessibilityLabel="Profile"
          onPress={() => router.push('/profile' as Href)}
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
  version: { position: 'absolute', right: space.md, bottom: space.sm },
  versionText: { color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.xxs },
});
