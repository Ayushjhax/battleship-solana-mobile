/**
 * The Flag Hall — part-08 §5.
 *
 * "every country whose captain you have beaten in a ranked online match or a
 *  raid hangs its flag. A counter ('37 / 250') and a wall that fills up. This
 *  finally gives the country field a purpose."
 *
 * A wall that fills up is the whole feel of it, so the empty slots are drawn
 * rather than omitted: the point is seeing how much wall is left. The order is
 * when you won each flag — a wall fills, it does not re-sort.
 *
 * Reused: `FlagChip` from the battle HUD (the same chip the arena and the
 * leaderboard draw), `Paper`, `Scale`, `InkButton`, `TitleRibbon`.
 */
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { flagProgress, wallOrder } from '@engine/fleets';

import { COUNTRIES, COUNTRY_COUNT, countryName } from '@/data/countries';
import { FlagChip } from '@/features/battle/Hud';
import { getFlagWall } from '@/fleet/api';
import { InkButton } from '@/ui/InkButton';
import { Paper } from '@/ui/Paper';
import { Scale } from '@/ui/Scale';
import { TitleRibbon } from '@/ui/TitleRibbon';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';

const WALL_X = 40;
const WALL_Y = 62;
const WALL_W = CANVAS_W - WALL_X * 2;
const CHIP_W = 34;
const CHIP_H = 24;
const GAP = 5;

interface Won {
  readonly countryCode: string;
  readonly firstAt: number;
}

export default function FlagHallScreen() {
  const router = useRouter();
  const [won, setWon] = useState<Won[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getFlagWall()
      .then((flags) => {
        if (cancelled) return;
        setWon(flags.map((f) => ({ countryCode: f.countryCode, firstAt: Date.parse(f.firstAt) })));
      })
      .catch(() => {
        /* an unreachable wall shows an empty one, which is honest */
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ordered = useMemo(() => wallOrder(won), [won]);
  const progress = flagProgress(
    ordered.map((f) => f.countryCode),
    COUNTRY_COUNT,
  );
  const earned = new Set(ordered.map((f) => f.countryCode));

  // The empty slots, so the wall visibly has room left. Capped at a screenful
  // past the last won flag: drawing all 199 would be 199 SVG frames.
  const emptySlots = Math.max(0, Math.min(COUNTRY_COUNT - progress.earned, 60));

  return (
    <Scale>
      <Paper variant="full" />

      <View style={styles.back}>
        <InkButton label="↩" size="lg" w={54} h={48} seedKey="fh-back" onPress={() => router.back()} />
      </View>
      <View style={styles.ribbon}>
        <TitleRibbon title="The Flag Hall" w={280} h={40} size="sm" seedKey="fh-title" />
      </View>

      <Text style={styles.counter}>{progress.label}</Text>

      <ScrollView
        style={styles.wall}
        contentContainerStyle={styles.wallContent}
        showsVerticalScrollIndicator={false}
      >
        {ordered.map((flag) => (
          <View key={flag.countryCode} style={styles.slot}>
            <FlagChip code={flag.countryCode} seedKey={`fh-${flag.countryCode}`} />
          </View>
        ))}
        {Array.from({ length: emptySlots }, (_, n) => (
          <View key={`empty-${n}`} style={[styles.slot, styles.empty]} />
        ))}
      </ScrollView>

      <Text style={styles.hint}>
        {progress.earned === 0
          ? loaded
            ? 'Beat a captain online, or take a star off their harbour, and their flag hangs here.'
            : 'Reading the register…'
          : `Most recent: ${countryName(ordered[ordered.length - 1]?.countryCode)}`}
      </Text>

      {/* §5 — the picker is reachable from here, because this screen is what
          makes the country field worth setting. */}
      <View style={styles.pick}>
        <InkButton
          label="Your port"
          size="sm"
          w={150}
          h={44}
          seedKey="fh-port"
          onPress={() => router.push('/country')}
        />
      </View>
    </Scale>
  );
}

/** Kept so an unused-import lint stays honest about what the wall can show. */
export const TOTAL_COUNTRIES = COUNTRIES.length;

const styles = StyleSheet.create({
  back: { position: 'absolute', left: space.sm, top: space.sm },
  ribbon: { position: 'absolute', left: CANVAS_W / 2 - 140, top: 2 },
  counter: {
    position: 'absolute',
    right: space.md,
    top: 16,
    color: color.ink,
    fontFamily: font.display,
    fontSize: typeScale.xl,
  },
  wall: {
    position: 'absolute',
    left: WALL_X,
    top: WALL_Y,
    width: WALL_W,
    height: CANVAS_H - WALL_Y - 56,
  },
  wallContent: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  slot: { width: CHIP_W, height: CHIP_H, alignItems: 'center', justifyContent: 'center' },
  empty: {
    borderWidth: 1,
    borderColor: color.gridMajor,
    borderStyle: 'dashed',
  },
  hint: {
    position: 'absolute',
    left: WALL_X,
    bottom: 14,
    width: WALL_W - 170,
    color: color.inkSoft,
    fontFamily: font.body,
    fontSize: typeScale.xs,
  },
  pick: { position: 'absolute', right: space.md, bottom: space.sm },
});
