/**
 * What the store has unlocked, on the profile: a strip in the captain's panel
 * (the latest unlocks as thumbnails and a count) that opens the whole
 * collection — every item in every edition, bought ones in colour on their
 * edition's wash, the rest as grey silhouettes. Display only: nothing here
 * equips anything, and the sheet says so.
 */
import { Image } from 'expo-image';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { ArtButton } from '@/features/auth/LoginArt';
import { MenuCard } from '@/features/menu/MenuParts';
import { PROFILE_ART, SETTINGS_ART, STORE_ITEM_ART } from '@/ui/assets';
import { Scale } from '@/ui/Scale';
import { VSlicedImage } from '@/ui/SlicedImage';
import { CANVAS_H, CANVAS_W, artColor, font } from '@/ui/tokens';

import {
  COLOUR_NAME,
  STORE_COLOURS,
  STORE_ITEM_COUNT,
  STORE_ITEMS,
  unlockId,
  unlocksFrom,
} from './catalog';
import { COLOUR_INK, COLOUR_WASH } from './StoreParts';

const THUMB = 24;
const STRIP_THUMBS = 6;

export function CollectionStrip({
  unlocks,
  onPress,
}: {
  unlocks: readonly string[];
  onPress: () => void;
}) {
  const owned = unlocksFrom(unlocks);
  // Newest first: the order they were bought in, not catalogue order.
  const latest = [...unlocks]
    .reverse()
    .map((id) => owned.find((u) => u.id === id))
    .filter((u) => u !== undefined)
    .slice(0, STRIP_THUMBS);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Store collection, ${owned.length} of ${STORE_ITEM_COUNT} unlocked`}
      style={({ pressed }) => [styles.strip, pressed ? styles.pressed : null]}
    >
      <Text style={styles.stripLabel}>Collection</Text>
      <View style={styles.stripThumbs}>
        {latest.length > 0 ? (
          latest.map((u) => (
            <View key={u.id} style={styles.thumb}>
              <View style={StyleSheet.absoluteFill}>
                <MenuCard
                  w={THUMB}
                  h={THUMB + 3}
                  fill={COLOUR_WASH[u.colour]}
                  seedKey={`thumb-${u.item.key}`}
                  r={6}
                />
              </View>
              <Image
                source={STORE_ITEM_ART[u.colour][u.item.key] ?? null}
                style={styles.thumbArt}
                contentFit="contain"
                cachePolicy="memory-disk"
              />
            </View>
          ))
        ) : (
          <Text style={styles.stripEmpty} numberOfLines={1}>
            Nothing yet — colours unlock in the Store
          </Text>
        )}
      </View>
      <Text style={styles.stripCount}>
        {owned.length}/{STORE_ITEM_COUNT} ›
      </Text>
      <Image source={SETTINGS_ART.dashedDivider} style={styles.stripRule} contentFit="fill" />
    </Pressable>
  );
}

const SHEET = { w: 620, h: 300 } as const;
const CELL = 34;
const ROW_LABEL = 76;

export function CollectionDialog({
  visible,
  unlocks,
  onClose,
  onStore,
}: {
  visible: boolean;
  unlocks: readonly string[];
  onClose: () => void;
  onStore: () => void;
}) {
  const owned = new Set(unlocks);
  const count = unlocksFrom(unlocks).length;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.dim} accessibilityViewIsModal>
        <Scale transparent>
          <View style={styles.sheet}>
            <VSlicedImage
              slices={PROFILE_ART.accountPanel}
              w={SHEET.w}
              h={SHEET.h}
              style={StyleSheet.absoluteFill}
            />
            <Text style={styles.title}>Your collection</Text>
            <Text style={styles.subtitle}>
              {count} of {STORE_ITEM_COUNT} unlocked · equipping colours comes in a later update
            </Text>
            <View style={styles.rows}>
              {STORE_COLOURS.map((colour) => (
                <View key={colour} style={styles.row}>
                  <Text style={[styles.rowLabel, { color: COLOUR_INK[colour] }]}>
                    {COLOUR_NAME[colour]}
                  </Text>
                  {STORE_ITEMS.map((item) => {
                    const has = owned.has(unlockId(colour, item.key));
                    return (
                      <View
                        key={item.key}
                        style={styles.cell}
                        accessible
                        accessibilityLabel={`${COLOUR_NAME[colour]} ${item.name}, ${has ? 'unlocked' : 'locked'}`}
                      >
                        {has ? (
                          <View style={StyleSheet.absoluteFill}>
                            <MenuCard
                              w={CELL}
                              h={CELL}
                              fill={COLOUR_WASH[colour]}
                              seedKey={`collection-${item.key}`}
                              r={7}
                            />
                          </View>
                        ) : null}
                        <Image
                          source={STORE_ITEM_ART[colour][item.key] ?? null}
                          style={[styles.cellArt, has ? null : styles.locked]}
                          contentFit="contain"
                          cachePolicy="memory-disk"
                          tintColor={has ? undefined : '#8E96BE'}
                        />
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
            <View style={styles.actions}>
              <ArtButton
                slices={SETTINGS_ART.creamButton}
                w={104}
                h={34}
                label="Close"
                fontSize={15}
                onPress={onClose}
              />
              <ArtButton
                slices={SETTINGS_ART.creamButton}
                w={132}
                h={34}
                label="Visit the Store"
                fontSize={15}
                onPress={onStore}
              />
            </View>
          </View>
        </Scale>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  strip: { height: 30, flexDirection: 'row', alignItems: 'center', gap: 8 },
  pressed: { transform: [{ translateY: 1 }] },
  stripLabel: { color: artColor.label, fontFamily: font.body, fontSize: 13 },
  stripThumbs: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  thumb: { width: THUMB, height: THUMB + 3, alignItems: 'center', justifyContent: 'center' },
  thumbArt: { width: THUMB - 6, height: THUMB - 7, marginBottom: 3 },
  stripEmpty: { flexShrink: 1, color: artColor.muted, fontFamily: font.body, fontSize: 12 },
  stripCount: { color: artColor.ink, fontFamily: font.label, fontSize: 13 },
  stripRule: { position: 'absolute', left: 0, right: 0, bottom: -1, height: 3, opacity: 0.7 },
  dim: { flex: 1, backgroundColor: 'rgba(16,20,48,0.5)' },
  sheet: {
    position: 'absolute',
    left: (CANVAS_W - SHEET.w) / 2,
    top: (CANVAS_H - SHEET.h) / 2,
    width: SHEET.w,
    height: SHEET.h,
  },
  title: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 60,
    color: artColor.ink,
    fontFamily: font.display,
    fontSize: 21,
    textAlign: 'center',
  },
  subtitle: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 86,
    color: artColor.soft,
    fontFamily: font.body,
    fontSize: 12,
    textAlign: 'center',
  },
  rows: {
    position: 'absolute',
    left: (SHEET.w - ROW_LABEL - CELL * STORE_ITEMS.length - 3 * (STORE_ITEMS.length - 1)) / 2,
    top: 108,
    gap: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  rowLabel: { width: ROW_LABEL, fontFamily: font.display, fontSize: 14 },
  cell: { width: CELL, height: CELL, alignItems: 'center', justifyContent: 'center' },
  cellArt: { width: CELL - 8, height: CELL - 10, marginBottom: 3 },
  locked: { opacity: 0.45 },
  actions: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 22,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
  },
});
