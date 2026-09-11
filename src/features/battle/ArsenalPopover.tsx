/**
 * The Arsenal popover — IMG_9750: an InkPanel down from the top edge over the
 * left half, a 2 x 5 grid of weapon cards with remaining counts. Zero-count
 * cards sit at 40% opacity. Tapping a card with a count enters targeting and
 * dismisses the popover. Own-board items show their count but cannot be used.
 *
 * P08 owns the targeting overlays and attack animations; this is the plumbing
 * they hang on, and the tutorial registers `card-<kind>` targets here.
 */
import { ARSENAL_SPEC, isOwnBoardKind } from '@engine/arsenal';
import type { ArsenalItem, ArsenalKind } from '@engine/types';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg from 'react-native-svg';

import { arsenalGlyphPaths } from '@/board/art';
import { useBattle } from '@/state/battle';
import { useTutorialTarget } from '@/tutorial/useTutorialTarget';
import { ARSENAL } from '@/ui/assets';
import { AssetSlot } from '@/ui/AssetSlot';
import { InkPanel } from '@/ui/InkPanel';
import { color, font, space, type as typeScale } from '@/ui/tokens';
import { RoughShape, hashString } from '@/ui/useRough';

const NAMES: Record<ArsenalKind, string> = {
  torpedoBomber: 'Torpedo Bomber',
  doubleTorpedoBomber: 'Double Torpedo',
  bomber: 'Bomber',
  atomicBomber: 'Atomic Bomber',
  aaGun: 'AA Gun',
  radar: 'Radar',
  mine: 'Mine',
  submarine: 'Submarine',
};

const CARD = { w: 150, h: 44 } as const;

function Card({
  kind,
  items,
  onUse,
}: {
  kind: ArsenalKind;
  items: ArsenalItem[];
  onUse: (itemId: string) => void;
}) {
  const target = useTutorialTarget(`card-${kind.toLowerCase()}`);
  const usable = !isOwnBoardKind(kind);
  const count = items.length;
  const first = items[0];
  const art = ARSENAL[kind];
  const glyphKind = kind === 'radar' || kind === 'mine' || kind === 'aaGun' ? kind : 'aaGun';
  const glyph = art ? null : arsenalGlyphPaths(glyphKind, hashString(`card-${kind}`), color.ink);
  return (
    <View {...target} style={{ width: CARD.w, height: CARD.h, opacity: count === 0 ? 0.4 : 1 }}>
      <InkPanel w={CARD.w} h={CARD.h} seedKey={`card-${kind}`} padding={4}>
        <View style={styles.cardRow}>
          {art ? (
            <AssetSlot source={art} w={30} h={30} label={kind} />
          ) : (
            <Svg width={30} height={30} viewBox="0 0 32 32">
              {(glyph ?? []).map((p, i) => (
                <RoughShape key={i} paths={p} />
              ))}
            </Svg>
          )}
          <Text numberOfLines={1} style={styles.cardName}>
            {NAMES[kind]}
          </Text>
          <Text style={styles.cardCount}>{count}</Text>
        </View>
      </InkPanel>
      {usable && first && count > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${NAMES[kind]}, ${count} left`}
          onPress={() => onUse(first.id)}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
    </View>
  );
}

export function ArsenalPopover({ onClose }: { onClose: () => void }) {
  const arsenal = useBattle((s) => s.shown?.you.board.arsenal ?? []);
  const selectArsenal = useBattle((s) => s.selectArsenal);

  const byKind = new Map<ArsenalKind, ArsenalItem[]>();
  for (const spec of ARSENAL_SPEC) byKind.set(spec.kind, []);
  for (const item of arsenal) {
    if (item.used || item.destroyed) continue;
    byKind.get(item.kind)?.push(item);
  }

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityLabel="Close arsenal"
      />
      <View style={styles.panel}>
        <InkPanel
          w={CARD.w * 2 + 30}
          h={CARD.h * 5 + 40}
          seedKey="arsenal-popover"
          padding={space.xs}
        >
          <View style={styles.grid}>
            {ARSENAL_SPEC.map((spec) => (
              <Card
                key={spec.kind}
                kind={spec.kind}
                items={byKind.get(spec.kind) ?? []}
                onUse={(id) => selectArsenal(id)}
              />
            ))}
          </View>
        </InkPanel>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
  panel: { position: 'absolute', left: 60, top: 40 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  cardName: { flex: 1, color: color.ink, fontFamily: font.label, fontSize: typeScale.xs },
  cardCount: { color: color.ink, fontFamily: font.display, fontSize: typeScale.md, marginRight: 4 },
});
