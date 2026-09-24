/**
 * The Port Gazette — part-09 §1.
 *
 * "masthead (THE PORT GAZETTE), date, a joke price ('one coin'), one big
 *  headline, two or three sub-stories, 'Captain's corner' (a rotating tactical
 *  tip), a weather box (nautical flavour, decorative), and the back page — the
 *  daily puzzle."
 *
 * A newspaper is columns and rules, so this screen is drawn with hairlines and
 * `InkPanel`, the way `app/leaderboard.tsx` draws its ledger. Rough is for the
 * boxes; the column rules are plain one-pixel views, because Rough on a dozen
 * straight rules looks like a mistake rather than a hand.
 *
 * THE SHARE-AS-IMAGE BUTTON IS NOT HERE, DELIBERATELY. §1: "exports the
 * edition as an image **if the repo already has a view-shot dependency**;
 * otherwise the button is hidden. **Never add a dependency for this.**" There
 * is no `react-native-view-shot` in package.json, so the button does not
 * exist — not a disabled one. See part-09-plan.md §0.2.
 */
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getGazette, markGazetteRead, type Edition } from '@/daily/api';
import { InkPanel } from '@/ui/InkPanel';
import { InkSpinner } from '@/ui/InkSpinner';
import { Paper } from '@/ui/Paper';
import { Scale } from '@/ui/Scale';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';

/** `2026-04-11` -> `Saturday, 11 April 2026`, in the paper's own voice. */
function longDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function Rule({ heavy = false }: { heavy?: boolean }) {
  return <View style={[styles.rule, heavy && styles.ruleHeavy]} />;
}

export default function GazetteScreen() {
  const router = useRouter();
  const [edition, setEdition] = useState<Edition | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await getGazette();
      setEdition(response.edition);
      setError(null);
      // Best effort, never awaited by anything the reader can see.
      void markGazetteRead().catch(() => undefined);
    } catch {
      setError('Today’s edition has not come off the press.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!edition) {
    return (
      <Scale>
        <Paper>
          <View style={styles.centre}>
            {error ? <Text style={styles.error}>{error}</Text> : <InkSpinner />}
          </View>
        </Paper>
      </Scale>
    );
  }

  return (
    <Scale>
      <Paper>
        <ScrollView
          style={styles.page}
          contentContainerStyle={styles.pageBody}
          showsVerticalScrollIndicator={false}
        >
          {/* ---- masthead ---- */}
          <Text style={styles.masthead}>{edition.masthead}</Text>
          <Rule heavy />
          <View style={styles.dateline}>
            <Text style={styles.datelineText}>{longDate(edition.date)}</Text>
            <Text style={styles.datelineText}>{edition.price}</Text>
          </View>
          <Rule />

          {/* ---- the headline ---- */}
          <Text style={styles.headline}>{edition.headline.text}</Text>
          <Rule />

          {/* ---- two columns: sub-stories | the boxes ---- */}
          <View style={styles.columns}>
            <View style={styles.column}>
              {edition.subStories.length > 0 ? (
                edition.subStories.map((story) => (
                  <View key={story.templateId} style={styles.story}>
                    <Text style={styles.storyText}>{story.text}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.storyQuiet}>
                  Nothing else to report from the harbour today.
                </Text>
              )}
            </View>

            <View style={styles.gutter} />

            <View style={styles.column}>
              <InkPanel w={300} h={82} seedKey="captains-corner">
                <View style={styles.box}>
                  <Text style={styles.boxTitle}>Captain&rsquo;s corner</Text>
                  <Text style={styles.boxBody}>{edition.tip}</Text>
                </View>
              </InkPanel>

              <View style={styles.boxGap} />

              <InkPanel w={300} h={58} seedKey="weather-box">
                <View style={styles.box}>
                  <Text style={styles.boxTitle}>Weather</Text>
                  <Text style={styles.boxBody}>{edition.weather}</Text>
                </View>
              </InkPanel>

              {edition.seasonSea ? (
                <Text style={styles.seasonSea}>
                  Season sea: {edition.seasonSea.name} — ranked plays here for both captains.
                </Text>
              ) : null}
            </View>
          </View>

          {/* ---- the back page ---- */}
          <Rule />
          <Pressable style={styles.backPage} onPress={() => router.push('/puzzle')}>
            <Text style={styles.backPageTitle}>The back page</Text>
            <Text style={styles.backPageBody}>
              {`Puzzle #${edition.puzzleNumber} — one board, the same for every captain. Tap to play.`}
            </Text>
          </Pressable>
        </ScrollView>

        <Pressable style={styles.close} onPress={() => router.back()}>
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
      </Paper>
    </Scale>
  );
}

const styles = StyleSheet.create({
  error: {
    fontFamily: font.body,
    fontSize: typeScale.sm,
    color: color.inkRed,
    textAlign: 'center',
    maxWidth: 420,
  },
  centre: {
    width: CANVAS_W,
    height: CANVAS_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  page: {
    width: CANVAS_W,
    height: CANVAS_H,
  },
  pageBody: {
    paddingHorizontal: 56,
    paddingTop: space.sm,
    paddingBottom: space.lg,
  },
  masthead: {
    fontFamily: font.display,
    fontSize: typeScale.xxl,
    color: color.ink,
    textAlign: 'center',
    letterSpacing: 1,
  },
  rule: {
    height: 1,
    backgroundColor: color.inkFaint,
    marginVertical: space.xs,
  },
  ruleHeavy: {
    height: 2,
    backgroundColor: color.ink,
  },
  dateline: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  datelineText: {
    fontFamily: font.body,
    fontSize: typeScale.xs,
    color: color.inkSoft,
  },
  headline: {
    fontFamily: font.display,
    fontSize: typeScale.xl,
    color: color.ink,
    marginVertical: space.xs,
    lineHeight: typeScale.xl + 4,
  },
  columns: {
    flexDirection: 'row',
    marginTop: space.xs,
  },
  column: {
    flex: 1,
  },
  gutter: {
    width: 1,
    backgroundColor: color.inkFaint,
    marginHorizontal: space.md,
  },
  story: {
    marginBottom: space.sm,
  },
  storyText: {
    fontFamily: font.body,
    fontSize: typeScale.md,
    color: color.ink,
    lineHeight: typeScale.md + 5,
  },
  storyQuiet: {
    fontFamily: font.body,
    fontSize: typeScale.sm,
    color: color.inkFaint,
    fontStyle: 'italic',
  },
  box: {
    flex: 1,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  boxGap: {
    height: space.sm,
  },
  seasonSea: {
    marginTop: space.xs,
    color: color.inkSoft,
    fontFamily: font.body,
    fontSize: typeScale.xxs,
  },
  boxTitle: {
    fontFamily: font.label,
    fontSize: typeScale.xs,
    color: color.inkRed,
    marginBottom: 2,
  },
  boxBody: {
    fontFamily: font.body,
    fontSize: typeScale.sm,
    color: color.ink,
    lineHeight: typeScale.sm + 4,
  },
  backPage: {
    paddingVertical: space.xs,
  },
  backPageTitle: {
    fontFamily: font.label,
    fontSize: typeScale.sm,
    color: color.inkRed,
  },
  backPageBody: {
    fontFamily: font.body,
    fontSize: typeScale.sm,
    color: color.ink,
  },
  close: {
    position: 'absolute',
    right: space.md,
    top: space.sm,
  },
  closeText: {
    fontFamily: font.label,
    fontSize: typeScale.sm,
    color: color.inkSoft,
  },
});
