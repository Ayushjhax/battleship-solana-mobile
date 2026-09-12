/**
 * The hidden demo menu (P17) — five taps on the menu's version string. For
 * a presenter with hostile wifi, not for players: every action is a jump or
 * a rigged view, nothing here writes to the profile or the server.
 *
 *   Jump          straight to any screen
 *   Force a win   the result screen, victory, +25/+50 shown as given
 *   Force rank-up the result screen with totals that cross the next threshold
 *   Scripted match the AI match from src/features/demo/demoMatch.ts
 *   Hard offline  src/state/demo.ts — every network path answers "offline"
 *
 * Your user id is shown so `npm --prefix server run seed:demo -- <id>` can
 * pre-seed rank and history before you walk on stage.
 */
import { RANKS, REWARD, rankProgress } from '@engine/ranks';
import { useRouter, type Href } from 'expo-router';
import { useCallback, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useDemo } from '@/state/demo';
import { useProfile } from '@/state/profile';
import { InkButton } from '@/ui/InkButton';
import { InkPanel } from '@/ui/InkPanel';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';

const PANEL_W = 560;
const PANEL_H = 300;

const SCREENS: readonly { label: string; href: Href }[] = [
  { label: 'Boot', href: '/' },
  { label: 'Menu', href: '/menu' },
  { label: 'Tutorial', href: '/tutorial' },
  { label: 'Placement (offline)', href: '/placement?mode=ai' as Href },
  { label: 'Placement (online)', href: '/placement?mode=online' as Href },
  { label: 'Two players', href: '/hotseat' },
  { label: 'Searching', href: '/searching' },
  { label: 'Leaderboard', href: '/leaderboard' },
  { label: 'Port city', href: '/city' },
  { label: 'Settings', href: '/settings' },
  {
    label: 'Result (loss)',
    href: '/result?won=0&local=1&mode=ai&ruleset=advanced&oppName=Berhan&oppPoints=13365&oppAvatar=4&oppFlag=RU' as Href,
  },
];

const OPPONENT = 'oppName=Berhan&oppPoints=13365&oppAvatar=4&oppTint=%233A3A3A&oppFlag=RU';

export function DemoMenu() {
  const router = useRouter();
  const open = useDemo((s) => s.open);
  const forceOffline = useDemo((s) => s.forceOffline);
  const userId = useProfile((s) => s.userId);
  const rankPoints = useProfile((s) => s.rankPoints);
  const coins = useProfile((s) => s.coins);

  if (!open) return null;

  const close = () => useDemo.getState().setOpen(false);
  const go = (href: Href) => {
    close();
    router.push(href);
  };

  const forceWin = () => {
    const forced = [
      rankPoints,
      rankPoints + REWARD.win.points,
      coins,
      coins + REWARD.win.coins,
    ].join(',');
    go(`/result?won=1&local=1&mode=ai&ruleset=advanced&forced=${forced}&${OPPONENT}` as Href);
  };

  const forceRankUp = () => {
    // Land 15 points past the NEXT threshold, having started 10 points short of it.
    const { next } = rankProgress(rankPoints);
    const target = next ?? RANKS[RANKS.length - 1]!;
    const after = target.points + 15;
    const before = after - REWARD.win.points;
    const forced = [before, after, coins, coins + REWARD.win.coins].join(',');
    go(`/result?won=1&local=1&mode=ai&ruleset=advanced&forced=${forced}&${OPPONENT}` as Href);
  };

  return (
    <View style={styles.backdrop}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={close}
        accessibilityLabel="Close the demo menu"
      />
      <View style={styles.panel}>
        <InkPanel w={PANEL_W} h={PANEL_H} seedKey="demo-menu" padding={space.sm}>
          <View style={styles.head}>
            <Text style={styles.title}>Demo menu</Text>
            <Text style={styles.id} numberOfLines={1} selectable>
              id {userId ?? 'offline (no session yet)'}
            </Text>
            <InkButton label="Close" size="sm" w={70} h={30} onPress={close} />
          </View>

          <View style={styles.row}>
            <InkButton
              label="Force a win"
              tone="confirm"
              size="sm"
              w={118}
              h={32}
              onPress={forceWin}
            />
            <InkButton
              label="Force a rank-up"
              tone="confirm"
              size="sm"
              w={136}
              h={32}
              onPress={forceRankUp}
            />
            <InkButton
              label="Scripted match"
              size="sm"
              w={126}
              h={32}
              onPress={() => go('/demo-battle' as Href)}
            />
            <InkButton
              label={forceOffline ? 'Offline: ON' : 'Offline: off'}
              tone={forceOffline ? 'confirm' : 'ink'}
              size="sm"
              w={118}
              h={32}
              seedKey="demo-offline"
              onPress={() => useDemo.getState().setForceOffline(!forceOffline)}
            />
          </View>
          <Text style={styles.hint}>
            {forceOffline
              ? 'Hard offline is on: no socket, no Supabase, no presence. Offline play only.'
              : 'Hard offline off: the app talks to the network normally.'}
          </Text>

          <Text style={styles.section}>Jump to</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.jump}
          >
            {SCREENS.map((s) => (
              <InkButton
                key={s.label}
                label={s.label}
                size="sm"
                h={30}
                seedKey={`jump-${s.label}`}
                onPress={() => go(s.href)}
              />
            ))}
          </ScrollView>
        </InkPanel>
      </View>
    </View>
  );
}

/** Five taps inside 2.5 s on the version string opens the menu. */
export function useVersionTaps(): () => void {
  const taps = useRef<number[]>([]);
  return useCallback(() => {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 2500), now];
    if (taps.current.length >= 5) {
      taps.current = [];
      useDemo.getState().setOpen(true);
    }
  }, []);
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', left: 0, top: 0, width: CANVAS_W, height: CANVAS_H },
  panel: { position: 'absolute', left: (CANVAS_W - PANEL_W) / 2, top: (CANVAS_H - PANEL_H) / 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.xs },
  title: { color: color.ink, fontFamily: font.display, fontSize: typeScale.md },
  id: { flex: 1, color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.xxs },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },
  hint: {
    marginTop: space.xs,
    color: color.inkSoft,
    fontFamily: font.body,
    fontSize: typeScale.xxs,
  },
  section: {
    marginTop: space.sm,
    color: color.inkSoft,
    fontFamily: font.label,
    fontSize: typeScale.xs,
  },
  jump: { flexDirection: 'row', gap: space.xs, paddingVertical: space.xs },
});
