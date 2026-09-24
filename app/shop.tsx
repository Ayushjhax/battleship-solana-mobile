/**
 * The Shipyard and the Stationer's Shop — part-03 §4.
 *
 * ONE route with a `store` param, not two screens: §4 describes the same
 * shelf-and-preview layout for both, differing only in which slots they
 * stock. Two files would have been the same file twice.
 *
 * "a shelf of ink cards (2 rows, horizontally scrolling), each showing the
 *  item drawn in its own style, its price and Own/Equip" — plus the Captain's
 *  Desk, the live preview, which is the reason a player can tell Parchment
 *  from Old sea chart before spending 900 coins.
 *
 * Every colour on this screen goes through `inkOn()` and `markOn()`, so the
 * preview shows the REMAPPED colour — the one that will actually be drawn.
 * A preview that showed gold as bright gold on parchment would be a lie the
 * player only discovers after paying 350 gems.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Rect } from 'react-native-svg';

import {
  MARK_GLYPHS,
  cosmeticById,
  inkOn,
  markOn,
  type CosmeticSlot,
  type MarkKind,
} from '@engine/cosmetics';

import {
  NotAvailableGemStore,
  buyCosmetic,
  equipCosmetic,
  getStore,
  type Store,
} from '@/cosmetics/api';
import { InkButton } from '@/ui/InkButton';
import { Paper } from '@/ui/Paper';
import { Scale } from '@/ui/Scale';
import { TitleRibbon } from '@/ui/TitleRibbon';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';

const SLOT_LABEL: Record<string, string> = {
  fleetInk: 'Ink',
  paper: 'Paper',
  pen: 'Pen',
  hullSet: 'Hulls',
  sinkEffect: 'Sinking',
  victoryStamp: 'Stamp',
};

/**
 * The Captain's Desk — §4's live preview.
 *
 * A mini board on the CURRENT paper with the fleet in the CURRENT ink, drawn
 * with the remap applied. Tapping a card previews it free; Buy commits.
 */
function CaptainsDesk({ paperId, inkId }: { paperId: string; inkId: string }) {
  const paper = cosmeticById(paperId)?.hex ?? '#FBFCFE';
  const ink = inkOn(inkId, paperId);
  const cell = 16;

  return (
    <View style={styles.desk}>
      <Svg width={cell * 6} height={cell * 5}>
        <Rect x={0} y={0} width={cell * 6} height={cell * 5} fill={paper} />
        {/* the rules */}
        {Array.from({ length: 6 }, (_, n) => (
          <Line
            key={`v${n}`}
            x1={n * cell}
            y1={0}
            x2={n * cell}
            y2={cell * 5}
            stroke={ink}
            strokeOpacity={0.25}
            strokeWidth={0.75}
          />
        ))}
        {Array.from({ length: 5 }, (_, n) => (
          <Line
            key={`h${n}`}
            x1={0}
            y1={n * cell}
            x2={cell * 6}
            y2={n * cell}
            stroke={ink}
            strokeOpacity={0.25}
            strokeWidth={0.75}
          />
        ))}
        {/* a ship, in the equipped ink */}
        <Rect x={cell + 2} y={cell + 2} width={cell * 3 - 4} height={cell - 4} fill="none" stroke={ink} strokeWidth={1.6} />
        {/* one of each mark, so the player can see they stay apart */}
        {(['miss', 'hit', 'sunk'] as MarkKind[]).map((mark, n) => (
          <Circle
            key={mark}
            cx={cell * (n + 1) + cell / 2}
            cy={cell * 3 + cell / 2}
            r={3.5}
            fill={markOn(mark, paperId)}
          />
        ))}
      </Svg>
      <Text style={styles.deskLabel}>Captain&apos;s Desk</Text>
    </View>
  );
}

function Card({
  item,
  owned,
  equipped,
  paperId,
  onPreview,
  onBuy,
  onEquip,
}: {
  item: Store['shelves'][number]['items'][number];
  owned: boolean;
  equipped: boolean;
  paperId: string;
  onPreview: () => void;
  onBuy: () => void;
  onEquip: () => void;
}) {
  // An ink card is drawn in its own colour, as remapped for the CURRENT
  // paper — so the swatch is the truth, not the marketing.
  const swatch =
    item.slot === 'fleetInk' ? inkOn(item.id, paperId) : (item.hex ?? color.inkSoft);

  return (
    <Pressable onPress={onPreview} style={[styles.card, equipped && styles.cardOn]}>
      <View style={[styles.swatch, { backgroundColor: swatch }]} />
      <Text style={styles.cardName} numberOfLines={1}>
        {item.name}
      </Text>
      {equipped ? (
        <Text style={styles.cardState}>worn</Text>
      ) : owned ? (
        <Pressable onPress={onEquip} hitSlop={6}>
          <Text style={styles.cardEquip}>Equip</Text>
        </Pressable>
      ) : (
        <Pressable onPress={onBuy} hitSlop={6}>
          <Text style={styles.cardPrice}>
            {item.gems > 0 ? `${item.gems} gems` : `${item.coins}c`}
          </Text>
        </Pressable>
      )}
    </Pressable>
  );
}

export default function ShopScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ store?: string | string[] }>();
  const which = (Array.isArray(params.store) ? params.store[0] : params.store) === 'shipyard'
    ? 'shipyard'
    : 'stationery';

  const [store, setStore] = useState<Store | null>(null);
  const [preview, setPreview] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void getStore()
      .then((next) => {
        setStore(next);
        setPreview({});
      })
      .catch(() => setNotice('The shop is shut.'));
  }, []);

  useEffect(load, [load]);

  const act = useCallback(
    (run: () => Promise<unknown>, failure: string) => {
      if (busy) return;
      setBusy(true);
      void run()
        .then(load)
        .catch((e: unknown) => setNotice(((e as { code?: string }).code === 'locked-tier'
          ? 'Upgrade the shop to stock that.'
          : failure)))
        .finally(() => setBusy(false));
    },
    [busy, load],
  );

  const shelves = useMemo(
    () => (store?.shelves ?? []).filter((shelf) => shelf.store === which),
    [store, which],
  );

  // What the desk shows: the previewed item if one is tapped, else equipped.
  const shown = { ...(store?.equipped ?? {}), ...preview };
  const paperId = shown.paper ?? 'paper-graph';
  const inkId = shown.fleetInk ?? 'ink-violet';

  return (
    <Scale>
      <Paper variant="full" />

      <View style={styles.back}>
        <InkButton label="↩" size="lg" w={54} h={48} seedKey="sh-back" onPress={() => router.back()} />
      </View>
      <View style={styles.ribbon}>
        <TitleRibbon
          title={which === 'shipyard' ? 'Shipyard' : "Stationer's Shop"}
          w={300}
          h={40}
          size="sm"
          seedKey="sh-title"
        />
      </View>
      <Text style={styles.wallet}>
        {`${store?.wallet.coins ?? 0}c · ${store?.wallet.gems ?? 0} gems`}
      </Text>

      <CaptainsDesk paperId={paperId} inkId={inkId} />

      <ScrollView style={styles.shelfScroll} contentContainerStyle={styles.shelfContent}>
        {shelves.map((shelf) => (
          <View key={shelf.slot} style={styles.shelf}>
            <Text style={styles.shelfTitle}>{SLOT_LABEL[shelf.slot] ?? shelf.slot}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.shelfRow}>
                {shelf.items.map((item) => (
                  <Card
                    key={item.id}
                    item={item}
                    paperId={paperId}
                    owned={item.isDefault === true || (store?.owned ?? []).includes(item.id)}
                    equipped={(store?.equipped ?? {})[shelf.slot] === item.id}
                    onPreview={() => setPreview((p) => ({ ...p, [shelf.slot]: item.id }))}
                    onBuy={() => act(() => buyCosmetic(item.id), 'Not enough for that one.')}
                    onEquip={() =>
                      act(() => equipCosmetic(shelf.slot, item.id), 'Could not equip that.')
                    }
                  />
                ))}
              </View>
            </ScrollView>
          </View>
        ))}
        {shelves.length === 0 ? (
          <Text style={styles.empty}>Nothing on the shelves yet. Upgrade the shop.</Text>
        ) : null}
      </ScrollView>

      {/* §4 — the IAP seam, with no IAP behind it. */}
      <View style={styles.gems}>
        <InkButton
          label={NotAvailableGemStore.label}
          size="sm"
          w={150}
          h={40}
          seedKey="sh-gems"
          disabled
          onPress={() => undefined}
        />
      </View>

      {notice ? (
        <Pressable style={styles.notice} onPress={() => setNotice(null)}>
          <Text style={styles.noticeText}>{notice}</Text>
        </Pressable>
      ) : null}
    </Scale>
  );
}

/** Kept honest: every mark the desk draws has a distinct glyph (§3). */
export const DESK_GLYPHS = MARK_GLYPHS;

const styles = StyleSheet.create({
  back: { position: 'absolute', left: space.sm, top: space.sm },
  ribbon: { position: 'absolute', left: CANVAS_W / 2 - 150, top: 2 },
  wallet: {
    position: 'absolute',
    right: space.md,
    top: 16,
    color: color.ink,
    fontFamily: font.label,
    fontSize: typeScale.sm,
  },
  desk: { position: 'absolute', left: 20, top: 56, alignItems: 'center', gap: 3 },
  deskLabel: { color: color.inkFaint, fontFamily: font.label, fontSize: typeScale.xxs },
  shelfScroll: { position: 'absolute', left: 140, top: 50, width: CANVAS_W - 160, height: CANVAS_H - 58 },
  shelfContent: { gap: space.xs, paddingBottom: space.md },
  shelf: { gap: 2 },
  shelfTitle: { color: color.inkRed, fontFamily: font.label, fontSize: typeScale.xxs },
  shelfRow: { flexDirection: 'row', gap: space.xs },
  card: {
    width: 84,
    padding: 5,
    borderWidth: 1,
    borderColor: color.gridMajor,
    alignItems: 'center',
    gap: 2,
  },
  cardOn: { borderColor: color.inkGreen, borderWidth: 2 },
  swatch: { width: 40, height: 16, borderWidth: 1, borderColor: color.inkFaint },
  cardName: { color: color.ink, fontFamily: font.body, fontSize: typeScale.xxs, textAlign: 'center' },
  cardPrice: { color: color.inkRed, fontFamily: font.label, fontSize: typeScale.xxs },
  cardEquip: { color: color.inkGreen, fontFamily: font.label, fontSize: typeScale.xxs },
  cardState: { color: color.inkFaint, fontFamily: font.label, fontSize: typeScale.xxs },
  empty: { color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.sm, padding: space.md },
  gems: { position: 'absolute', left: 20, bottom: space.sm },
  notice: {
    position: 'absolute',
    left: CANVAS_W / 2 - 200,
    bottom: 2,
    width: 400,
    paddingVertical: 4,
    alignItems: 'center',
    backgroundColor: color.paper,
    borderWidth: 1.5,
    borderColor: color.inkRed,
  },
  noticeText: { color: color.inkRed, fontFamily: font.body, fontSize: typeScale.xs },
});
