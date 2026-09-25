/**
 * The placement Arsenal, in the fleet screen's art: a filled panel, a card
 * per item, and the item's rules in a modal (ArsenalInfoModal, drawn by the
 * placement screen over the board).
 *
 * All eight fit at once in three rows of three, split the way a player
 * needs to think about them (catalog.ts):
 *   Attack   Torpedo · Double Tap · Bomber / Atomic Bomb · Submarine · a
 *            note on how they are used
 *   Defence  AA Gun · Mine · Radar — each goes on your board as it is bought
 * Each group has its own header line saying exactly that, so a first-time
 * player can tell a purchase for later from one that is placed now.
 *
 * 3 * CARD_W + 2 * GAP + 2 * PAD = PANEL_W.
 */
import { specFor } from '@engine/arsenal';
import type { ArsenalKind } from '@engine/types';
import { Image } from 'expo-image';
import { memo, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Line, Polygon } from 'react-native-svg';

import { haptic } from '@/audio/haptics';
import { usePlacement } from '@/state/placement';
import { useTutorialTarget } from '@/tutorial/useTutorialTarget';
import { BATTLE_ART } from '@/ui/assets';
import { artColor, font } from '@/ui/tokens';
import { ArsenalIcon } from './ArsenalIcon';
import { ARSENAL_NAMES, CARD_NAMES, GROUP_COPY, SHOP_ORDER, type ArsenalGroup } from './catalog';

export { ARSENAL_NAMES } from './catalog';

export const SHOP_W = 400;
export const SHOP_H = 230;
const PAD = 12;
const GAP = 5;
const CARD_W = (SHOP_W - PAD * 2 - GAP * 2) / 3; // 122
const CARD_H = 50;
const TITLE_Y = 7;
const ATTACK_HEAD_Y = 34;
const ROW_1 = 47;
const ROW_2 = ROW_1 + CARD_H + 4;
const DEFENCE_HEAD_Y = ROW_2 + CARD_H + 4;
const ROW_3 = DEFENCE_HEAD_Y + 14;
/** How long a "not enough fuel" / "you have them all" notice replaces the title. */
const NOTICE_MS = 2200;

const SLOTS: readonly { kind: ArsenalKind | 'note'; x: number; y: number }[] = [
  ...SHOP_ORDER.slice(0, 3).map((kind, i) => ({ kind, x: PAD + i * (CARD_W + GAP), y: ROW_1 })),
  ...SHOP_ORDER.slice(3, 5).map((kind, i) => ({ kind, x: PAD + i * (CARD_W + GAP), y: ROW_2 })),
  { kind: 'note' as const, x: PAD + 2 * (CARD_W + GAP), y: ROW_2 },
  ...SHOP_ORDER.slice(5).map((kind, i) => ({ kind, x: PAD + i * (CARD_W + GAP), y: ROW_3 })),
];

/** A short line the panel shows in place of its title after a press that bought nothing. */
export interface ShopNotice {
  readonly text: string;
  readonly tone: 'red' | 'green';
}

/** "—◆ Arsenal ◆—": the title's pen flourishes. */
function Flourish({ flip }: { flip?: boolean }) {
  return (
    <Svg width={62} height={10} viewBox="0 0 62 10" style={flip ? styles.flip : undefined}>
      <Line x1={2} y1={5} x2={50} y2={5} stroke={artColor.navy} strokeWidth={1.3} strokeLinecap="round" />
      <Polygon points="50,5 55,1.5 60,5 55,8.5" fill={artColor.navy} />
    </Svg>
  );
}

function GroupHeader({ group, y }: { group: ArsenalGroup; y: number }) {
  const copy = GROUP_COPY[group];
  return (
    <View pointerEvents="none" style={[styles.header, { top: y }]}>
      <Image
        source={group === 'attack' ? BATTLE_ART.crossedWeapons : BATTLE_ART.rankBadge}
        style={group === 'attack' ? styles.headerSwords : styles.headerShield}
        contentFit="contain"
      />
      <Text style={[styles.headerTitle, group === 'attack' ? styles.red : styles.green]}>{copy.title}</Text>
      <Text style={styles.headerLine} numberOfLines={1}>
        {` · ${copy.line}`}
      </Text>
    </View>
  );
}

/** The count, with a small pop whenever it changes. */
function OwnedCount({ count, max }: { count: number; max: number }) {
  const reduceMotion = useReducedMotion();
  const pop = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) return;
    pop.value = withSequence(
      withTiming(1.25, { duration: 100, easing: Easing.out(Easing.cubic) }),
      withTiming(1, { duration: 160, easing: Easing.inOut(Easing.cubic) }),
    );
  }, [count, pop, reduceMotion]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  return (
    <Animated.View style={[styles.count, style]}>
      <Text style={[styles.countText, count >= max && styles.green]}>
        {count}/{max}
      </Text>
    </Animated.View>
  );
}

const ShopCard = memo(function ShopCard({
  kind,
  x,
  y,
  count,
  remaining,
  onInfo,
  onUnaffordable,
  onNotice,
}: {
  kind: ArsenalKind;
  x: number;
  y: number;
  count: number;
  remaining: number;
  onInfo: (kind: ArsenalKind) => void;
  onUnaffordable: () => void;
  onNotice: (notice: ShopNotice) => void;
}) {
  // Tutorial: lets the overlay spotlight and point at this card (`card-<kind>`).
  const tutorialTarget = useTutorialTarget(`card-${kind.toLowerCase()}`);
  const spec = specFor(kind);
  const atCap = count >= spec.max;
  const affordable = remaining >= spec.cost;
  const short = !atCap && !affordable;
  const label = ARSENAL_NAMES[kind];
  const press = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));

  // A press that cannot buy still answers: the gauge shakes for fuel, and the
  // title says why — a silent no-op reads as a broken button. The live store
  // is read, never the props: they are a render behind, so two taps inside one
  // frame both passed these guards. `buyArsenal` is the authority.
  const buy = () => {
    const state = usePlacement.getState();
    const owned = state.arsenal.filter((item) => item.kind === kind).length;
    const fuelLeft = state.fuelBudget - state.fuelSpent;
    if (owned >= spec.max) {
      onNotice({ text: `${label}: you have all ${spec.max}${spec.max === 1 ? '' : ' of them'}`, tone: 'green' });
      return;
    }
    if (fuelLeft < spec.cost) {
      onUnaffordable();
      onNotice({ text: `Not enough fuel — ${label} costs ${spec.cost}, you have ${fuelLeft}`, tone: 'red' });
      return;
    }
    const result = state.buyArsenal(kind);
    if (!result.ok && result.reason) onNotice({ text: result.reason, tone: 'red' });
  };

  return (
    <View {...tutorialTarget} style={[styles.card, { left: x, top: y }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          atCap ? `${label}, you have all ${spec.max}` : `${label}, ${count} of ${spec.max}, costs ${spec.cost} fuel`
        }
        onPress={buy}
        onPressIn={() => {
          press.value = withTiming(0.95, { duration: 70 });
          haptic('buttonPress');
        }}
        onPressOut={() => {
          press.value = withSpring(1, { damping: 11, stiffness: 360 });
        }}
        style={StyleSheet.absoluteFill}
      >
        <Animated.View style={[styles.cardBody, { opacity: short ? 0.45 : 1 }, pressStyle]}>
          <Image source={BATTLE_ART.arsenalCard} style={StyleSheet.absoluteFill} contentFit="fill" />
          <View style={styles.price}>
            <Text style={[styles.priceText, short && styles.red]}>{spec.cost}</Text>
            <Image source={BATTLE_ART.diamond} style={styles.diamond} contentFit="contain" />
          </View>
          <View style={styles.icon}>
            <ArsenalIcon kind={kind} w={46} h={25} />
          </View>
          <OwnedCount count={count} max={spec.max} />
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.name, atCap && styles.nameCapped]}>
            {CARD_NAMES[kind]}
          </Text>
          {atCap ? <Image source={BATTLE_ART.maxBadge} style={styles.max} contentFit="contain" /> : null}
        </Animated.View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`About ${label}`}
        hitSlop={9}
        onPress={() => onInfo(kind)}
        style={({ pressed }) => [styles.info, { transform: [{ scale: pressed ? 0.88 : 1 }] }]}
      >
        <Image source={BATTLE_ART.info} style={StyleSheet.absoluteFill} contentFit="contain" />
      </Pressable>
    </View>
  );
});

export interface ShopPanelProps {
  onUnaffordable: () => void;
  onInfo: (kind: ArsenalKind) => void;
}

export function ShopPanel({ onUnaffordable, onInfo }: ShopPanelProps) {
  const arsenal = usePlacement((state) => state.arsenal);
  const fuelSpent = usePlacement((state) => state.fuelSpent);
  const fuelBudget = usePlacement((state) => state.fuelBudget);
  const pendingArsenalId = usePlacement((state) => state.pendingArsenalId);
  const [notice, setNotice] = useState<ShopNotice | null>(null);
  const remaining = fuelBudget - fuelSpent;

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <View style={styles.panel}>
      <Image source={BATTLE_ART.arsenalPanel} style={StyleSheet.absoluteFill} contentFit="fill" cachePolicy="memory-disk" />
      {notice ? (
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.notice, notice.tone === 'green' ? styles.green : styles.red]}>
          {notice.text}
        </Text>
      ) : (
        <View style={styles.titleRow} pointerEvents="none">
          <Flourish />
          <Text style={styles.title} accessibilityRole="header">
            Arsenal
          </Text>
          <Flourish flip />
        </View>
      )}
      <View pointerEvents={pendingArsenalId ? 'none' : 'box-none'} style={[StyleSheet.absoluteFill, { opacity: pendingArsenalId ? 0.3 : 1 }]}>
        <GroupHeader group="attack" y={ATTACK_HEAD_Y} />
        <GroupHeader group="defence" y={DEFENCE_HEAD_Y} />
        {SLOTS.map((slot) =>
          slot.kind === 'note' ? (
            <View key="note" pointerEvents="none" style={[styles.note, { left: slot.x, top: slot.y }]}>
              <Text style={styles.noteText}>In battle, tap Arsenal, pick one and aim it.</Text>
            </View>
          ) : (
            <ShopCard
              key={slot.kind}
              kind={slot.kind}
              x={slot.x}
              y={slot.y}
              count={arsenal.filter((item) => item.kind === slot.kind).length}
              remaining={remaining}
              onInfo={onInfo}
              onUnaffordable={onUnaffordable}
              onNotice={setNotice}
            />
          ),
        )}
      </View>
      {pendingArsenalId ? (
        <View pointerEvents="none" style={styles.pending}>
          <Image source={BATTLE_ART.weaponRow} style={StyleSheet.absoluteFill} contentFit="fill" />
          <Text style={styles.pendingText}>Now tap an open cell on your board</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { width: SHOP_W, height: SHOP_H },
  flip: { transform: [{ scaleX: -1 }] },
  titleRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: TITLE_Y,
    height: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  title: { color: artColor.red, fontFamily: font.display, fontSize: 21, lineHeight: 26 },
  notice: {
    position: 'absolute',
    left: 18,
    right: 18,
    top: TITLE_Y,
    height: 26,
    lineHeight: 26,
    fontFamily: font.label,
    fontSize: 13,
    textAlign: 'center',
  },
  header: {
    position: 'absolute',
    left: PAD + 2,
    right: PAD,
    height: 13,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerSwords: { width: 9, height: 12, marginRight: 4 },
  headerShield: { width: 10, height: 12, marginRight: 4 },
  headerTitle: { fontFamily: font.display, fontSize: 12, lineHeight: 13 },
  headerLine: { color: artColor.soft, fontFamily: font.label, fontSize: 11, lineHeight: 13, flexShrink: 1 },
  red: { color: artColor.red },
  green: { color: artColor.green },
  card: { position: 'absolute', width: CARD_W, height: CARD_H },
  cardBody: { width: CARD_W, height: CARD_H },
  info: { position: 'absolute', left: 5, top: 4, width: 17, height: 17, zIndex: 4 },
  price: { position: 'absolute', right: 7, top: 3, flexDirection: 'row', alignItems: 'center', gap: 2 },
  priceText: { color: artColor.navy, fontFamily: font.display, fontSize: 14, fontVariant: ['tabular-nums'] },
  diamond: { width: 8, height: 12 },
  icon: { position: 'absolute', left: (CARD_W - 46) / 2, top: 4, width: 46, height: 25 },
  count: { position: 'absolute', left: 8, bottom: 4 },
  countText: { color: artColor.navy, fontFamily: font.label, fontSize: 12, fontVariant: ['tabular-nums'] },
  name: {
    position: 'absolute',
    left: 32,
    right: 8,
    bottom: 3,
    color: artColor.navy,
    fontFamily: font.display,
    fontSize: 13,
    textAlign: 'center',
  },
  nameCapped: { right: 34 },
  max: { position: 'absolute', right: 3, bottom: 2, width: 31, height: 22 },
  note: { position: 'absolute', width: CARD_W, height: CARD_H, justifyContent: 'center', paddingHorizontal: 8 },
  noteText: { color: artColor.soft, fontFamily: font.body, fontSize: 11, lineHeight: 14, textAlign: 'center' },
  pending: {
    position: 'absolute',
    left: 50,
    right: 50,
    top: ROW_2 + 6,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingText: { color: artColor.green, fontFamily: font.display, fontSize: 14 },
});
