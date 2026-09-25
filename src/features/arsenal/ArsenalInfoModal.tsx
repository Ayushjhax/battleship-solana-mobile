/**
 * An arsenal item's rules, in the radar mockup's modal: the name, which group
 * it is (and so when it is used), a 5 x 5 diagram of what it hits, the rule
 * in a sentence, its price. Drawn by the placement screen over the board.
 *
 * The diagram is the radar art's own: its paper, its pale blue rules, and its
 * hatched square (BATTLE_ART.diagramCell) on each cell the item marks.
 */
import { specFor } from '@engine/arsenal';
import type { ArsenalKind } from '@engine/types';
import { Image } from 'expo-image';
import { useEffect } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Line } from 'react-native-svg';

import { ArtImageButton } from '@/ui/ArtImageButton';
import { BATTLE_ART } from '@/ui/assets';
import { artColor, font } from '@/ui/tokens';
import { ARSENAL_GROUP, ARSENAL_INFO, ARSENAL_NAMES, GROUP_COPY, diagramCells } from './catalog';

export const INFO_W = 300;
export const INFO_H = INFO_W * (364 / 552);
const GRID = 100;
const STEP = GRID / 5;
/** Sampled from the radar diagram: its paper and its two rule blues. */
const DIAGRAM_PAPER = '#F4EAD9';
const DIAGRAM_RULE = '#7DB5CF';

function EffectDiagram({ kind }: { kind: ArsenalKind }) {
  const cells = diagramCells(kind);
  return (
    <View style={styles.diagram}>
      <Svg width={GRID} height={GRID} viewBox={`0 0 ${GRID} ${GRID}`} style={StyleSheet.absoluteFill}>
        {Array.from({ length: 6 }, (_, i) => (
          <Line key={`v${i}`} x1={i * STEP} y1={0} x2={i * STEP} y2={GRID} stroke={DIAGRAM_RULE} strokeWidth={1} />
        ))}
        {Array.from({ length: 6 }, (_, i) => (
          <Line key={`h${i}`} x1={0} y1={i * STEP} x2={GRID} y2={i * STEP} stroke={DIAGRAM_RULE} strokeWidth={1} />
        ))}
      </Svg>
      {cells.map(([r, c]) => (
        <Image
          key={`${r},${c}`}
          source={BATTLE_ART.diagramCell}
          style={[styles.cell, { left: c * STEP + 1.5, top: r * STEP + 1.5 }]}
          contentFit="fill"
        />
      ))}
    </View>
  );
}

export function ArsenalInfoModal({
  kind,
  left,
  top,
  onClose,
}: {
  kind: ArsenalKind;
  left: number;
  top: number;
  onClose: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const enter = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    enter.value = withTiming(1, { duration: reduceMotion ? 0 : 200, easing: Easing.out(Easing.back(1.4)) });
  }, [enter, kind, reduceMotion]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: 10 * (1 - enter.value) }, { scale: 0.92 + 0.08 * enter.value }],
  }));

  const spec = specFor(kind);
  const group = ARSENAL_GROUP[kind];
  const copy = GROUP_COPY[group];

  return (
    <Animated.View style={[styles.modal, { left, top }, style]} accessibilityViewIsModal>
      <Image source={BATTLE_ART.infoModal} style={StyleSheet.absoluteFill} contentFit="fill" />
      <Text style={styles.title} accessibilityRole="header">
        {ARSENAL_NAMES[kind]}
      </Text>
      <Text style={styles.group} numberOfLines={1}>
        <Text style={group === 'attack' ? styles.red : styles.green}>{copy.title}</Text>
        {` · ${copy.line}`}
      </Text>
      <EffectDiagram kind={kind} />
      <Text style={styles.rules}>{ARSENAL_INFO[kind]}</Text>
      <Text style={styles.price}>
        {`Costs ${spec.cost} fuel · up to ${spec.max}`}
      </Text>
      <Image source={BATTLE_ART.compass} style={styles.compass} contentFit="contain" />
      <ArtImageButton source={BATTLE_ART.close} w={84} h={84 * (74 / 180)} label="Close" onPress={onClose} style={styles.closeButton} />
      <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} onPress={onClose} style={styles.closeX}>
        <Image source={BATTLE_ART.closeX} style={StyleSheet.absoluteFill} contentFit="contain" />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  modal: { position: 'absolute', width: INFO_W, height: INFO_H, zIndex: 80 },
  title: {
    position: 'absolute',
    left: 30,
    right: 30,
    top: 11,
    color: artColor.red,
    fontFamily: font.display,
    fontSize: 21,
    textAlign: 'center',
  },
  group: {
    position: 'absolute',
    left: 20,
    right: 20,
    top: 38,
    color: artColor.soft,
    fontFamily: font.label,
    fontSize: 11,
    textAlign: 'center',
  },
  red: { color: artColor.red, fontFamily: font.display },
  green: { color: artColor.green, fontFamily: font.display },
  diagram: {
    position: 'absolute',
    left: 22,
    top: 58,
    width: GRID,
    height: GRID,
    backgroundColor: DIAGRAM_PAPER,
  },
  cell: { position: 'absolute', width: STEP - 3, height: STEP - 3 },
  rules: {
    position: 'absolute',
    left: 138,
    right: 18,
    top: 60,
    color: artColor.navy,
    fontFamily: font.body,
    fontSize: 13,
    lineHeight: 17,
  },
  price: {
    position: 'absolute',
    left: 138,
    right: 18,
    top: 132,
    color: artColor.soft,
    fontFamily: font.label,
    fontSize: 11,
  },
  compass: { position: 'absolute', left: 20, bottom: 12, width: 24, height: 24, opacity: 0.85 },
  closeButton: { position: 'absolute', right: 16, bottom: 12 },
  closeX: { position: 'absolute', right: 13, top: 12, width: 16, height: 16 },
});
