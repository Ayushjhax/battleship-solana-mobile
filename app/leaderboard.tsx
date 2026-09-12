/**
 * The leaderboard (P14): the top-100 view from P11 as a ruled ledger page —
 * rank number, avatar thumb, flag, name, wins, points. Pull to refresh.
 *
 * "You" is found by POSITION, never by id: public.my_leaderboard_row() (0008)
 * returns the caller's 1-based place in the same ordering as the view, so
 * position <= 100 brackets that row in inkRed, and anything beyond pins the
 * row under the list. The view itself exposes no user id at all.
 *
 * Budget: the screen must show rows within 400 ms. The two calls run in
 * parallel, the last good page is kept in memory so re-opening paints at
 * once, and the ledger's rules are plain hairlines — Rough is for the
 * brackets and the frame, not for a hundred separators.
 */
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg from 'react-native-svg';

import {
  getLeaderboard,
  getMyLeaderboardRow,
  type LeaderboardEntry,
  type MyLeaderboardRow,
} from '@/net/api';
import { InkButton } from '@/ui/InkButton';
import { InkSpinner } from '@/ui/InkSpinner';
import { Paper } from '@/ui/Paper';
import { Scale } from '@/ui/Scale';
import { TitleRibbon } from '@/ui/TitleRibbon';
import { AssetSlot } from '@/ui/AssetSlot';
import { AVATARS, type Asset } from '@/ui/assets';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';
import { RoughShape, hashString, useRough, type Point } from '@/ui/useRough';

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
// Ledger geometry — canvas units
// ---------------------------------------------------------------------------

const PAGE_X = 90;
const PAGE_Y = 58;
const PAGE_W = CANVAS_W - PAGE_X * 2;
const PAGE_H = CANVAS_H - PAGE_Y - 14;
const ROW_H = 30;
const COL = { rank: 10, avatar: 52, flag: 92, name: 134, wins: 470, points: 548 } as const;

function Bracket({ side }: { side: 'left' | 'right' }) {
  const { roughPath } = useRough();
  const w = 10;
  const h = ROW_H - 4;
  const pts: Point[] =
    side === 'left'
      ? [
          [w - 1, 1],
          [1, 1],
          [1, h - 1],
          [w - 1, h - 1],
        ]
      : [
          [1, 1],
          [w - 1, 1],
          [w - 1, h - 1],
          [1, h - 1],
        ];
  const path = roughPath(pts, {
    seed: hashString(`bracket-${side}`),
    stroke: color.inkRed,
    strokeWidth: 1.8,
    roughness: 1.1,
  });
  return (
    <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <RoughShape paths={path} />
    </Svg>
  );
}

function Row({
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
  const avatar: Asset = (AVATARS as Record<number, Asset>)[entry.avatar_id] ?? null;
  return (
    <View style={[styles.row, pinned && styles.pinnedRow]}>
      {me ? (
        <View style={[styles.bracket, { left: -14 }]}>
          <Bracket side="left" />
        </View>
      ) : null}
      <Text style={[styles.cell, styles.rank, { left: COL.rank }, me && styles.meText]}>
        {position}
      </Text>
      <View style={{ position: 'absolute', left: COL.avatar, top: 3 }}>
        <AssetSlot source={avatar} w={24} h={24} label="" tintColor={entry.avatar_color} />
      </View>
      <Text style={[styles.cell, styles.flag, { left: COL.flag }]}>
        {entry.country_code ?? '??'}
      </Text>
      <Text
        style={[styles.cell, styles.name, { left: COL.name }, me && styles.meText]}
        numberOfLines={1}
      >
        {entry.name}
      </Text>
      <Text style={[styles.cell, styles.num, { left: COL.wins }]}>{entry.battles_won}</Text>
      <Text
        style={[styles.cell, styles.num, styles.points, { left: COL.points }, me && styles.meText]}
      >
        {entry.rank_points}
      </Text>
      {me ? (
        <View style={[styles.bracket, { right: -14 }]}>
          <Bracket side="right" />
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

export default function LeaderboardScreen() {
  const router = useRouter();
  const { roughRect } = useRough();
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

  const frame = roughRect(1.5, 1.5, PAGE_W - 3, PAGE_H - 3, {
    seed: hashString('ledger-frame'),
    strokeWidth: 1.8,
    fill: color.paper,
    fillStyle: 'solid',
  });

  const myPosition = page?.me?.rank_position ?? null;
  const pinned = page?.me && myPosition !== null && myPosition > page.rows.length ? page.me : null;

  return (
    <Scale>
      <Paper variant="full" />
      <View style={styles.title}>
        <TitleRibbon title="Leaderboard" w={300} h={44} seedKey="leaderboard" />
      </View>
      <View style={styles.back}>
        <InkButton
          label="↩"
          size="lg"
          w={54}
          h={44}
          seedKey="leaderboard-back"
          onPress={() => router.back()}
        />
      </View>

      <View style={styles.page}>
        <Svg
          width={PAGE_W}
          height={PAGE_H}
          viewBox={`0 0 ${PAGE_W} ${PAGE_H}`}
          style={StyleSheet.absoluteFill}
        >
          <RoughShape paths={frame} />
        </Svg>

        <View style={styles.header}>
          <Text style={[styles.headCell, { left: COL.rank }]}>#</Text>
          <Text style={[styles.headCell, { left: COL.name }]}>Captain</Text>
          <Text style={[styles.headCell, { left: COL.wins }]}>Wins</Text>
          <Text style={[styles.headCell, { left: COL.points }]}>Points</Text>
        </View>

        {page ? (
          <ScrollView
            style={styles.list}
            contentContainerStyle={{ paddingBottom: pinned ? ROW_H + 6 : 6 }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => void load(true)}
                tintColor={color.ink}
              />
            }
          >
            {page.rows.map((entry, i) => (
              <Row
                key={`${i}-${entry.name}`}
                position={i + 1}
                entry={entry}
                me={myPosition === i + 1}
              />
            ))}
            {page.rows.length === 0 ? (
              <Text style={styles.empty}>No battles logged yet. Be the first.</Text>
            ) : null}
          </ScrollView>
        ) : error ? (
          <View style={styles.centre}>
            <Text style={styles.errorText}>{error}</Text>
            <InkButton
              label="Try again"
              tone="confirm"
              size="sm"
              w={120}
              onPress={() => void load(false)}
            />
          </View>
        ) : (
          <View style={styles.centre}>
            <InkSpinner size={34} seedKey="leaderboard" />
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
  title: { position: 'absolute', left: (CANVAS_W - 300) / 2, top: 8 },
  back: { position: 'absolute', left: 16, top: 8 },
  page: { position: 'absolute', left: PAGE_X, top: PAGE_Y, width: PAGE_W, height: PAGE_H },
  header: { position: 'absolute', left: 16, top: 6, right: 16, height: 22 },
  headCell: {
    position: 'absolute',
    top: 2,
    color: color.inkSoft,
    fontFamily: font.label,
    fontSize: typeScale.xxs,
  },
  list: { position: 'absolute', left: 16, right: 16, top: 28, bottom: 4 },
  row: {
    height: ROW_H,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.gridMajor,
  },
  pinnedRow: { borderTopWidth: 1, borderTopColor: color.inkFaint, borderBottomWidth: 0 },
  pinned: { position: 'absolute', left: 16, right: 16, bottom: 4, backgroundColor: color.paper },
  bracket: { position: 'absolute', top: 2 },
  cell: {
    position: 'absolute',
    top: 7,
    color: color.ink,
    fontFamily: font.body,
    fontSize: typeScale.sm,
  },
  rank: { width: 36, fontFamily: font.label, color: color.inkSoft },
  flag: { color: color.inkRed, fontFamily: font.label, fontSize: typeScale.xxs, top: 9 },
  name: { width: 320, fontFamily: font.display },
  num: { width: 60, textAlign: 'right' },
  points: { fontFamily: font.display },
  meText: { color: color.inkRed },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  errorText: {
    maxWidth: 360,
    color: color.ink,
    fontFamily: font.body,
    fontSize: typeScale.sm,
    textAlign: 'center',
  },
  empty: {
    marginTop: space.lg,
    color: color.inkSoft,
    fontFamily: font.body,
    fontSize: typeScale.sm,
    textAlign: 'center',
  },
});
