/**
 * One plot on the harbour — part-02 §3.
 *
 * The plot is a child of the map's Animated.View, positioned in MAP units, so
 * it inherits the pinch/pan transform for free. Nothing here reads the gesture.
 *
 * The one exception is the tap target. A fixed map-unit box SHRINKS on screen
 * as the player zooms out, and at the minimum zoom a 120x80 plot is under §10's
 * 32 dp floor on its short axis. So the invisible pressable — and only the
 * pressable — is counter-scaled by 1/zoom, through one useAnimatedStyle reading
 * the shared value the screen already owns.
 */
import { CITY_CATALOGUE, type BuildingId } from '@engine/city';
import { memo, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg from 'react-native-svg';

import { COIN_GOLD } from '@/ui/CurrencyChip';
import { TitleRibbon } from '@/ui/TitleRibbon';
import { color, font, type as typeScale } from '@/ui/tokens';
import { RoughShape, hashString, useRough } from '@/ui/useRough';
import { ShipSprite } from '@/board/ShipSprite';
import { BuildingDrawing } from './BuildingDrawing';
import { nibAt, buildingArt } from './buildingArt';
import { PLOT_H, PLOT_W, plotOrigin, type Plot as PlotSpec } from './plots';
import { plotLabel, tierForLevel, type PlotView } from './plotState';

/** §10: a tap target is never smaller than this in canvas units. */
const MIN_HIT_CANVAS = 32;

export interface PlotProps {
  readonly spec: PlotSpec;
  readonly view: PlotView;
  /** The map's live zoom, for counter-scaling the hit area only. */
  readonly zoom: SharedValue<number>;
  readonly onOpen: (id: BuildingId) => void;
  readonly onCollect: (id: BuildingId) => void;
  /** True once this level's completion has already been celebrated (§4). */
  readonly celebrated: boolean;
  readonly onCelebrated: (key: string) => void;
}

function Ribbon({ text, tone }: { text: string; tone: 'ink' | 'green' | 'grey' }) {
  return (
    <View style={styles.ribbon} pointerEvents="none">
      <TitleRibbon title={text} w={Math.max(84, text.length * 7 + 44)} h={20} size="sm" seedKey={`plot-${text}`} />
      {tone === 'green' ? <View style={styles.ribbonTintGreen} pointerEvents="none" /> : null}
    </View>
  );
}

/** Level pips: one small inked tick per level, on a short rule. */
const LevelPips = memo(function LevelPips({ level, max }: { level: number; max: number }) {
  const { roughLine } = useRough();
  if (level <= 0) return null;
  const pips = [];
  for (let i = 0; i < Math.min(level, max); i++) {
    pips.push(
      <RoughShape
        key={i}
        paths={roughLine(i * 6 + 2, 8, i * 6 + 2, 1, {
          seed: hashString(`pip-${i}`),
          strokeWidth: 1.4,
          stroke: level >= max ? COIN_GOLD : color.ink,
        })}
      />,
    );
  }
  return (
    <View style={styles.pips} pointerEvents="none">
      <Svg width={Math.min(level, max) * 6 + 4} height={10}>{pips}</Svg>
    </View>
  );
});

/** The pen nib that sits at the current stroke end while a job runs (§4). */
function PenNib({ view }: { view: PlotView }) {
  const reduceMotion = useReducedMotion();
  const art = buildingArt(view.id, tierForLevel(Math.max(1, view.toLevel ?? 1)));
  const at = nibAt(art, view.progress);
  if (reduceMotion || !at) return null;
  return (
    <View style={[styles.nib, { left: at.x * PLOT_W - 3, top: at.y * PLOT_H - 9 }]} pointerEvents="none">
      <Text style={styles.nibGlyph}>✒</Text>
    </View>
  );
}

/** The bobbing coin/steel bubble on a ready plot (§3, §6). */
function CollectBubble({ view }: { view: PlotView }) {
  const reduceMotion = useReducedMotion();
  const bob = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    bob.value = withRepeat(
      withSequence(
        withTiming(-3, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [bob, reduceMotion]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: bob.value }] }));

  const { roughCircle } = useRough();
  const glyph = view.collectResource === 'steel' ? '▤' : '◎';
  return (
    <Animated.View style={[styles.bubble, style]} pointerEvents="none">
      <Svg width={26} height={26}>
        <RoughShape
          paths={roughCircle(13, 13, 22, {
            seed: hashString(`bubble-${view.id}`),
            strokeWidth: 1.3,
            stroke: view.collectResource === 'steel' ? color.ink : COIN_GOLD,
            fill: color.paper,
            fillStyle: 'solid',
          })}
        />
      </Svg>
      <Text style={[styles.bubbleGlyph, view.collectResource === 'steel' ? null : { color: COIN_GOLD }]}>
        {glyph}
      </Text>
    </Animated.View>
  );
}

/**
 * The Scrapyard's wrecks — part-02 §6: "draws the wrecks of your last battles
 * (reuse the wreck sprites from the board), up to the level's display slots".
 *
 * Reuses ShipSprite with `sunk`, so these are literally the same wrecks the
 * battle board draws, at a smaller scale. Collecting empties the list
 * server-side, so the yard clears itself.
 */
const ScrapWrecks = memo(function ScrapWrecks({ view }: { view: PlotView }) {
  if (view.id !== 'scrapyard' || view.wrecks.length === 0) return null;
  return (
    <View style={styles.wrecks} pointerEvents="none">
      {view.wrecks.slice(0, 8).map((shipClass, index) => (
        <View
          key={`${shipClass}-${index}`}
          style={{
            transform: [{ scale: 0.34 }, { rotate: `${-12 + ((index * 7) % 24)}deg` }],
            marginLeft: index === 0 ? 0 : -16,
          }}
        >
          <ShipSprite shipClass={shipClass} orientation="h" sunk backing={false} />
        </View>
      ))}
    </View>
  );
});

/** The one-shot completion celebration: flourish + "Inked!" stamp (§4). */
function InkedStamp({ onDone }: { onDone: () => void }) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(reduceMotion ? 1 : 0.4);
  const fade = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) {
      onDone();
      return;
    }
    scale.value = withSequence(
      withTiming(1.18, { duration: 140, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 90 }),
    );
    fade.value = withSequence(withTiming(1, { duration: 900 }), withTiming(0, { duration: 350 }));
    const timer = setTimeout(onDone, 1_300);
    return () => clearTimeout(timer);
  }, [scale, fade, reduceMotion, onDone]);

  const style = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [{ scale: scale.value }, { rotate: '-2deg' }],
  }));

  return (
    <Animated.View style={[styles.stamp, style]} pointerEvents="none">
      <Text style={styles.stampText}>Inked!</Text>
    </Animated.View>
  );
}

export const Plot = memo(function Plot({
  spec,
  view,
  zoom,
  onOpen,
  onCollect,
  celebrated,
  onCelebrated,
}: PlotProps) {
  const origin = plotOrigin(spec);
  const name = CITY_CATALOGUE[spec.id].name;
  const { roughRect } = useRough();
  const lastLevel = useRef(view.level);
  const justFinished = view.level > lastLevel.current && !celebrated;
  useEffect(() => {
    lastLevel.current = view.level;
  }, [view.level]);

  const maxLevel = CITY_CATALOGUE[spec.id].levels.length;
  const tier = tierForLevel(view.level > 0 ? view.level : (view.toLevel ?? 1));

  // The outline for locked and empty plots: dashed, exactly like the three
  // "Coming soon" slots that shipped before this part.
  const outline = roughRect(2, 2, PLOT_W - 4, PLOT_H - 4, {
    seed: hashString(`plot-outline-${spec.id}`),
    strokeWidth: 1.5,
    roughness: 1.35,
    stroke: view.state === 'locked' ? color.inkFaint : color.inkSoft,
  });

  /** Counter-scale so the pressable keeps a usable on-screen size (§10). */
  const hitStyle = useAnimatedStyle(() => {
    const onScreen = PLOT_H * zoom.value;
    const k = onScreen >= MIN_HIT_CANVAS ? 1 : MIN_HIT_CANVAS / Math.max(0.001, onScreen);
    return { transform: [{ scale: k }] };
  });

  const drawn = view.state === 'building' || view.state === 'upgrading';
  const showBuilding = view.level > 0 || drawn;

  return (
    <View
      style={[styles.root, { left: origin.left, top: origin.top }]}
      pointerEvents="box-none"
    >
      {view.state === 'locked' || view.state === 'empty' ? (
        <Svg width={PLOT_W} height={PLOT_H} style={StyleSheet.absoluteFill} pointerEvents="none">
          <RoughShape paths={outline} dash={[6, 4]} />
        </Svg>
      ) : null}

      {showBuilding ? (
        <View style={styles.art} pointerEvents="none">
          <BuildingDrawing
            buildingId={spec.id}
            tier={tier}
            w={PLOT_W}
            h={PLOT_H}
            progress={drawn ? view.progress : 1}
            gold={view.level >= maxLevel}
            scaffold={view.state === 'upgrading'}
          />
        </View>
      ) : null}

      {drawn ? <PenNib view={view} /> : null}
      <ScrapWrecks view={view} />
      {view.state === 'ready' ? <CollectBubble view={view} /> : null}
      {justFinished ? (
        <InkedStamp onDone={() => onCelebrated(`${spec.id}:${view.level}`)} />
      ) : null}

      <Text style={styles.name} pointerEvents="none" numberOfLines={1}>
        {name}
      </Text>
      <LevelPips level={view.level} max={maxLevel} />

      {view.state === 'locked' ? (
        <Ribbon text={`Admiralty ${view.requiredAdmiralty ?? '?'}`} tone="grey" />
      ) : view.state === 'empty' ? (
        <Ribbon text="Build" tone="green" />
      ) : drawn ? (
        <Ribbon
          text={view.finishing ? 'Finishing…' : formatClock(view.secondsLeft)}
          tone="ink"
        />
      ) : null}

      {/* The hit area is the only thing that reads the zoom. */}
      <Animated.View style={[styles.hitWrap, hitStyle]} pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={plotLabel(view)}
          onPress={() => (view.state === 'ready' ? onCollect(spec.id) : onOpen(spec.id))}
          style={styles.hit}
        />
      </Animated.View>
    </View>
  );
});

/** "2:05", "1h 12m", "3d 4h" — short enough for a 20-unit ribbon. */
export function formatClock(seconds: number): string {
  if (seconds <= 0) return 'Finishing…';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${seconds % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

const styles = StyleSheet.create({
  root: { position: 'absolute', width: PLOT_W, height: PLOT_H, overflow: 'visible' },
  art: { position: 'absolute', left: 0, top: 0 },
  hitWrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  hit: { flex: 1 },
  name: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -12,
    textAlign: 'center',
    color: color.inkSoft,
    fontFamily: font.label,
    fontSize: typeScale.xxs,
  },
  pips: { position: 'absolute', left: 4, top: -2 },
  ribbon: { position: 'absolute', left: 0, right: 0, bottom: -12, alignItems: 'center' },
  ribbonTintGreen: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  nib: { position: 'absolute' },
  wrecks: {
    position: 'absolute',
    left: 4,
    bottom: 2,
    right: 4,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  nibGlyph: { fontSize: 12, color: color.ink },
  bubble: { position: 'absolute', right: -4, top: -18, width: 26, height: 26 },
  bubbleGlyph: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 5,
    textAlign: 'center',
    fontSize: 13,
    color: color.ink,
    fontFamily: font.label,
  },
  stamp: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: PLOT_H / 2 - 14,
    alignItems: 'center',
  },
  stampText: {
    color: color.inkRed,
    fontFamily: font.display,
    fontSize: typeScale.md,
    borderWidth: 2,
    borderColor: color.inkRed,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
});
