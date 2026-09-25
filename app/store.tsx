/**
 * The store — drawn to its mockup on BACKGROUNDS.settings:
 *   top-left    home, then the profile card (captain, flag, rank; tap: profile)
 *   top-centre  the masthead: the logo with the Store plank hanging under it
 *   top-right   coin, gem and point pills, then settings
 *   below       the Crimson / Emerald / Purple edition tabs
 *   shelves     Attack and Boards, then Defence and Fleet, every item priced
 *
 * Coins buy an edition's colour of an item for the collection; nothing bought
 * here changes the game yet (the dialog and the profile both say so). What
 * was bought is kept per account in src/state/locker.ts, and every coin
 * balance in the game shows what is left to spend.
 */
import { rankProgress } from '@engine/ranks';
import { Image } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Image as RNImage, StyleSheet, View } from 'react-native';

import { haptic } from '@/audio/haptics';
import { playSfx } from '@/audio/sfx';
import { CurrencyPill, IconTileButton, ProfileCard } from '@/features/menu/MenuParts';
import {
  STORE_COLOURS,
  STORE_ITEMS,
  unlockId,
  type StoreColour,
  type StoreItem,
  type StoreSection,
} from '@/features/store/catalog';
import {
  ColourTab,
  ItemCard,
  SectionHeader,
  SpendFloat,
  UnlockDialog,
  type DialogState,
} from '@/features/store/StoreParts';
import { spendableCoins, useLocker, useStoreWallet } from '@/state/locker';
import { usePoints } from '@/state/points';
import { useProfile } from '@/state/profile';
import { ArtImageButton } from '@/ui/ArtImageButton';
import {
  BACKGROUNDS,
  BATTLE_ART,
  MENU_ART,
  STORE_ART,
  STORE_ITEM_ART,
  STORE_MASTHEAD_ASPECT,
} from '@/ui/assets';
import { portraitFor } from '@/ui/portraits';
import { Scale } from '@/ui/Scale';
import { CANVAS_W } from '@/ui/tokens';

const HOME = { x: 8, y: 13, w: 36 } as const;
const PROFILE = { x: 50, y: 8, w: 226, h: 64 } as const;
const MAST = { w: 166, y: 0 } as const;
const PILL = { w: 62, gap: 6, right: 50, y: 12 } as const;
const GEAR = { size: 36, right: 8, y: 10 } as const;
const TAB = { w: 98, gap: 12, y: 91 } as const;
const CARD = { w: 104, h: 86, gap: 6 } as const;
const HEAD_H = 22;
/** Between two sections on one shelf. */
const SECTION_GAP = 16;
const SHELVES: readonly { sections: readonly StoreSection[]; y: number }[] = [
  { sections: ['attack', 'boards'], y: 124 },
  { sections: ['defence', 'fleet'], y: 240 },
];

const ITEMS_BY_SECTION = STORE_ITEMS.reduce<Record<StoreSection, StoreItem[]>>(
  (acc, item) => {
    acc[item.section].push(item);
    return acc;
  },
  { attack: [], boards: [], defence: [], fleet: [] },
);

const sectionWidth = (section: StoreSection) => {
  const n = ITEMS_BY_SECTION[section].length;
  return n * CARD.w + (n - 1) * CARD.gap;
};

/** Every edition's art into memory up front, so a tab switch never waits on a decode. */
function prefetchStoreArt() {
  const uris = STORE_COLOURS.flatMap((colour) =>
    Object.values(STORE_ITEM_ART[colour]).flatMap((asset) =>
      typeof asset === 'number' ? [RNImage.resolveAssetSource(asset).uri] : [],
    ),
  );
  void Image.prefetch(uris, 'memory-disk').catch(() => false);
}

export default function StoreScreen() {
  const router = useRouter();
  const profile = useProfile();
  const wallet = useStoreWallet();
  const coins = spendableCoins(profile.coins, wallet);
  const pointBalance = usePoints((state) => state.balance);
  const progress = rankProgress(profile.rankPoints);
  const [colour, setColour] = useState<StoreColour>('crimson');
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [spend, setSpend] = useState<{ key: number; amount: number } | null>(null);
  /** Shown off the coin pill when the dialog closes: behind the dialog it would play unseen. */
  const [justSpent, setJustSpent] = useState(0);
  const owned = useMemo(() => new Set(wallet.unlocks), [wallet.unlocks]);

  useEffect(prefetchStoreArt, []);

  const ownedIn = (c: StoreColour) =>
    STORE_ITEMS.filter((item) => owned.has(unlockId(c, item.key))).length;

  const openItem = (item: StoreItem) => {
    const mode = owned.has(unlockId(colour, item.key))
      ? 'owned'
      : coins < item.price
        ? 'short'
        : 'confirm';
    if (mode === 'short') haptic('invalidAction');
    setDialog({ colour, item, mode });
    setDialogOpen(true);
  };

  const confirm = () => {
    if (!dialog || dialog.mode !== 'confirm') return;
    const { userId, coins: total } = useProfile.getState();
    const result = useLocker
      .getState()
      .purchase(userId, unlockId(dialog.colour, dialog.item.key), dialog.item.price, total);
    if (result === 'unlocked') {
      haptic('rankUp');
      playSfx('coinFlow');
      setJustSpent(dialog.item.price);
      setDialog({ ...dialog, mode: 'unlocked' });
    } else {
      if (result === 'short') haptic('invalidAction');
      setDialog({ ...dialog, mode: result === 'owned' ? 'owned' : 'short' });
    }
  };

  const closeDialog = () => {
    setDialogOpen(false);
    if (justSpent > 0) {
      setSpend({ key: Date.now(), amount: justSpent });
      setJustSpent(0);
    }
  };

  const pillsLeft = CANVAS_W - PILL.right - PILL.w * 3 - PILL.gap * 2;

  return (
    <Scale backgroundImage={BACKGROUNDS.settings}>
      <ArtImageButton
        source={BATTLE_ART.homeButton}
        w={HOME.w}
        h={HOME.w * (166 / 176)}
        label="Back to the menu"
        hitSlop={8}
        style={styles.home}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/menu'))}
      />
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

      <View style={styles.mast} pointerEvents="none">
        <Image source={STORE_ART.masthead} style={StyleSheet.absoluteFill} contentFit="contain" />
      </View>

      <View style={[styles.pills, { left: pillsLeft }]}>
        <CurrencyPill icon={MENU_ART.coin} value={coins} w={PILL.w} seedKey="store-pill-coins" />
        <CurrencyPill
          icon={MENU_ART.gem}
          value={profile.gems}
          w={PILL.w}
          seedKey="store-pill-gems"
        />
        <CurrencyPill
          icon={MENU_ART.star}
          value={pointBalance}
          w={PILL.w}
          seedKey="store-pill-points"
        />
      </View>
      {spend ? (
        <SpendFloat key={spend.key} amount={spend.amount} x={pillsLeft + 30} y={PILL.y + 30} />
      ) : null}
      <View style={styles.gear}>
        <IconTileButton
          source={STORE_ART.settings}
          size={GEAR.size}
          accessibilityLabel="Settings"
          onPress={() => router.push('/settings')}
        />
      </View>

      <View style={styles.tabs} accessibilityRole="tablist">
        {STORE_COLOURS.map((c) => (
          <ColourTab
            key={c}
            colour={c}
            selected={c === colour}
            w={TAB.w}
            owned={ownedIn(c)}
            total={STORE_ITEMS.length}
            onPress={() => setColour(c)}
          />
        ))}
      </View>

      {SHELVES.map(({ sections, y }) => {
        const shelfW =
          sections.reduce((sum, s) => sum + sectionWidth(s), 0) +
          SECTION_GAP * (sections.length - 1);
        let x = (CANVAS_W - shelfW) / 2;
        return sections.map((section) => {
          const left = x;
          const w = sectionWidth(section);
          x += w + SECTION_GAP;
          return (
            <View key={section} style={[styles.section, { left, top: y, width: w }]}>
              <SectionHeader section={section} w={w} h={HEAD_H} />
              <View style={styles.cards}>
                {ITEMS_BY_SECTION[section].map((item) => (
                  <ItemCard
                    key={item.key}
                    colour={colour}
                    item={item}
                    owned={owned.has(unlockId(colour, item.key))}
                    affordable={coins >= item.price}
                    w={CARD.w}
                    h={CARD.h}
                    onPress={() => openItem(item)}
                  />
                ))}
              </View>
            </View>
          );
        });
      })}

      <UnlockDialog
        visible={dialogOpen}
        state={dialog}
        coins={coins}
        onClose={closeDialog}
        onConfirm={confirm}
        onProfile={() => {
          closeDialog();
          router.push('/profile' as Href);
        }}
      />
    </Scale>
  );
}

const styles = StyleSheet.create({
  home: { position: 'absolute', left: HOME.x, top: HOME.y },
  profile: { position: 'absolute', left: PROFILE.x, top: PROFILE.y },
  mast: {
    position: 'absolute',
    left: (CANVAS_W - MAST.w) / 2,
    top: MAST.y,
    width: MAST.w,
    height: MAST.w / STORE_MASTHEAD_ASPECT,
  },
  pills: { position: 'absolute', top: PILL.y, flexDirection: 'row', gap: PILL.gap },
  gear: { position: 'absolute', right: GEAR.right, top: GEAR.y },
  tabs: {
    position: 'absolute',
    left: (CANVAS_W - TAB.w * 3 - TAB.gap * 2) / 2,
    top: TAB.y,
    flexDirection: 'row',
    gap: TAB.gap,
  },
  section: { position: 'absolute' },
  cards: { flexDirection: 'row', gap: CARD.gap, marginTop: 2 },
});
