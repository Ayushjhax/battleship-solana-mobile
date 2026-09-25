/**
 * The leaderboard (P14): the top-100 view from P11 on the commissioned ledger
 * (LEADERBOARD_ART.table — its header baked in, its row rules erased so the
 * live rows scroll under their own), on BACKGROUNDS.settings. Rank, the
 * captain each player chose in their colour, port, name, wins, points. Pull
 * to refresh.
 *
 * "You" is found by POSITION, never by id: public.my_leaderboard_row() (0008)
 * returns the caller's 1-based place in the same ordering as the view, so
 * position <= 100 inks that row red, and anything beyond pins the row under
 * the list. The view itself exposes no user id at all.
 *
 * Budget: the screen must show rows within 400 ms. The two calls run in
 * parallel and the last good page is kept in memory so re-opening paints at
 * once.
 */
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View, type ImageStyle } from 'react-native';

import { FlagBadge } from '@/features/flags/FlagBadge';
import {
  getLeaderboard,
  getMyLeaderboardRow,
  type LeaderboardEntry,
  type MyLeaderboardRow,
} from '@/net/api';
import { ArtImageButton } from '@/ui/ArtImageButton';
import { ArtPlate } from '@/ui/ArtPlate';
import {
  BACKGROUNDS,
  LEADERBOARD_ART,
  LOGIN_ART,
  MATCHMAKING_ART,
  POINTS_ART,
  RESULT_ART,
  SETTINGS_ART,
  type Asset,
} from '@/ui/assets';
import { InkSpinner } from '@/ui/InkSpinner';
import { portraitFor } from '@/ui/portraits';
import { Scale } from '@/ui/Scale';
import { CANVAS_W, artColor, font } from '@/ui/tokens';

const LOAD_BUDGET_MS = 400;

interface Page {
  readonly rows: readonly LeaderboardEntry[];
  readonly me: MyLeaderboardRow | null;
  readonly loadedAt: number;
  readonly tookMs: number;
}

/** The last good page, so coming back to the screen paints immediately. */
let cached: Page | null = null;

async function loadPage(): Promise<{ page?: Page; error?: string }> {
  const t0 = Date.now();
  const [ladder, me] = await Promise.all([getLeaderboard(), getMyLeaderboardRow()]);
  if (!ladder.ok) return { error: ladder.error.message };
  const page: Page = {
    rows: ladder.value,
    me: me.ok ? me.value : null,
    loadedAt: Date.now(),
    tookMs: Date.now() - t0,
  };
  if (__DEV__ && page.tookMs > LOAD_BUDGET_MS)
    console.warn(`[leaderboard] loaded in ${page.tookMs} ms, over the ${LOAD_BUDGET_MS} ms budget`);
  cached = page;
  return { page };
}

// ---------------------------------------------------------------------------
// Ledger geometry — the table is drawn at one uniform scale, so its baked
// header stays where it was drawn and the live columns line up under it.
// ---------------------------------------------------------------------------

const TABLE_PX = { w: 890, h: 477 } as const;
const K = 0.612;
const TABLE = { w: TABLE_PX.w * K, h: TABLE_PX.h * K, x: (CANVAS_W - TABLE_PX.w * K) / 2, y: 58 } as const;
/** In table px: the body under the header, and the header's labels. */
const BODY_PX = { x0: 17, x1: 867, y0: 128, y1: 430 } as const;
const HEAD_PX = { rank: 144.5, captain: 250, wins: 623, points: 730.5 } as const;
const BODY = {
  x: TABLE.x + BODY_PX.x0 * K,
  y: TABLE.y + BODY_PX.y0 * K,
  w: (BODY_PX.x1 - BODY_PX.x0) * K,
  h: (BODY_PX.y1 - BODY_PX.y0) * K,
} as const;
/** A header position as an x inside the body. */
const col = (px: number) => (px - BODY_PX.x0) * K;
const ROW_H = 26;
const AVATAR = 22;
const COL = {
  rank: col(HEAD_PX.rank) - 20,
  avatar: col(HEAD_PX.rank) + 12,
  flag: col(HEAD_PX.rank) + 12 + AVATAR + 4,
  name: col(HEAD_PX.captain),
  wins: col(HEAD_PX.wins) - 24,
  points: col(HEAD_PX.points) - 30,
} as const;

function Art({ source, style }: { source: Asset; style: ImageStyle }) {
  return (
    <Image
      source={source}
      style={[{ position: 'absolute' }, style]}
      contentFit="contain"
      cachePolicy="memory-disk"
      pointerEvents="none"
    />
  );
}

const Row = memo(function Row({
  position,
  entry,
  me,
  pinned = false,
}: {
  position: number;
  entry: LeaderboardEntry;
  me: boolean;
  pinned?: boolean;
}) {
  return (
    <View style={[styles.row, pinned ? styles.pinnedRow : null]} accessible accessibilityLabel={
      `${me ? 'You, ' : ''}rank ${position}, ${entry.name}, ${entry.battles_won} wins, ${entry.rank_points} points`
    }>
      <Text style={[styles.cell, styles.rank, { left: COL.rank }, me && styles.meText]}>{position}</Text>
      <Image
        source={portraitFor(entry.avatar_id, entry.avatar_color)}
        style={[styles.avatar, { left: COL.avatar }]}
        contentFit="contain"
        cachePolicy="memory-disk"
      />
      <FlagBadge code={entry.country_code} w={24} style={[styles.flag, { left: COL.flag }]} />
      <Text style={[styles.cell, styles.name, { left: COL.name }, me && styles.meText]} numberOfLines={1}>
        {entry.name}
      </Text>
      <Text style={[styles.cell, styles.num, { left: COL.wins, width: 48 }]}>{entry.battles_won}</Text>
      <Text style={[styles.cell, styles.num, { left: COL.points, width: 60 }, me && styles.meText]}>
        {entry.rank_points}
      </Text>
      {pinned ? null : (
        <Image source={POINTS_ART.straightDivider} style={styles.divider} contentFit="fill" />
      )}
    </View>
  );
});

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

export default function LeaderboardScreen() {
  const router = useRouter();
  const [page, setPage] = useState<Page | null>(cached);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async (asRefresh: boolean) => {
    if (asRefresh) setRefreshing(true);
    const result = await loadPage();
    if (!alive.current) return;
    if (result.page) {
      setPage(result.page);
      setError(null);
    } else {
      setError(result.error ?? 'The ladder could not be read.');
    }
    setRefreshing(false);
  }, []);

  useEffect(() => {
    alive.current = true;
    void load(false);
    return () => {
      alive.current = false;
    };
  }, [load]);

  const myPosition = page?.me?.rank_position ?? null;
  const pinned = page?.me && myPosition !== null && myPosition > page.rows.length ? page.me : null;

  return (
    <Scale backgroundImage={BACKGROUNDS.settings}>
      <Art source={LOGIN_ART.sailingShip} style={styles.ship} />
      <Art source={SETTINGS_ART.quote} style={styles.quoteTopLeft} />
      <Art source={RESULT_ART.oceansQuote} style={styles.quoteTopRight} />
      <Art source={RESULT_ART.seasQuote} style={styles.quoteLeft} />
      <Art source={MATCHMAKING_ART.goodCaptainsQuote} style={styles.quoteRight} />

      <ArtImageButton
        source={SETTINGS_ART.back}
        w={72}
        h={44}
        label="Back"
        style={styles.back}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/menu'))}
      />
      <Art source={LEADERBOARD_ART.banner} style={styles.banner} />
      <Image source={LEADERBOARD_ART.table} style={styles.table} contentFit="fill" accessibilityLabel="Leaderboard: rank, captain, wins, points" />

      <View style={styles.body}>
        {page ? (
          <ScrollView
            style={StyleSheet.absoluteFill}
            contentContainerStyle={{ paddingBottom: pinned ? ROW_H + 4 : 4 }}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => void load(true)}
                tintColor={artColor.ink}
                colors={[artColor.ink]}
              />
            }
          >
            {page.rows.map((entry, i) => (
              <Row key={`${i}-${entry.name}`} position={i + 1} entry={entry} me={myPosition === i + 1} />
            ))}
            {page.rows.length === 0 ? <Text style={styles.empty}>No battles logged yet. Be the first.</Text> : null}
          </ScrollView>
        ) : error ? (
          <View style={styles.centre}>
            <Text style={styles.errorText}>{error}</Text>
            <ArtPlate tone="green" w={140} h={34} fontSize={15} label="Try again" onPress={() => void load(false)} />
          </View>
        ) : (
          <View style={styles.centre}>
            <InkSpinner size={30} seedKey="leaderboard" />
          </View>
        )}
        {pinned ? (
          <View style={styles.pinned}>
            <Row position={pinned.rank_position} entry={pinned} me pinned />
          </View>
        ) : null}
      </View>
    </Scale>
  );
}

const styles = StyleSheet.create({
  back: { position: 'absolute', left: 8, top: 8 },
  banner: { left: (CANVAS_W - 270) / 2, top: 0, width: 270, height: 270 * (139 / 658) },
  table: { position: 'absolute', left: TABLE.x, top: TABLE.y, width: TABLE.w, height: TABLE.h },
  ship: { left: 12, top: 118, width: 96, height: 96 },
  quoteTopLeft: { left: 86, top: 6, width: 80, height: 51 },
  quoteTopRight: { left: 692, top: 4, width: 78, height: 56 },
  quoteLeft: { left: 20, top: 236, width: 74, height: 54 },
  quoteRight: { left: 700, top: 96, width: 64, height: 67 },

  body: { position: 'absolute', left: BODY.x, top: BODY.y, width: BODY.w, height: BODY.h, overflow: 'hidden' },
  row: { height: ROW_H },
  pinnedRow: { borderTopWidth: 1, borderTopColor: artColor.label },
  pinned: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#F7F2E6' },
  cell: { position: 'absolute', top: 3, fontFamily: font.display, fontSize: 16, lineHeight: 20 },
  rank: { width: 40, textAlign: 'center', color: artColor.label },
  avatar: { position: 'absolute', top: 2, width: AVATAR, height: AVATAR },
  flag: { position: 'absolute', top: 4 },
  name: { width: COL.wins - COL.name - 8, color: artColor.ink },
  num: { textAlign: 'center', color: artColor.ink },
  meText: { color: artColor.red },
  divider: { position: 'absolute', left: 8, right: 8, bottom: 0, height: 3, opacity: 0.55 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  errorText: { maxWidth: 360, color: artColor.ink, fontFamily: font.body, fontSize: 15, textAlign: 'center' },
  empty: { marginTop: 24, color: artColor.soft, fontFamily: font.body, fontSize: 15, textAlign: 'center' },
});
