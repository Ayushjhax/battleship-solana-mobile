/**
 * Main menu — the 800 x 360 composition, drawn to its mockup:
 *   top-left      profile card: your chosen captain, name, rank, rank progress (tap: profile)
 *   top-centre    the logo
 *   top-right     coin, gem and point pills, then settings, sound and wallet
 *   centre        the Play online / Play offline cards
 *   bottom        six tiles: two players, how to play, leaderboard, port city,
 *                 store, points exchange
 *   bottom-right  the version string (P17 makes it the demo-menu tap target)
 *
 * Menu actions deliberately stay as plain views so native-stack reattachment
 * cannot leave invisible-but-clickable animated opacity behind.
 */
import { rankProgress } from '@engine/ranks';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DemoMenu, useVersionTaps } from '@/features/demo/DemoMenu';
import {
  CurrencyPill,
  GlyphTileButton,
  IconTileButton,
  MenuTile,
  PlayCard,
  ProfileCard,
} from '@/features/menu/MenuParts';
import { useOnlineCount } from '@/net/presence';
import { useSpendableCoins } from '@/state/locker';
import { usePoints } from '@/state/points';
import { usePrivySync } from '@/state/privySync';
import { useProfile } from '@/state/profile';
import { BACKGROUNDS, BRAND, MENU_ART, type Asset } from '@/ui/assets';
import { portraitFor } from '@/ui/portraits';
import { Scale } from '@/ui/Scale';
import { CANVAS_W, menuColor, menuFont, space, type as typeScale } from '@/ui/tokens';

const PROFILE = { x: 12, y: 8, w: 236, h: 64 } as const;
const LOGO = { w: 200, h: 80, y: 2 } as const;
const PILL = { w: 64, gap: 6, right: 56, y: 12 } as const;
const SIDE_TILE = 36;
const CARD = { w: 286, h: 184, gap: 18, y: 84 } as const;
const TILE = { w: 91, h: 66, gap: 8, y: 274 } as const;
const CARDS_LEFT = (CANVAS_W - CARD.w * 2 - CARD.gap) / 2;
const TILES_LEFT = (CANVAS_W - TILE.w * 6 - TILE.gap * 5) / 2;

interface Tile {
  label: string;
  icon: Asset;
  fill: string;
  href: Href;
}

const TILES: readonly Tile[] = [
  { label: 'TWO PLAYERS', icon: MENU_ART.friends, fill: menuColor.twoPlayers, href: '/hotseat' as Href },
  { label: 'HOW TO PLAY', icon: MENU_ART.rulebook, fill: menuColor.howToPlay, href: '/how-to-play' as Href },
  { label: 'LEADERBOARD', icon: MENU_ART.trophy, fill: menuColor.leaderboard, href: '/leaderboard' },
  { label: 'PORT CITY', icon: MENU_ART.harbor, fill: menuColor.portCity, href: '/city' },
  { label: 'STORE', icon: MENU_ART.shop, fill: menuColor.store, href: '/store' as Href },
  {
    label: 'POINTS EXCHANGE',
    icon: MENU_ART.coinStacks,
    fill: menuColor.pointsExchange,
    href: '/points' as Href,
  },
];

export default function MenuScreen() {
  const router = useRouter();
  const profile = useProfile();
  /** The icon reflects "is anything audible", not just the effects channel. */
  const audioOn = profile.soundOn || profile.musicOn;
  const pointBalance = usePoints((state) => state.balance);
  const onlineCount = useOnlineCount();
  const progress = rankProgress(profile.rankPoints);
  const version = Constants.expoConfig?.version ?? '0.0.0';
  const onVersionTap = useVersionTaps();
  const coins = useSpendableCoins();

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
    <Scale backgroundImage={BACKGROUNDS.menu}>
      <View style={styles.profile}>
        <ProfileCard
          w={PROFILE.w}
          h={PROFILE.h}
          name={profile.name || 'Sailor'}
          portrait={portraitFor(profile.avatarId, profile.avatarColor)}
          countryCode={profile.countryCode}
          rank={progress.rank.name}
          current={progress.current}
          total={progress.total}
          onPress={() => router.push('/profile' as Href)}
        />
      </View>

      <View style={styles.logo} pointerEvents="none">
        <Image source={BRAND.wordmark} style={StyleSheet.absoluteFill} contentFit="contain" />
      </View>

      <View style={styles.pills}>
        <CurrencyPill icon={MENU_ART.coin} value={coins} w={PILL.w} seedKey="pill-coins" />
        <CurrencyPill icon={MENU_ART.gem} value={profile.gems} w={PILL.w} seedKey="pill-gems" />
        <CurrencyPill icon={MENU_ART.star} value={pointBalance} w={PILL.w} seedKey="pill-points" />
      </View>

      <View style={styles.sideButtons}>
        <IconTileButton
          source={MENU_ART.settings}
          size={38}
          accessibilityLabel="Settings"
          onPress={() => router.push('/settings')}
        />
        <GlyphTileButton
          source={MENU_ART.speaker}
          size={SIDE_TILE}
          seedKey="side-sound"
          crossed={!audioOn}
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
        <GlyphTileButton
          source={MENU_ART.wallet}
          size={SIDE_TILE}
          seedKey="side-wallet"
          accessibilityLabel="Solana wallet"
          onPress={() => router.push('/wallet' as Href)}
        />
      </View>

      <View style={styles.cards}>
        <PlayCard
          w={CARD.w}
          h={CARD.h}
          title="PLAY ONLINE"
          subtitle="PvP • Ranked Battles"
          art={MENU_ART.playOnline}
          fill={menuColor.onlineCard}
          buttonFill={menuColor.onlineButton}
          buttonLabel="PLAY ONLINE"
          // The line keeps its height whether or not presence has answered, so
          // nothing in the card jumps when the count lands.
          footer={onlineCount !== null ? `${onlineCount} sailors online` : ' '}
          seedKey="play-online"
          onPress={() => router.push('/placement?mode=online' as Href)}
        />
        <PlayCard
          w={CARD.w}
          h={CARD.h}
          title="PLAY OFFLINE"
          subtitle="Practice • AI Battles"
          art={MENU_ART.playOffline}
          fill={menuColor.offlineCard}
          buttonFill={menuColor.offlineButton}
          buttonLabel="PLAY OFFLINE"
          seedKey="play-offline"
          onPress={() => router.push('/placement?mode=ai' as Href)}
        />
      </View>

      <View style={styles.tiles}>
        {TILES.map((tile) => (
          <MenuTile
            key={tile.label}
            w={TILE.w}
            h={TILE.h}
            label={tile.label}
            icon={tile.icon}
            fill={tile.fill}
            seedKey={`tile-${tile.label}`}
            onPress={() => router.push(tile.href)}
          />
        ))}
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
  profile: { position: 'absolute', left: PROFILE.x, top: PROFILE.y },
  logo: {
    position: 'absolute',
    left: (CANVAS_W - LOGO.w) / 2,
    top: LOGO.y,
    width: LOGO.w,
    height: LOGO.h,
  },
  pills: {
    position: 'absolute',
    right: PILL.right,
    top: PILL.y,
    flexDirection: 'row',
    gap: PILL.gap,
  },
  sideButtons: {
    position: 'absolute',
    right: space.xs,
    top: 8,
    alignItems: 'center',
    gap: 4,
  },
  cards: {
    position: 'absolute',
    left: CARDS_LEFT,
    top: CARD.y,
    flexDirection: 'row',
    gap: CARD.gap,
  },
  tiles: {
    position: 'absolute',
    left: TILES_LEFT,
    top: TILE.y,
    flexDirection: 'row',
    gap: TILE.gap,
  },
  version: { position: 'absolute', right: space.md, bottom: space.xs },
  versionText: { color: menuColor.navy, fontFamily: menuFont.hand, fontSize: typeScale.xs },
});
