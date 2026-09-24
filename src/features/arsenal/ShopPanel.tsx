import { ARSENAL_SPEC, specFor } from '@engine/arsenal';
import { captainFuel } from '@engine/captains';
import type { ArsenalKind } from '@engine/types';
import { Image } from 'expo-image';
import { memo, useEffect, useMemo, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Line } from 'react-native-svg';

import { arsenalGlyphPaths } from '@/board/art';
import { usePlacement } from '@/state/placement';
import { InkButton } from '@/ui/InkButton';
import { InkPanel } from '@/ui/InkPanel';
import { ARSENAL, type Asset } from '@/ui/assets';
import { CARD_H, CARD_W, GRID_GAP, GRID_PAD, PANEL_H, PANEL_W } from './shopGrid';
import { color, font, space, type as typeScale } from '@/ui/tokens';
import { RoughShape, hashString, useRough, type PathInfo } from '@/ui/useRough';
import { useTutorialTarget } from '@/tutorial/useTutorialTarget';

/**
 * Three columns of cards, sized so all eight fit the panel at once.
 *
 * Two 189-wide columns needed ~270px of height for eight cards, so the grid
 * scrolled and half the arsenal was out of sight — you had to know to swipe to
 * find the submarine. 3 x 189 does not fit the width, so the cards narrow and
 * the fourth row disappears: no scroll view at all.
 *
 * PART 5 widened this from 3 columns to 4. The Naval Academy adds three more
 * kinds (11 in total), which does not fit 3 x 3 = 9 — and a shop that
 * overflows is the exact bug tests/regression/home-and-hud-fixes.test.ts was
 * written to stop ("arsenal scrolls"). 4 x 3 = 12 holds every kind with one
 * slot spare, and still fits the panel:
 *
 *   GRID_COLUMNS * CARD_W + (GRID_COLUMNS - 1) * GRID_GAP + 2 * GRID_PAD <= PANEL_W
 */
// The grid arithmetic lives in ./shopGrid so the regression test can assert
// it without importing this component (no React renderer under vitest).
/** How long a "not enough fuel" / "you have them all" notice replaces the title. */
const NOTICE_MS = 2200;

export const ARSENAL_NAMES: Record<ArsenalKind, string> = {
  torpedoBomber: 'Torpedo Bomber',
  doubleTorpedoBomber: 'Double Torpedo Bomber',
  bomber: 'Bomber',
  atomicBomber: 'Atomic Bomber',
  aaGun: 'AA Gun',
  radar: 'Radar',
  mine: 'Mine',
  submarine: 'Submarine',
  // Part 5 — the Naval Academy's three.
  sonar_net: 'Sonar Net',
  decoy: 'Decoy Buoy',
  minesweeper: 'Minesweeper',
};

const INFO: Record<ArsenalKind, string> = {
  torpedoBomber: 'Runs along one row and hits the first intact ship cell.',
  doubleTorpedoBomber: 'Runs two torpedoes along adjacent rows.',
  bomber: 'Bombs the target, the cell right of it, and the cell below it.',
  atomicBomber: 'Destroys every cell in a 3x3 area.',
  aaGun: 'Shoots down any enemy aircraft flying through its row.',
  mine: "The enemy's turn ends the moment they hit it.",
  radar: 'Reports how many ship cells sit in a 3x3 area. Not which ones.',
  submarine: 'Surfaces on a free cell and fires one torpedo up and one down.',
  sonar_net: 'Guards its whole column. Any enemy submarine surfacing there is lost.',
  decoy: 'Reads as a hit and is not there. Place it where a ship could sit.',
  minesweeper: 'Sweeps two rows and disarms their mines. It never ends your turn.',
};

function diagramCells(kind: ArsenalKind): readonly [number, number][] {
  switch (kind) {
    // Part 5. The net guards a column, so its diagram is a column; the
    // minesweeper sweeps two rows; the decoy is a single cell, like a mine.
    case 'sonar_net':
      return [
        [0, 2],
        [1, 2],
        [2, 2],
        [3, 2],
        [4, 2],
      ];
    case 'minesweeper':
      return [
        [2, 0],
        [2, 1],
        [2, 2],
        [2, 3],
        [2, 4],
        [3, 0],
        [3, 1],
        [3, 2],
        [3, 3],
        [3, 4],
      ];
    case 'decoy':
      return [[2, 2]];
    case 'torpedoBomber':
      return [
        [2, 0],
        [2, 1],
        [2, 2],
        [2, 3],
        [2, 4],
      ];
    case 'doubleTorpedoBomber':
      return [
        [1, 0],
        [1, 1],
        [1, 2],
        [1, 3],
        [1, 4],
        [3, 0],
        [3, 1],
        [3, 2],
        [3, 3],
        [3, 4],
      ];
    case 'bomber':
      return [
        [2, 2],
        [2, 3],
        [3, 2],
      ];
    case 'atomicBomber':
    case 'radar':
      return [
        [1, 1],
        [1, 2],
        [1, 3],
        [2, 1],
        [2, 2],
        [2, 3],
        [3, 1],
        [3, 2],
        [3, 3],
      ];
    case 'aaGun':
      return [
        [2, 0],
        [2, 1],
        [2, 2],
        [2, 3],
        [2, 4],
      ];
    case 'mine':
      return [[2, 2]];
    case 'submarine':
      return [
        [0, 2],
        [1, 2],
        [2, 2],
        [3, 2],
        [4, 2],
      ];
  }
}

function FuelDrop({ tint = color.ink }: { tint?: string }) {
  const { roughPolygon } = useRough();
  const paths = roughPolygon(
    [
      [6, 1],
      [1.5, 10],
      [6, 14],
      [10.5, 10],
    ],
    {
      seed: hashString(`shop-fuel-${tint}`),
      stroke: tint,
      strokeWidth: 1,
      fill: tint,
      fillStyle: 'solid',
    },
  );
  return (
    <Svg width={12} height={16} viewBox="0 0 12 16">
      <RoughShape paths={paths} />
    </Svg>
  );
}

function InfoButton({ onPress, label }: { onPress: () => void; label: string }) {
  const { roughCircle } = useRough();
  const circle = roughCircle(11, 11, 18, {
    seed: hashString(`arsenal-info-${label}`),
    stroke: color.inkRed,
    strokeWidth: 1.4,
  });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`About ${label}`}
      hitSlop={9}
      onPress={onPress}
      style={({ pressed }) => [styles.infoButton, { transform: [{ translateY: pressed ? 1 : 0 }] }]}
    >
      <Svg width={22} height={22} viewBox="0 0 22 22" style={StyleSheet.absoluteFill}>
        <RoughShape paths={circle} />
      </Svg>
      <Text style={styles.infoLetter}>i</Text>
    </Pressable>
  );
}

export function ArsenalInkSprite({ kind }: { kind: ArsenalKind }) {
  const { roughCircle, roughLine, roughPolygon, roughRect } = useRough();
  const seed = hashString(`arsenal-card-art-${kind}`);
  const defensive = kind === 'aaGun' || kind === 'mine' || kind === 'radar';
  // Part 5's three have no line art yet: an undefined source falls through
  // to the procedural ink below, which is exactly what AssetSlot does too.
  const source = (ARSENAL as Partial<Record<ArsenalKind, Asset>>)[kind];
  if (source) {
    return (
      <Image
        source={source}
        style={{ width: defensive ? 42 : 62, height: defensive ? 42 : 44 }}
        contentFit="contain"
        tintColor={color.ink}
        cachePolicy="memory-disk"
      />
    );
  }
  if (defensive) {
    const layers = arsenalGlyphPaths(kind, seed, color.ink);
    return (
      <Svg width={42} height={42} viewBox="-5 -5 42 42">
        {layers.map((paths, index) => (
          <RoughShape key={index} paths={paths} />
        ))}
      </Svg>
    );
  }
  if (kind === 'submarine') {
    const hull = roughPolygon(
      [
        [3, 23],
        [10, 15],
        [48, 15],
        [56, 22],
        [48, 29],
        [10, 29],
      ],
      {
        seed,
        stroke: color.ink,
        strokeWidth: 1.4,
        fill: color.ink,
        fillStyle: 'hachure',
        hachureGap: 2.5,
      },
    );
    const tower = roughRect(31, 9, 10, 8, { seed: seed + 1, stroke: color.ink, strokeWidth: 1.2 });
    return (
      <Svg width={60} height={42} viewBox="0 0 60 42">
        <RoughShape paths={hull} />
        <RoughShape paths={tower} />
      </Svg>
    );
  }

  const plane = roughPolygon(
    [
      [3, 22],
      [22, 18],
      [32, 4],
      [38, 5],
      [35, 18],
      [56, 20],
      [58, 24],
      [35, 26],
      [38, 38],
      [32, 39],
      [22, 27],
      [3, 25],
    ],
    {
      seed,
      stroke: color.ink,
      strokeWidth: 1.3,
      fill: color.ink,
      fillStyle: 'hachure',
      hachureGap: 2.7,
    },
  );
  const ordnance: (readonly PathInfo[])[] = [];
  if (kind === 'torpedoBomber' || kind === 'doubleTorpedoBomber') {
    ordnance.push(
      roughLine(17, 34, 44, 34, { seed: seed + 1, stroke: color.inkRed, strokeWidth: 2 }),
    );
    if (kind === 'doubleTorpedoBomber') {
      ordnance.push(
        roughLine(22, 39, 49, 39, { seed: seed + 2, stroke: color.inkRed, strokeWidth: 2 }),
      );
    }
  } else {
    const count = kind === 'atomicBomber' ? 1 : 3;
    for (let i = 0; i < count; i++) {
      ordnance.push(
        roughCircle(25 + i * 8, 36, kind === 'atomicBomber' ? 9 : 4, {
          seed: seed + 1 + i,
          stroke: color.inkRed,
          strokeWidth: 1,
        }),
      );
    }
  }
  return (
    <Svg width={62} height={44} viewBox="0 0 62 44">
      <RoughShape paths={plane} />
      {ordnance.map((paths, index) => (
        <RoughShape key={index} paths={paths} />
      ))}
    </Svg>
  );
}

function OwnedCount({ count, max, atCap }: { count: number; max: number; atCap: boolean }) {
  const reduceMotion = useReducedMotion();
  const pop = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) return;
    pop.value = withSequence(
      withTiming(1.2, { duration: 100, easing: Easing.out(Easing.cubic) }),
      withTiming(1, { duration: 150, easing: Easing.inOut(Easing.cubic) }),
    );
  }, [count, pop, reduceMotion]);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  return (
    <Animated.View style={[styles.countBox, animated]}>
      <Text style={[styles.count, atCap && styles.countAtCap]}>
        {count}/{max}
      </Text>
    </Animated.View>
  );
}

/** A short line the panel shows in place of its title after a press that bought nothing. */
export interface ShopNotice {
  readonly text: string;
  readonly tone: 'red' | 'green';
}

/** The "Max" tag stamped on a card whose slot is full. */
function MaxTag({ kind }: { kind: ArsenalKind }) {
  const { roughRect } = useRough();
  const frame = roughRect(1, 1, 34, 16, {
    seed: hashString(`arsenal-max-${kind}`),
    stroke: color.inkGreen,
    strokeWidth: 1.1,
    fill: color.paper,
    fillStyle: 'solid',
    roughness: 0.9,
  });
  return (
    <View pointerEvents="none" style={styles.maxTag}>
      <Svg width={36} height={18} viewBox="0 0 36 18" style={StyleSheet.absoluteFill}>
        <RoughShape paths={frame} />
      </Svg>
      <Text style={styles.maxTagText}>Max</Text>
    </View>
  );
}

function ShopCard({
  kind,
  count,
  remaining,
  onInfo,
  onUnaffordable,
  onNotice,
}: {
  kind: ArsenalKind;
  count: number;
  remaining: number;
  onInfo: (kind: ArsenalKind) => void;
  onUnaffordable: () => void;
  onNotice: (notice: ShopNotice) => void;
}) {
  const [pressed, setPressed] = useState(false);
  // Tutorial: lets the overlay spotlight and point at this card (`card-<kind>`).
  const tutorialTarget = useTutorialTarget(`card-${kind.toLowerCase()}`);
  const spec = specFor(kind);
  /**
   * Part 7 §2.2 — a harbour's cap comes from Coastal Command and is NOT
   * `spec.max`: at level 6 a harbour holds 8 mines where a match allows 5.
   * `kindCaps` is null in a match, so this is `spec.max` there, unchanged.
   */
  const capOverride = usePlacement((state) => state.kindCaps?.[kind]);
  const cap = capOverride ?? spec.max;
  const atCap = count >= cap;
  const affordable = remaining >= spec.cost;
  const disabledByFuel = !atCap && !affordable;
  const label = ARSENAL_NAMES[kind];

  // A press that cannot buy still answers: the gauge shakes for fuel, and the
  // title says why — a silent no-op reads as a broken button.
  // Read the live store, never the props: `count` and `remaining` are a render
  // behind, so two taps inside one frame both passed these guards and both
  // bought. The store rejects the second, but the notices below would have lied
  // about why. `buyArsenal` itself is the authority on whether it happened.
  const buy = () => {
    const state = usePlacement.getState();
    const owned = state.arsenal.filter((item) => item.kind === kind).length;
    // Part 10A — the captain is fuel too: the shop budgets around it.
    const fuelLeft = state.fuelBudget - state.fuelSpent - captainFuel(state.captainId);

    const liveCap = state.kindCaps?.[kind] ?? spec.max;
    if (owned >= liveCap) {
      onNotice({
        text: `${label}: you have all ${liveCap}${liveCap === 1 ? '' : ' of them'}`,
        tone: 'green',
      });
      return;
    }
    if (fuelLeft < spec.cost) {
      onUnaffordable();
      onNotice({
        text: `Not enough fuel — ${label} costs ${spec.cost}, you have ${fuelLeft}`,
        tone: 'red',
      });
      return;
    }

    const result = state.buyArsenal(kind);
    if (!result.ok && result.reason) {
      onNotice({ text: result.reason, tone: 'red' });
    }
  };

  return (
    <View
      {...tutorialTarget}
      style={{
        opacity: disabledByFuel ? 0.45 : 1,
        transform: [{ translateY: pressed ? 1 : 0 }],
      }}
    >
      <InkPanel w={CARD_W} h={CARD_H} seedKey={`arsenal-${kind}`} padding={0}>
        <View style={styles.price}>
          <Text style={[styles.priceText, disabledByFuel && styles.priceUnaffordable]}>
            {spec.cost}
          </Text>
          <FuelDrop tint={disabledByFuel ? color.inkRed : color.ink} />
        </View>
        <View pointerEvents="none" style={styles.sprite}>
          <ArsenalInkSprite kind={kind} />
        </View>
        <OwnedCount count={count} max={cap} atCap={atCap} />
        {atCap ? <MaxTag kind={kind} /> : null}
        <Text
          pointerEvents="none"
          numberOfLines={1}
          style={[styles.cardName, atCap && styles.cardNameCapped]}
        >
          {label}
        </Text>
      </InkPanel>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          atCap
            ? `${label}, you have all ${cap}`
            : `${label}, ${count} of ${cap}, costs ${spec.cost} fuel`
        }
        onPress={buy}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        style={StyleSheet.absoluteFill}
      />
      <InfoButton label={label} onPress={() => onInfo(kind)} />
    </View>
  );
}

function EffectDiagram({ kind }: { kind: ArsenalKind }) {
  const { roughRect } = useRough();
  const cells = useMemo(() => new Set(diagramCells(kind).map(([r, c]) => `${r},${c}`)), [kind]);
  return (
    <Svg width={100} height={100} viewBox="0 0 100 100">
      {Array.from({ length: 6 }, (_, index) => (
        <Line
          key={`v-${index}`}
          x1={index * 20}
          y1={0}
          x2={index * 20}
          y2={100}
          stroke={color.gridMajor}
          strokeWidth={0.8}
        />
      ))}
      {Array.from({ length: 6 }, (_, index) => (
        <Line
          key={`h-${index}`}
          x1={0}
          y1={index * 20}
          x2={100}
          y2={index * 20}
          stroke={color.gridMajor}
          strokeWidth={0.8}
        />
      ))}
      {Array.from(cells).map((key) => {
        const [r, c] = key.split(',').map(Number) as [number, number];
        return (
          <RoughShape
            key={key}
            paths={roughRect(c * 20 + 2, r * 20 + 2, 16, 16, {
              seed: hashString(`effect-${kind}-${key}`),
              stroke: kind === 'mine' ? color.inkRed : color.inkSoft,
              strokeWidth: 0.8,
              fill: kind === 'mine' ? color.inkRed : color.inkSoft,
              fillStyle: 'hachure',
              hachureGap: 2.4,
            })}
            opacity={0.7}
          />
        );
      })}
    </Svg>
  );
}

function InfoPopover({ kind, onClose }: { kind: ArsenalKind; onClose: () => void }) {
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose]);

  return (
    <View style={styles.popover}>
      <InkPanel w={290} h={196} seedKey={`arsenal-info-${kind}`} padding={space.sm}>
        <Text style={styles.popoverTitle}>{ARSENAL_NAMES[kind]}</Text>
        <View style={styles.diagram}>
          <EffectDiagram kind={kind} />
        </View>
        <Text style={styles.rulesCopy}>{INFO[kind]}</Text>
        <View style={styles.closeButton}>
          <InkButton label="Close" size="sm" w={88} h={40} onPress={onClose} />
        </View>
      </InkPanel>
    </View>
  );
}

export interface ShopPanelProps {
  onUnaffordable: () => void;
}

export function ShopPanel({ onUnaffordable }: ShopPanelProps) {
  const arsenal = usePlacement((state) => state.arsenal);
  const fuelSpent = usePlacement((state) => state.fuelSpent);
  const fuelBudget = usePlacement((state) => state.fuelBudget);
  const captainId = usePlacement((state) => state.captainId);
  const allowedKinds = usePlacement((state) => state.allowedKinds);
  const fuelLabel = usePlacement((state) => state.fuelLabel);
  const pendingArsenalId = usePlacement((state) => state.pendingArsenalId);
  /**
   * Part 7 §2.2 — "the shop only offers own-board items". `allowedKinds` is
   * null in a match, so this is the whole ARSENAL_SPEC there, unchanged.
   */
  const stocked = useMemo(
    () => (allowedKinds ? ARSENAL_SPEC.filter((s) => allowedKinds.includes(s.kind)) : ARSENAL_SPEC),
    [allowedKinds],
  );
  const [infoKind, setInfoKind] = useState<ArsenalKind | null>(null);
  const [notice, setNotice] = useState<ShopNotice | null>(null);
  const remaining = fuelBudget - fuelSpent - captainFuel(captainId);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <View style={{ width: PANEL_W, height: PANEL_H }}>
      {notice ? (
        <Text
          numberOfLines={1}
          style={[styles.notice, notice.tone === 'green' ? styles.noticeGreen : styles.noticeRed]}
        >
          {notice.text}
        </Text>
      ) : (
        <Text style={styles.title}>{allowedKinds ? 'Defences' : 'Arsenal'}</Text>
      )}
      <Animated.View
        pointerEvents={pendingArsenalId ? 'none' : 'auto'}
        style={[styles.scroller, { opacity: pendingArsenalId ? 0.32 : 1 }]}
      >
        <View style={styles.grid}>
          {stocked.map((spec) => (
            <ShopCard
              key={spec.kind}
              kind={spec.kind}
              count={arsenal.filter((item) => item.kind === spec.kind).length}
              remaining={remaining}
              onInfo={setInfoKind}
              onUnaffordable={onUnaffordable}
              onNotice={setNotice}
            />
          ))}
        </View>
      </Animated.View>
      {pendingArsenalId ? (
        <Text style={styles.pendingCopy}>Choose an open cell on your board.</Text>
      ) : null}
      {infoKind ? <InfoPopover kind={infoKind} onClose={() => setInfoKind(null)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    color: color.inkRed,
    fontFamily: font.display,
    fontSize: typeScale.md,
    textAlign: 'center',
    height: 28,
  },
  notice: {
    height: 28,
    lineHeight: 26,
    paddingHorizontal: 8,
    fontFamily: font.label,
    fontSize: typeScale.xs,
    textAlign: 'center',
  },
  noticeRed: { color: color.inkRed },
  noticeGreen: { color: color.inkGreen },
  scroller: { height: PANEL_H - 30 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
    paddingHorizontal: GRID_PAD,
    paddingBottom: 7,
  },
  maxTag: {
    position: 'absolute',
    right: 4,
    bottom: 3,
    width: 36,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-6deg' }],
  },
  maxTagText: {
    color: color.inkGreen,
    fontFamily: font.label,
    fontSize: typeScale.xxs,
    lineHeight: 14,
  },
  infoButton: {
    position: 'absolute',
    left: 5,
    top: 4,
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 4,
  },
  infoLetter: {
    color: color.inkRed,
    fontFamily: font.display,
    fontSize: typeScale.sm,
    lineHeight: 20,
  },
  price: {
    position: 'absolute',
    right: 7,
    top: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  priceText: {
    color: color.ink,
    fontFamily: font.display,
    fontSize: typeScale.sm,
    fontVariant: ['tabular-nums'],
  },
  priceUnaffordable: { color: color.inkRed },
  sprite: {
    position: 'absolute',
    left: (CARD_W - 62) / 2,
    top: -4,
    width: 62,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ scale: 0.78 }],
  },
  countBox: { position: 'absolute', left: 9, bottom: 5 },
  count: {
    color: color.ink,
    fontFamily: font.label,
    fontSize: typeScale.xs,
    fontVariant: ['tabular-nums'],
  },
  countAtCap: { color: color.inkGreen },
  cardName: {
    position: 'absolute',
    left: 32,
    right: 8,
    bottom: 5,
    color: color.ink,
    fontFamily: font.label,
    fontSize: typeScale.sm,
    textAlign: 'center',
  },
  cardNameCapped: { right: 42 },
  pendingCopy: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 101,
    color: color.inkGreen,
    fontFamily: font.label,
    fontSize: typeScale.sm,
    textAlign: 'center',
  },
  popover: { position: 'absolute', left: -312, top: 3, width: 290, height: 196, zIndex: 80 },
  popoverTitle: {
    color: color.inkRed,
    fontFamily: font.display,
    fontSize: typeScale.md,
    textAlign: 'center',
  },
  diagram: { position: 'absolute', left: 18, top: 46 },
  rulesCopy: {
    position: 'absolute',
    left: 132,
    right: 18,
    top: 53,
    color: color.ink,
    fontFamily: font.body,
    fontSize: typeScale.xs,
    lineHeight: 18,
  },
  closeButton: { position: 'absolute', right: 15, bottom: 12 },
});
