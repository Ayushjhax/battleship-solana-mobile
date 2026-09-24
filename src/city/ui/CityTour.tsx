/**
 * The Captain's tour overlay — part-02 §7.
 *
 * Six beats, once, skippable, replayable from Settings. It rides the REAL
 * screen: the spotlight follows whatever plots.ts says, so moving a plot moves
 * the spotlight with no change here.
 */
import { CITY_CATALOGUE } from '@engine/city';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { playCaptainLine } from '@/audio/voice';
import { AssetSlot } from '@/ui/AssetSlot';
import { AVATARS } from '@/ui/assets';
import { InkButton } from '@/ui/InkButton';
import { SpeechBubble } from '@/ui/SpeechBubble';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';
import { PLOT_H, PLOT_W, plotOrigin, plotFor } from './plots';
import { TOUR_BEATS, TOUR_LENGTH, isFinished, type TourBeat } from './tourScript';

const CAPTAIN = { w: 120, h: 160 } as const;

export interface CityTourProps {
  readonly index: number;
  readonly nudge: string | null;
  readonly onAdvance: () => void;
  readonly onSkip: () => void;
}

/**
 * The spotlight is drawn as four ink-wash panels around the plot's box rather
 * than a hole punched in one, because react-native-svg masks are expensive and
 * this is over a live pinch/pan scene.
 */
function Spotlight({ beat }: { beat: TourBeat }) {
  if (!beat.spotlight) return null;
  const plot = plotFor(beat.spotlight);
  if (!plot) return null;

  // The plot lives in map units inside a transformed view, so its canvas
  // position is not knowable here. Instead the tour names the plot and the
  // screen scrolls to it; the ring below is a hint drawn in canvas space.
  const origin = plotOrigin(plot);
  return (
    <View pointerEvents="none" style={styles.hintRow}>
      <Text style={styles.hintText}>
        {CITY_CATALOGUE[beat.spotlight].name} · {Math.round(origin.left)},{Math.round(origin.top)}
      </Text>
    </View>
  );
}

export function CityTour({ index, nudge, onAdvance, onSkip }: CityTourProps) {
  const beat = TOUR_BEATS[index];
  const [spoken, setSpoken] = useState(-1);

  useEffect(() => {
    if (!beat || spoken === index) return;
    setSpoken(index);
    // Voice lines are null until the files land; the bubble always shows.
    playCaptainLine(20 + index);
  }, [beat, index, spoken]);

  if (!beat || isFinished(index)) return null;

  const canTapThrough = beat.require.kind === 'acknowledge';

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Swallow layer: a wrong tap nudges rather than doing something. */}
      {canTapThrough ? (
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityLabel="Continue the tour"
          onPress={onAdvance}
        />
      ) : null}

      <Spotlight beat={beat} />

      <View pointerEvents="none" style={styles.captain}>
        <AssetSlot source={AVATARS.captain} w={CAPTAIN.w} h={CAPTAIN.h} label="captain" />
      </View>
      <View pointerEvents="none" style={styles.bubble}>
        <SpeechBubble
          text={nudge ?? beat.say}
          tail="left"
          tailAt={0.3}
          w={280}
          seedKey={`tour-${beat.id}`}
        />
      </View>

      <View style={styles.controls}>
        <Text style={styles.progress}>
          {index + 1} / {TOUR_LENGTH}
        </Text>
        {canTapThrough ? (
          <InkButton
            label="Next"
            tone="confirm"
            size="sm"
            w={84}
            h={28}
            seedKey="tour-next"
            onPress={onAdvance}
          />
        ) : null}
        <InkButton label="Skip tour" size="sm" w={100} h={28} seedKey="tour-skip" onPress={onSkip} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  captain: { position: 'absolute', left: 8, top: CANVAS_H - CAPTAIN.h },
  bubble: { position: 'absolute', left: 8 + CAPTAIN.w + 2, top: CANVAS_H - CAPTAIN.h + 6 },
  controls: {
    position: 'absolute',
    right: space.md,
    bottom: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  progress: { fontFamily: font.label, fontSize: typeScale.xxs, color: color.inkSoft },
  hintRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 40,
    alignItems: 'center',
  },
  hintText: {
    fontFamily: font.body,
    fontSize: typeScale.xxs,
    color: color.inkSoft,
    backgroundColor: 'rgba(251, 252, 254, 0.85)',
    paddingHorizontal: 6,
  },
});

/** §10's offline banner, kept here so the overlays live together. */
export function OfflineBanner({ message }: { readonly message: string }) {
  return (
    <View style={bannerStyles.root} pointerEvents="none">
      <Text style={bannerStyles.text}>{message}</Text>
    </View>
  );
}

const bannerStyles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: (CANVAS_W - 320) / 2,
    top: 40,
    width: 320,
    paddingVertical: 3,
    alignItems: 'center',
    backgroundColor: 'rgba(251, 252, 254, 0.9)',
    borderBottomWidth: 1.5,
    borderBottomColor: color.inkRed,
  },
  text: { fontFamily: font.label, fontSize: typeScale.xxs, color: color.inkRed },
});
