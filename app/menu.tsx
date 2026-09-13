/**
 * Main menu — the 800 x 360 composition:
 *   top-left      RankBadge with avatar thumb, player name, rank progress
 *   top-right     coin and gem chips
 *   centre        the title mark, then the vertical stack of actions
 *   bottom-left   settings and sound toggle
 *   bottom-right  the version string (P17 makes it the demo-menu tap target)
 *
 * The buttons enter as one staggered group, 40 ms apart. That is the only
 * entrance animation on this screen.
 */
import { rankProgress } from '@engine/ranks';
import Constants from 'expo-constants';
import { useRouter, type Href } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { DemoMenu, useVersionTaps } from '@/features/demo/DemoMenu';
import { useOnlineCount } from '@/net/presence';
import { useProfile } from '@/state/profile';
import { AVATARS } from '@/ui/assets';
import { CurrencyChip } from '@/ui/CurrencyChip';
import { InkButton } from '@/ui/InkButton';
import { InkIconButton } from '@/ui/InkIconButton';
import { LogoMark } from '@/ui/LogoMark';
import { Paper } from '@/ui/Paper';
import { RankBadge } from '@/ui/RankBadge';
import { Scale } from '@/ui/Scale';
import { CANVAS_H, CANVAS_W, PAPER_GRID, color, font, space, type as typeScale } from '@/ui/tokens';

const STAGGER_MS = 40;
const BUTTON_W = 200;

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
];

/** translateY 8 -> 0 with opacity, delayed by its place in the group. */
function Staggered({ index, children }: { index: number; children: ReactNode }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(
      index * STAGGER_MS,
      withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) }),
    );
  }, [index, progress]);
  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: 8 * (1 - progress.value) }],
  }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

export default function MenuScreen() {
  const router = useRouter();
  const profile = useProfile();
  const onlineCount = useOnlineCount();
  const progress = rankProgress(profile.rankPoints);
  const version = Constants.expoConfig?.version ?? '0.0.0';
  const onVersionTap = useVersionTaps();

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
        <CurrencyChip kind="coins" value={profile.coins} />
        <CurrencyChip kind="gems" value={profile.gems} />
      </View>

      <View style={styles.title} pointerEvents="none">
        <LogoMark w={280} h={56} subtitle="Sea Battle" />
      </View>

      <View style={styles.stack}>
        {ACTIONS.map((action, i) => (
          <Staggered key={action.label} index={i}>
            <InkButton
              label={action.label}
              tone={action.tone ?? 'ink'}
              w={BUTTON_W}
              h={36}
              size="sm"
              onPress={() => router.push(action.href)}
            />
            {action.label === 'Play online' && onlineCount !== null ? (
              <Text style={styles.online}>{onlineCount} sailors online</Text>
            ) : null}
          </Staggered>
        ))}
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
  title: { position: 'absolute', left: (CANVAS_W - 280) / 2, top: 0 },
  stack: {
    position: 'absolute',
    left: (CANVAS_W - BUTTON_W) / 2,
    top: 56,
    height: CANVAS_H - 56 - 4,
    width: BUTTON_W,
    justifyContent: 'center',
    gap: 4,
  },
  online: {
    color: color.inkSoft,
    fontFamily: font.body,
    fontSize: typeScale.xxs,
    textAlign: 'center',
    marginTop: -2,
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
