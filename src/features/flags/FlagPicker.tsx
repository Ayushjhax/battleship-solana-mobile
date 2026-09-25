/**
 * The profile's flag picker: the twenty flags as badges on the account-panel
 * sheet, five across, under the sheet's anchor (its top cap grows with the
 * width, so everything starts below ~46). A tap picks at once (the badge pops, the pick is saved
 * and synced); Done or the back button closes it.
 */
import { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { haptic } from '@/audio/haptics';
import { ArtButton } from '@/features/auth/LoginArt';
import { MenuCard } from '@/features/menu/MenuParts';
import { PROFILE_ART, SETTINGS_ART } from '@/ui/assets';
import { Scale } from '@/ui/Scale';
import { VSlicedImage } from '@/ui/SlicedImage';
import { CANVAS_H, CANVAS_W, artColor, font } from '@/ui/tokens';

import { COUNTRIES, type Country } from './countries';
import { FlagBadge, flagBadgeHeight } from './FlagBadge';

const PANEL = { w: 484, h: 336 } as const;
const CELL = { w: 86, h: 48 } as const;
const COLS = 5;
const BADGE_W = 40;
const PICKED = '#FFF2C6';

function Cell({
  country,
  selected,
  onPick,
}: {
  country: Country;
  selected: boolean;
  onPick: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const pop = useSharedValue(1);
  useEffect(() => {
    if (selected && !reduceMotion) {
      pop.value = withSequence(
        withTiming(1.16, { duration: 110 }),
        withSpring(1, { damping: 8, stiffness: 260 }),
      );
    }
  }, [pop, reduceMotion, selected]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  return (
    <Pressable
      onPress={onPick}
      onPressIn={() => haptic('buttonPress')}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={country.name}
      style={styles.cell}
    >
      {selected ? (
        <View style={styles.picked} pointerEvents="none">
          <MenuCard
            w={CELL.w}
            h={CELL.h + 4}
            fill={PICKED}
            seedKey={`flag-pick-${country.code}`}
            r={9}
          />
        </View>
      ) : null}
      <Animated.View style={[styles.badge, style]}>
        <FlagBadge code={country.code} w={BADGE_W} />
        {selected ? (
          <Svg width={15} height={15} viewBox="0 0 15 15" style={styles.tick}>
            <Circle
              cx={7.5}
              cy={7.5}
              r={6.6}
              fill={artColor.green}
              stroke="#FFFDF6"
              strokeWidth={1.4}
            />
            <Path
              d="M4.4 7.8 L6.6 10 L10.6 5.4"
              stroke="#FFFDF6"
              strokeWidth={1.8}
              fill="none"
              strokeLinecap="round"
            />
          </Svg>
        ) : null}
      </Animated.View>
      <Text
        style={[styles.name, selected ? styles.nameSelected : null]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {country.name}
      </Text>
    </Pressable>
  );
}

export function FlagPicker({
  visible,
  selected,
  onPick,
  onClose,
}: {
  visible: boolean;
  selected: string;
  onPick: (code: string) => void;
  onClose: () => void;
}) {
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
          <View style={styles.panel}>
            <VSlicedImage
              slices={PROFILE_ART.accountPanel}
              w={PANEL.w}
              h={PANEL.h}
              style={StyleSheet.absoluteFill}
            />
            <Text style={styles.title}>Sail under a flag</Text>
            <View style={styles.grid} accessibilityRole="radiogroup">
              {COUNTRIES.map((country) => (
                <Cell
                  key={country.code}
                  country={country}
                  selected={country.code === selected.toUpperCase()}
                  onPick={() => onPick(country.code)}
                />
              ))}
            </View>
            <View style={styles.done}>
              <ArtButton
                slices={SETTINGS_ART.creamButton}
                w={104}
                h={34}
                label="Done"
                fontSize={15}
                onPress={onClose}
              />
            </View>
          </View>
        </Scale>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dim: { flex: 1, backgroundColor: 'rgba(16,20,48,0.5)' },
  panel: {
    position: 'absolute',
    left: (CANVAS_W - PANEL.w) / 2,
    top: (CANVAS_H - PANEL.h) / 2,
    width: PANEL.w,
    height: PANEL.h,
  },
  title: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 50,
    color: artColor.ink,
    fontFamily: font.display,
    fontSize: 21,
    textAlign: 'center',
  },
  grid: {
    position: 'absolute',
    left: (PANEL.w - CELL.w * COLS) / 2,
    top: 80,
    width: CELL.w * COLS,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: { width: CELL.w, height: CELL.h, alignItems: 'center', paddingTop: 2 },
  picked: { position: 'absolute', left: 0, top: -1, width: CELL.w, height: CELL.h + 4 },
  badge: { width: BADGE_W, height: flagBadgeHeight(BADGE_W) },
  tick: { position: 'absolute', right: -6, top: -5 },
  name: {
    maxWidth: CELL.w - 6,
    marginTop: 1,
    color: artColor.label,
    fontFamily: font.label,
    fontSize: 10.5,
    lineHeight: 12,
  },
  nameSelected: { color: artColor.green },
  done: { position: 'absolute', left: 0, right: 0, bottom: 18, alignItems: 'center' },
});
