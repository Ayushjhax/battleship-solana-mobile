/**
 * The battle's Attack deck — the parchment column down the left of the sheet
 * (DECK_ART, scripts/deck-assets.sh), one card per weapon that can be aimed
 * (catalog.ts WEAPON_ORDER: the four aircraft, the radar and the submarine).
 *
 * It replaces the Arsenal chest and its pop-over: the weapons are always in
 * view, so choosing one is a single tap instead of open-then-pick, and the
 * tutorial's "open the arsenal" beat became "here is your deck".
 *
 * Motion, all on the UI thread:
 *   - the deck slides in once, its cards staggered behind it;
 *   - a pick sends the weapon's icon arcing from its card to the enemy board
 *     (`DeckLaunch`), which is what makes the deck feel like it launches
 *     things rather than opening a menu;
 *   - a card that runs out pops its count.
 * Cards are pressable, so every animation on one is transform-only — a
 * native-stack reattachment must never leave an invisible-but-tappable card
 * behind (CLAUDE.md > design tokens).
 */
import type { ArsenalItem, ArsenalKind } from '@engine/types';
import { Image } from 'expo-image';
import { memo, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { haptic } from '@/audio/haptics';
import { BATTLE_BOARD_LEFT, BATTLE_BOARD_TOP, BOARD_SIZE, boardOrigins } from '@/board/layout';
import { CARD, DECK, cardCentre, cardOrigin } from './deckLayout';
import { ArsenalIcon } from '@/features/arsenal/ArsenalIcon';
import { CARD_NAMES, WEAPON_ORDER } from '@/features/arsenal/catalog';
import { remainingItems, type ArsenalTarget } from '@/features/arsenal/BattleArsenal';
import { useTutorialTarget } from '@/tutorial/useTutorialTarget';
import { DECK_ART } from '@/ui/assets';
import { artColor, font } from '@/ui/tokens';

const ORIGINS = boardOrigins(BATTLE_BOARD_TOP, BATTLE_BOARD_LEFT);
const TITLE = { w: 54, h: 54 * (43 / 203) } as const;

// ---------------------------------------------------------------------------
// One card
// ---------------------------------------------------------------------------

const WeaponCard = memo(function WeaponCard({
  kind,
  count,
  index,
  selected,
  enabled,
  entrance,
  onPress,
}: {
  kind: ArsenalKind;
  count: number;
  index: number;
  selected: boolean;
  enabled: boolean;
  /** 0 → 1 once, driving the staggered slide-in. */
  entrance: SharedValue<number>;
  onPress: () => void;
}) {
  // The tutorial spotlights and unlocks a card by `card-<kind>` (step 8, the Bomber).
  const target = useTutorialTarget(`card-${kind.toLowerCase()}`);
  const reduceMotion = useReducedMotion();
  const press = useSharedValue(1);
  const pop = useSharedValue(1);
  const live = enabled && count > 0;
  const previous = useRef(count);

  // The count pops when this weapon is spent, so a used one is noticed.
  useEffect(() => {
    if (count !== previous.current && !reduceMotion) {
      pop.value = withSequence(
        withTiming(1.35, { duration: 110 }),
        withSpring(1, { damping: 9, stiffness: 260 }),
      );
    }
    previous.current = count;
  }, [count, pop, reduceMotion]);

  const bodyStyle = useAnimatedStyle(() => {
    const slide = (1 - entrance.value) * -26;
    return { transform: [{ translateX: slide }, { scale: press.value }] };
  });
  const countStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  const { x, y } = cardOrigin(index);
  return (
    <View {...target} style={[styles.card, { left: x - DECK.x, top: y - DECK.y }]}>
      <Pressable
        onPress={onPress}
        onPressIn={() => {
          press.value = withTiming(0.94, { duration: 70 });
          haptic('buttonPress');
        }}
        onPressOut={() => {
          press.value = withSpring(1, { damping: 11, stiffness: 340 });
        }}
        disabled={!live}
        hitSlop={3}
        accessibilityRole="button"
        accessibilityState={{ disabled: !live, selected }}
        accessibilityLabel={`${CARD_NAMES[kind]}, ${count} left`}
        style={StyleSheet.absoluteFill}
      >
        <Animated.View style={[styles.cardBody, { opacity: live ? 1 : 0.45 }, bodyStyle]}>
          <Image
            source={selected ? DECK_ART.cardOn : DECK_ART.card}
            style={StyleSheet.absoluteFill}
            contentFit="fill"
            cachePolicy="memory-disk"
            transition={120}
          />
          <ArsenalIcon kind={kind} w={CARD.w - 24} h={19} style={styles.cardIcon} />
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            style={[styles.cardName, selected && styles.cardNameOn]}
          >
            {CARD_NAMES[kind]}
          </Text>
          <Animated.View style={[styles.count, countStyle]} pointerEvents="none">
            <Text style={styles.countText}>{count}</Text>
          </Animated.View>
        </Animated.View>
      </Pressable>
    </View>
  );
});

// ---------------------------------------------------------------------------
// The launch — a picked weapon arcing from its card to the enemy board
// ---------------------------------------------------------------------------

const LAUNCH_MS = 540;
const TARGET = {
  x: ORIGINS.enemy.x + BOARD_SIZE / 2,
  y: ORIGINS.enemy.y + BOARD_SIZE / 2,
} as const;

interface Launch {
  readonly key: number;
  readonly kind: ArsenalKind;
  readonly index: number;
}

/**
 * One icon flying from its card to the middle of the enemy board: a rising
 * arc, growing as it climbs and thinning out at the top of it. Never
 * touchable, so it is the one thing here that may animate opacity.
 */
function DeckLaunch({ kind, index }: { kind: ArsenalKind; index: number }) {
  const reduceMotion = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withTiming(1, {
      duration: reduceMotion ? 0 : LAUNCH_MS,
      easing: Easing.inOut(Easing.cubic),
    });
  }, [reduceMotion, t]);

  const { x: x0, y: y0 } = cardCentre(index);
  const style = useAnimatedStyle(() => {
    const p = t.value;
    // The arc: straight line from card to board, bowed upward at the middle.
    const lift = Math.sin(Math.PI * p) * 46;
    return {
      opacity: p < 0.12 ? p / 0.12 : p > 0.74 ? Math.max(0, (1 - p) / 0.26) : 1,
      transform: [
        { translateX: x0 + (TARGET.x - x0) * p },
        { translateY: y0 + (TARGET.y - y0) * p - lift },
        { scale: 0.8 + 0.7 * Math.sin(Math.PI * p) },
        { rotate: `${-10 + 20 * p}deg` },
      ],
    };
  });

  return (
    <Animated.View pointerEvents="none" style={[styles.launch, style]}>
      <ArsenalIcon kind={kind} w={46} h={30} />
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// The deck
// ---------------------------------------------------------------------------

export function AttackDeck({
  arsenal,
  canUse,
  selectedKind,
  onPick,
}: {
  arsenal: readonly ArsenalItem[];
  /** False off your turn, mid-animation, or while the fleet is covered. */
  canUse: boolean;
  /** The weapon being aimed right now, if any. */
  selectedKind: ArsenalKind | null;
  onPick: (target: ArsenalTarget) => void;
}) {
  const deckTarget = useTutorialTarget('arsenal-deck');
  const reduceMotion = useReducedMotion();
  const entrance = useSharedValue(reduceMotion ? 1 : 0);
  const [launch, setLaunch] = useState<Launch | null>(null);
  const launchKey = useRef(0);

  useEffect(() => {
    entrance.value = withDelay(
      120,
      withTiming(1, { duration: reduceMotion ? 0 : 420, easing: Easing.out(Easing.cubic) }),
    );
  }, [entrance, reduceMotion]);

  // The flight is a flourish, not a step: it cleans itself up and never
  // blocks the targeting overlay that opens underneath it.
  useEffect(() => {
    if (!launch) return;
    const timer = setTimeout(() => setLaunch(null), LAUNCH_MS + 60);
    return () => clearTimeout(timer);
  }, [launch]);

  const panelStyle = useAnimatedStyle(() => ({
    opacity: 0.25 + 0.75 * entrance.value,
    transform: [{ translateX: (1 - entrance.value) * -18 }],
  }));

  return (
    <>
      <View {...deckTarget} style={styles.deck} pointerEvents="box-none">
        <Animated.View style={[StyleSheet.absoluteFill, panelStyle]} pointerEvents="none">
          <Image
            source={DECK_ART.panel}
            style={StyleSheet.absoluteFill}
            contentFit="fill"
            cachePolicy="memory-disk"
          />
          <Image source={DECK_ART.title} style={styles.title} contentFit="contain" />
        </Animated.View>

        {WEAPON_ORDER.map((kind, index) => (
          <WeaponCard
            key={kind}
            kind={kind}
            index={index}
            count={remainingItems(arsenal, kind).length}
            selected={selectedKind === kind}
            enabled={canUse}
            entrance={entrance}
            onPress={() => {
              const item = remainingItems(arsenal, kind)[0];
              if (!item) return;
              launchKey.current += 1;
              setLaunch({ key: launchKey.current, kind, index });
              onPick({ itemId: item.id, kind });
            }}
          />
        ))}
      </View>
      {launch ? <DeckLaunch key={launch.key} kind={launch.kind} index={launch.index} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  deck: { position: 'absolute', left: DECK.x, top: DECK.y, width: DECK.w, height: DECK.h, zIndex: 40 },
  title: { position: 'absolute', left: (DECK.w - TITLE.w) / 2, top: 8, width: TITLE.w, height: TITLE.h },
  card: { position: 'absolute', width: CARD.w, height: CARD.h },
  cardBody: { width: CARD.w, height: CARD.h },
  cardIcon: { position: 'absolute', left: 12, top: 3 },
  cardName: {
    position: 'absolute',
    left: 4,
    right: 4,
    top: 23,
    color: artColor.navy,
    fontFamily: font.display,
    fontSize: 9.5,
    lineHeight: 12,
    textAlign: 'center',
  },
  cardNameOn: { color: artColor.green },
  count: {
    position: 'absolute',
    right: 3,
    top: 2,
    minWidth: 12,
    height: 11,
    paddingHorizontal: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: {
    color: artColor.soft,
    fontFamily: font.display,
    fontSize: 9,
    lineHeight: 11,
    fontVariant: ['tabular-nums'],
  },
  launch: { position: 'absolute', left: -23, top: -15, width: 46, height: 30, zIndex: 78 },
});
