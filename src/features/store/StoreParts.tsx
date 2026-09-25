/**
 * The store's pieces, in the menu's language — MenuCard pastels under a navy
 * pen, Fredoka caps, Patrick Hand — around the store's own art: the colour
 * tabs, the section headers (the glyph from the header art, the pill drawn
 * live so it spans its section), the item cards and the unlock dialog.
 *
 * Motion is transform-only on anything pressable; opacity moves only on the
 * stamp and the coin float, which are never touchable.
 */
import { REWARD } from '@engine/ranks';
import { Image } from 'expo-image';
import { useEffect, useRef } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { haptic } from '@/audio/haptics';
import { MenuCard, PressableInk } from '@/features/menu/MenuParts';
import { MENU_ART, STORE_ART, STORE_ITEM_ART, STORE_TAB_ASPECT } from '@/ui/assets';
import { Scale } from '@/ui/Scale';
import { CANVAS_H, CANVAS_W, menuColor, menuFont, storeColor } from '@/ui/tokens';

import {
  COLOUR_NAME,
  SECTION_NAME,
  type StoreColour,
  type StoreItem,
  type StoreSection,
} from './catalog';

export const COLOUR_WASH: Readonly<Record<StoreColour, string>> = {
  crimson: storeColor.crimsonWash,
  emerald: storeColor.emeraldWash,
  purple: storeColor.purpleWash,
};

export const COLOUR_INK: Readonly<Record<StoreColour, string>> = {
  crimson: storeColor.crimsonInk,
  emerald: storeColor.emeraldInk,
  purple: storeColor.purpleInk,
};

/** The MenuCard base under every card's body. */
const BASE = 3;

function Tick({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 12 12">
      <Path
        d="M2 6.4 L4.8 9.2 L10.2 2.8"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Colour tabs
// ---------------------------------------------------------------------------

/**
 * One colour edition's tab. The selected one is the full-colour art, lifted,
 * with a navy notch pointing down at the shelves; the others are the
 * washed-out copy, set back a little. The swap cross-fades.
 */
export function ColourTab({
  colour,
  selected,
  w,
  owned,
  total,
  onPress,
}: {
  colour: StoreColour;
  selected: boolean;
  w: number;
  owned: number;
  total: number;
  onPress: () => void;
}) {
  const h = w / STORE_TAB_ASPECT;
  const reduceMotion = useReducedMotion();
  const lift = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    lift.value = reduceMotion
      ? selected
        ? 1
        : 0
      : withSpring(selected ? 1 : 0, { damping: 14, stiffness: 220 });
  }, [lift, reduceMotion, selected]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: -2 * lift.value }, { scale: 0.9 + 0.1 * lift.value }],
  }));
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => haptic('buttonPress')}
      hitSlop={4}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={`${COLOUR_NAME[colour]} edition, ${owned} of ${total} unlocked`}
      style={{ width: w, height: h }}
    >
      <Animated.View style={[StyleSheet.absoluteFill, style]}>
        <Image
          source={selected ? STORE_ART.tabs[colour] : STORE_ART.tabsDim[colour]}
          style={StyleSheet.absoluteFill}
          contentFit="fill"
          transition={140}
          cachePolicy="memory-disk"
        />
        {owned > 0 ? (
          <View style={[styles.tabCount, { backgroundColor: COLOUR_INK[colour] }]}>
            <Text style={styles.tabCountText}>
              {owned}/{total}
            </Text>
          </View>
        ) : null}
        {selected ? (
          <Svg
            width={12}
            height={5}
            viewBox="0 0 12 5"
            style={[styles.tabNotch, { left: w / 2 - 6 }]}
          >
            <Path d="M0 0 L6 5 L12 0 Z" fill={menuColor.navy} />
          </Svg>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

export function SectionHeader({ section, w, h }: { section: StoreSection; w: number; h: number }) {
  const iconH = h - BASE * 2 - 3;
  return (
    <MenuCard w={w} h={h} fill={storeColor[section]} seedKey={`store-head-${section}`} r={8}>
      <View style={styles.headRow}>
        <Image
          source={STORE_ART.icons[section]}
          style={{ width: iconH * 1.25, height: iconH }}
          contentFit="contain"
          cachePolicy="memory-disk"
        />
        <Text style={styles.headLabel}>{SECTION_NAME[section].toUpperCase()}</Text>
      </View>
    </MenuCard>
  );
}

// ---------------------------------------------------------------------------
// Item card
// ---------------------------------------------------------------------------

const PILL = { w: 70, h: 22 } as const;

export function ItemCard({
  colour,
  item,
  owned,
  affordable,
  w,
  h,
  onPress,
}: {
  colour: StoreColour;
  item: StoreItem;
  owned: boolean;
  affordable: boolean;
  w: number;
  h: number;
  onPress: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const pop = useSharedValue(1);
  const wasOwned = useRef(owned);
  // The pill pops when this card is bought (not when a tab switch shows an owned one).
  useEffect(() => {
    if (owned && !wasOwned.current && !reduceMotion) {
      pop.value = withSequence(
        withTiming(1.22, { duration: 120 }),
        withSpring(1, { damping: 8, stiffness: 260 }),
      );
    }
    wasOwned.current = owned;
  }, [owned, pop, reduceMotion]);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const artH = h - PILL.h - 26;
  return (
    <PressableInk
      onPress={onPress}
      accessibilityLabel={`${COLOUR_NAME[colour]} ${item.name}, ${owned ? 'unlocked' : `${item.price} coins`}`}
    >
      <MenuCard
        w={w}
        h={h}
        fill={owned ? COLOUR_WASH[colour] : menuColor.card}
        seedKey={`store-card-${item.key}`}
        r={10}
      >
        <Image
          source={STORE_ITEM_ART[colour][item.key] ?? null}
          style={[styles.cardArt, { width: w - 14, height: artH }]}
          contentFit="contain"
          transition={160}
          cachePolicy="memory-disk"
        />
        <Text
          style={[styles.cardName, { top: artH + 4 }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          {item.name}
        </Text>
        <Animated.View
          style={[styles.pill, { left: (w - PILL.w) / 2, top: h - PILL.h - 4 - BASE }, popStyle]}
        >
          <MenuCard
            w={PILL.w}
            h={PILL.h}
            fill={owned ? storeColor.owned : storeColor.price}
            seedKey={owned ? 'store-pill-owned' : 'store-pill-price'}
            r={PILL.h}
          >
            <View style={styles.pillRow}>
              {owned ? (
                <Tick size={12} color={storeColor.ownedInk} />
              ) : (
                <Image source={MENU_ART.coin} style={styles.pillCoin} contentFit="contain" />
              )}
              <Text
                style={[
                  styles.pillText,
                  owned
                    ? { color: storeColor.ownedInk }
                    : affordable
                      ? null
                      : { color: storeColor.short },
                ]}
              >
                {owned ? 'Owned' : item.price}
              </Text>
            </View>
          </MenuCard>
        </Animated.View>
      </MenuCard>
    </PressableInk>
  );
}

// ---------------------------------------------------------------------------
// The coins leaving the pill
// ---------------------------------------------------------------------------

/** "−200" dropping out of the coin pill once the unlock dialog closes. Mount with a fresh key each time. */
export function SpendFloat({ amount, x, y }: { amount: number; x: number; y: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withTiming(1, { duration: 1100, easing: Easing.out(Easing.cubic) });
  }, [t]);
  const style = useAnimatedStyle(() => ({
    opacity: t.value < 0.15 ? t.value / 0.15 : 1 - Math.max(0, (t.value - 0.55) / 0.45),
    transform: [{ translateY: 22 * t.value }],
  }));
  return (
    <Animated.Text pointerEvents="none" style={[styles.spend, { left: x, top: y }, style]}>
      −{amount}
    </Animated.Text>
  );
}

// ---------------------------------------------------------------------------
// Unlock dialog
// ---------------------------------------------------------------------------

export type DialogMode = 'confirm' | 'short' | 'owned' | 'unlocked';

export interface DialogState {
  readonly colour: StoreColour;
  readonly item: StoreItem;
  readonly mode: DialogMode;
}

const D = { w: 400, h: 214 } as const;
const WELL = { x: 16, y: 18, w: 150, h: 128 } as const;

function DialogButton({
  label,
  w,
  fill,
  seedKey,
  onPress,
  coin = false,
}: {
  label: string;
  w: number;
  fill: string;
  seedKey: string;
  onPress: () => void;
  coin?: boolean;
}) {
  return (
    <PressableInk onPress={onPress} accessibilityLabel={label}>
      <MenuCard w={w} h={36} fill={fill} seedKey={seedKey} r={12}>
        <View style={styles.buttonRow}>
          {coin ? (
            <Image source={MENU_ART.coin} style={styles.buttonCoin} contentFit="contain" />
          ) : null}
          <Text style={styles.buttonLabel} numberOfLines={1}>
            {label}
          </Text>
        </View>
      </MenuCard>
    </PressableInk>
  );
}

/** The "UNLOCKED" stamp that thumps down onto the art. */
function Stamp() {
  const reduceMotion = useReducedMotion();
  const s = useSharedValue(reduceMotion ? 1 : 1.9);
  const o = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) return;
    s.value = withDelay(80, withSpring(1, { damping: 9, stiffness: 260 }));
    o.value = withDelay(80, withTiming(1, { duration: 120 }));
  }, [o, reduceMotion, s]);
  const style = useAnimatedStyle(() => ({
    opacity: o.value,
    transform: [{ rotate: '-11deg' }, { scale: s.value }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[styles.stamp, style]}>
      <MenuCard w={104} h={30} fill={storeColor.owned} seedKey="store-stamp" r={7}>
        <View style={styles.stampRow}>
          <Tick size={13} color={storeColor.ownedInk} />
          <Text style={styles.stampText}>UNLOCKED</Text>
        </View>
      </MenuCard>
    </Animated.View>
  );
}

export function UnlockDialog({
  visible,
  state,
  coins,
  onClose,
  onConfirm,
  onProfile,
}: {
  visible: boolean;
  state: DialogState | null;
  /** What can be spent now. */
  coins: number;
  onClose: () => void;
  onConfirm: () => void;
  onProfile: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const enter = useSharedValue(0);
  useEffect(() => {
    if (!visible) return;
    enter.value = 0;
    enter.value = reduceMotion ? 1 : withSpring(1, { damping: 15, stiffness: 210 });
  }, [enter, reduceMotion, visible]);
  const enterStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: 10 * (1 - enter.value) }, { scale: 0.93 + 0.07 * enter.value }],
  }));
  if (!state) return null;
  const { colour, item, mode } = state;
  const edition = `${COLOUR_NAME[colour]} edition`;
  const need = Math.max(0, item.price - coins);
  const title =
    mode === 'short' ? 'Not enough coins' : mode === 'unlocked' ? 'Unlocked!' : item.name;
  const body =
    mode === 'confirm'
      ? 'It joins your collection on your profile. Equipping colours comes in a later update.'
      : mode === 'short'
        ? `You need ${need} more coins. A win earns ${REWARD.win.coins}, a loss ${REWARD.loss.coins}.`
        : mode === 'owned'
          ? 'Already in your collection on your profile. Equipping colours comes in a later update.'
          : `The ${COLOUR_NAME[colour].toLowerCase()} ${item.name} is yours — see it in your collection on your profile.`;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.dim} accessibilityViewIsModal>
        <Scale transparent>
          <Animated.View style={[styles.dialog, enterStyle]}>
            <MenuCard w={D.w} h={D.h} fill={menuColor.card} seedKey="store-dialog" r={16}>
              <View style={styles.well}>
                <MenuCard
                  w={WELL.w}
                  h={WELL.h}
                  fill={COLOUR_WASH[colour]}
                  seedKey="store-dialog-well"
                  r={12}
                >
                  <Image
                    source={STORE_ITEM_ART[colour][item.key] ?? null}
                    style={styles.wellArt}
                    contentFit="contain"
                    cachePolicy="memory-disk"
                  />
                </MenuCard>
                {mode === 'unlocked' ? <Stamp /> : null}
              </View>
              <Text style={[styles.edition, { color: COLOUR_INK[colour] }]} numberOfLines={1}>
                {edition} · {SECTION_NAME[item.section]}
              </Text>

              <View style={styles.copy}>
                <Text style={[styles.kicker, { color: COLOUR_INK[colour] }]} numberOfLines={1}>
                  {mode === 'short' ? item.name : edition}
                </Text>
                <Text
                  style={styles.title}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.75}
                >
                  {title}
                </Text>
                <Text style={styles.body}>{body}</Text>
                {mode === 'owned' ? null : (
                  <View style={styles.balance}>
                    <Image source={MENU_ART.coin} style={styles.balanceCoin} contentFit="contain" />
                    <Text style={styles.balanceText}>
                      {mode === 'confirm'
                        ? coins - item.price
                        : mode === 'short'
                          ? `${coins} of ${item.price}`
                          : coins}
                    </Text>
                    <Text style={styles.balanceNote}>
                      {mode === 'confirm'
                        ? `left of ${coins} after unlocking`
                        : mode === 'short'
                          ? 'coins'
                          : 'coins left to spend'}
                    </Text>
                  </View>
                )}
              </View>

              <View style={styles.actions}>
                {mode === 'confirm' ? (
                  <>
                    <DialogButton
                      label="Not now"
                      w={96}
                      fill={storeColor.cancel}
                      seedKey="store-cancel"
                      onPress={onClose}
                    />
                    <DialogButton
                      label={`Unlock ${item.price}`}
                      w={118}
                      fill={storeColor.confirm}
                      seedKey="store-confirm"
                      coin
                      onPress={onConfirm}
                    />
                  </>
                ) : mode === 'short' ? (
                  <DialogButton
                    label="Got it"
                    w={110}
                    fill={storeColor.confirm}
                    seedKey="store-ok"
                    onPress={onClose}
                  />
                ) : (
                  <>
                    <DialogButton
                      label={mode === 'unlocked' ? 'Keep shopping' : 'Close'}
                      w={112}
                      fill={storeColor.cancel}
                      seedKey="store-close"
                      onPress={onClose}
                    />
                    <DialogButton
                      label="See profile"
                      w={102}
                      fill={storeColor.confirm}
                      seedKey="store-profile"
                      onPress={onProfile}
                    />
                  </>
                )}
              </View>
            </MenuCard>
          </Animated.View>
        </Scale>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  tabCount: {
    position: 'absolute',
    right: -3,
    top: -5,
    minWidth: 26,
    height: 14,
    paddingHorizontal: 4,
    borderRadius: 7,
    borderWidth: 1.2,
    borderColor: '#FFFDF6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabCountText: { color: '#FFFDF6', fontFamily: menuFont.capsBold, fontSize: 9, lineHeight: 11 },
  tabNotch: { position: 'absolute', bottom: -4 },
  headRow: {
    flex: 1,
    paddingBottom: BASE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  headLabel: {
    color: menuColor.navy,
    fontFamily: menuFont.capsBold,
    fontSize: 12,
    lineHeight: 15,
    letterSpacing: 1.2,
  },
  cardArt: { position: 'absolute', left: 7, top: 4 },
  cardName: {
    position: 'absolute',
    left: 4,
    right: 4,
    color: menuColor.navy,
    fontFamily: menuFont.caps,
    fontSize: 11,
    lineHeight: 14,
    textAlign: 'center',
  },
  pill: { position: 'absolute' },
  pillRow: {
    flex: 1,
    paddingBottom: BASE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  pillCoin: { width: 13, height: 13 },
  pillText: { color: menuColor.navy, fontFamily: menuFont.capsBold, fontSize: 12, lineHeight: 15 },
  spend: {
    position: 'absolute',
    color: storeColor.short,
    fontFamily: menuFont.capsBold,
    fontSize: 14,
  },
  dim: { flex: 1, backgroundColor: 'rgba(16,24,48,0.55)' },
  dialog: {
    position: 'absolute',
    left: (CANVAS_W - D.w) / 2,
    top: (CANVAS_H - D.h) / 2,
    width: D.w,
    height: D.h,
  },
  well: { position: 'absolute', left: WELL.x, top: WELL.y, width: WELL.w, height: WELL.h },
  wellArt: { position: 'absolute', left: 12, top: 10, width: WELL.w - 24, height: WELL.h - 26 },
  stamp: { position: 'absolute', left: (WELL.w - 104) / 2, top: WELL.h - 40 },
  stampRow: {
    flex: 1,
    paddingBottom: BASE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  stampText: {
    color: storeColor.ownedInk,
    fontFamily: menuFont.capsBold,
    fontSize: 13,
    letterSpacing: 1,
  },
  edition: {
    position: 'absolute',
    left: WELL.x - 4,
    width: WELL.w + 8,
    top: WELL.y + WELL.h + 6,
    fontFamily: menuFont.hand,
    fontSize: 14,
    lineHeight: 17,
    textAlign: 'center',
  },
  copy: { position: 'absolute', left: WELL.x + WELL.w + 16, right: 18, top: 16 },
  kicker: { fontFamily: menuFont.hand, fontSize: 15, lineHeight: 18 },
  title: { color: menuColor.navy, fontFamily: menuFont.capsBold, fontSize: 23, lineHeight: 28 },
  body: {
    color: menuColor.navy,
    fontFamily: menuFont.hand,
    fontSize: 14,
    lineHeight: 17,
    marginTop: 3,
  },
  balance: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 7 },
  balanceCoin: { width: 16, height: 16 },
  balanceText: {
    color: menuColor.navy,
    fontFamily: menuFont.capsBold,
    fontSize: 14,
    lineHeight: 17,
  },
  balanceNote: {
    color: menuColor.navy,
    fontFamily: menuFont.hand,
    fontSize: 13,
    lineHeight: 16,
    opacity: 0.75,
  },
  actions: {
    position: 'absolute',
    left: WELL.x + WELL.w + 16,
    right: 18,
    bottom: 14,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  buttonRow: {
    flex: 1,
    paddingBottom: BASE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  buttonCoin: { width: 15, height: 15 },
  buttonLabel: {
    color: menuColor.navy,
    fontFamily: menuFont.capsBold,
    fontSize: 13,
    lineHeight: 16,
  },
});
