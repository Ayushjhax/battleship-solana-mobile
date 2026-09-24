/**
 * Visiting a captain's city — part-08 §5.
 *
 * "a read-only render of their buildings, levels, renown and equipped
 *  cosmetics. No loot, no renown, no timers."
 *
 * READ-ONLY IS THE WHOLE SCREEN. There is no tap target on a plot, no collect
 * button, no timer — and the payload itself carries only levels, because
 * `publicCity()` on the server strips the stored production and the scrap
 * pile. Those are what a raid takes (Part 6 §7.2), and serving them here
 * would turn a friendly visit into a free scouting report that bypasses the
 * search cost.
 *
 * Reused: the city's own plot table and `Plot` renderer, `Paper`, `Scale`.
 * Nothing about the harbour scene, the pinch/pan or the nameplate is touched —
 * this is a different, simpler view of the same data.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CITY_CATALOGUE, type BuildingId } from '@engine/city';

import { canRaidFriendly, visitCity, type Visit } from '@/fleet/api';
import { InkButton } from '@/ui/InkButton';
import { InkPanel } from '@/ui/InkPanel';
import { Paper } from '@/ui/Paper';
import { Scale } from '@/ui/Scale';
import { TitleRibbon } from '@/ui/TitleRibbon';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';

export default function VisitScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ userId?: string | string[]; name?: string | string[] }>();
  const userId = Array.isArray(params.userId) ? params.userId[0] : params.userId;
  const name = (Array.isArray(params.name) ? params.name[0] : params.name) ?? 'A captain';

  const [visit, setVisit] = useState<Visit | null>(null);
  const [friendly, setFriendly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setError('I cannot find that captain.');
      return;
    }
    let cancelled = false;
    void visitCity(userId)
      .then((next) => {
        if (!cancelled) setVisit(next);
      })
      .catch(() => {
        if (!cancelled) setError('Their harbourmaster is not answering.');
      });
    void canRaidFriendly(userId).then((ok) => {
      if (!cancelled) setFriendly(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const practise = useCallback(() => {
    if (!userId) return;
    // §5 — a friendly raid: no loot, no renown, no shield, no lock. The
    // context is the server's business; the screen only names it.
    router.push(`/raid?friendly=1&target=${userId}`);
  }, [router, userId]);

  const built = Object.entries(visit?.city.buildings ?? {})
    .filter(([, b]) => b.level > 0)
    .sort((a, b) => b[1].level - a[1].level);

  return (
    <Scale>
      <Paper variant="full" />

      <View style={styles.back}>
        <InkButton label="↩" size="lg" w={54} h={48} seedKey="vs-back" onPress={() => router.back()} />
      </View>
      <View style={styles.ribbon}>
        <TitleRibbon title={`${name}'s port`} w={320} h={40} size="sm" seedKey="vs-title" />
      </View>

      <View style={styles.panel}>
        <InkPanel w={560} h={CANVAS_H - 118} seedKey="vs-city">
          <View style={styles.grid}>
            {built.length === 0 ? (
              <Text style={styles.empty}>
                {error ?? 'Nothing built here yet.'}
              </Text>
            ) : (
              built.map(([id, building]) => (
                <View key={id} style={styles.plot}>
                  <Text style={styles.plotName} numberOfLines={1}>
                    {CITY_CATALOGUE[id as BuildingId]?.name ?? id}
                  </Text>
                  <Text style={styles.plotLevel}>{`Lv ${building.level}`}</Text>
                </View>
              ))
            )}
          </View>
        </InkPanel>
      </View>

      {/* §5 — no timers, no collect, no loot. The one thing you may DO here. */}
      {friendly ? (
        <View style={styles.footer}>
          <InkButton
            label="Practice raid"
            tone="confirm"
            size="md"
            w={200}
            h={52}
            seedKey="vs-friendly"
            onPress={practise}
          />
          <Text style={styles.footerHint}>No loot, no renown — just a look at their defences.</Text>
        </View>
      ) : null}

      {error && built.length > 0 ? (
        <Pressable style={styles.error} onPress={() => setError(null)}>
          <Text style={styles.errorText}>{error}</Text>
        </Pressable>
      ) : null}
    </Scale>
  );
}

const styles = StyleSheet.create({
  back: { position: 'absolute', left: space.sm, top: space.sm },
  ribbon: { position: 'absolute', left: CANVAS_W / 2 - 160, top: 2 },
  panel: { position: 'absolute', left: 30, top: 50 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, padding: space.sm },
  plot: {
    width: 128,
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: color.gridMajor,
  },
  plotName: { color: color.ink, fontFamily: font.label, fontSize: typeScale.xxs },
  plotLevel: { color: color.inkSoft, fontFamily: font.display, fontSize: typeScale.sm },
  empty: { color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.sm, padding: space.md },
  footer: { position: 'absolute', right: 20, top: 90, alignItems: 'center', gap: space.xs },
  footerHint: {
    color: color.inkFaint,
    fontFamily: font.body,
    fontSize: typeScale.xxs,
    width: 180,
    textAlign: 'center',
  },
  error: {
    position: 'absolute',
    left: CANVAS_W / 2 - 200,
    bottom: 4,
    width: 400,
    paddingVertical: 4,
    alignItems: 'center',
    backgroundColor: color.paper,
    borderWidth: 1.5,
    borderColor: color.inkRed,
  },
  errorText: { color: color.inkRed, fontFamily: font.body, fontSize: typeScale.xs },
});
