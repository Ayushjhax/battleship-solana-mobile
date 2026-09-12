/** Two local captains, one device. Names live only in the placement session. */
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg from 'react-native-svg';

import { usePlacement } from '@/state/placement';
import { InkButton } from '@/ui/InkButton';
import { InkKeyboard } from '@/ui/InkKeyboard';
import { InkPanel } from '@/ui/InkPanel';
import { Paper } from '@/ui/Paper';
import { Scale } from '@/ui/Scale';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';
import { RoughShape, hashString, roughRect } from '@/ui/useRough';

const MAX_LEN = 14;
const KEYBOARD_H = 198;
const FIELD_W = 250;
const FIELD_H = 44;

function NameField({
  label,
  value,
  active,
  onPress,
}: {
  label: string;
  value: string;
  active: boolean;
  onPress: () => void;
}) {
  const frame = roughRect(2, 2, FIELD_W - 4, FIELD_H - 4, {
    seed: hashString(`hotseat-name-${label}`),
    stroke: active ? color.inkGreen : color.ink,
    strokeWidth: active ? 2.2 : 1.6,
    fill: color.paper,
    fillStyle: 'solid',
    roughness: 1.5,
  });
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}. Tap to edit.`}
        accessibilityState={{ selected: active }}
        onPress={onPress}
        style={styles.field}
      >
        <Svg width={FIELD_W} height={FIELD_H} viewBox={`0 0 ${FIELD_W} ${FIELD_H}`}>
          <RoughShape paths={frame} />
        </Svg>
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.fieldValueWrap]}>
          <Text numberOfLines={1} style={styles.fieldValue}>
            {value}
          </Text>
          {active ? <View style={styles.caret} /> : null}
        </View>
      </Pressable>
    </View>
  );
}

export default function HotseatNamesScreen() {
  const router = useRouter();
  const stored = usePlacement.getState();
  const [one, setOne] = useState(stored.playerOneName || 'Player 1');
  const [two, setTwo] = useState(stored.playerTwoName || 'Player 2');
  const [active, setActive] = useState<1 | 2>(1);
  const valid = one.trim().length > 0 && two.trim().length > 0;

  const continueToPlacement = useCallback(() => {
    if (!valid) return;
    usePlacement.getState().setHotseatNames(one, two);
    router.push('/placement?mode=hotseat');
  }, [one, router, two, valid]);

  const submitKey = useCallback(() => {
    if (active === 1) setActive(2);
    else continueToPlacement();
  }, [active, continueToPlacement]);

  return (
    <Scale>
      <Paper variant="full" />
      <View style={styles.back}>
        <InkButton label="↩" size="lg" w={54} h={48} onPress={() => router.back()} />
      </View>
      <View style={styles.panel}>
        <InkPanel w={610} h={148} seedKey="hotseat-names" padding={space.sm}>
          <Text style={styles.title}>Name both captains</Text>
          <View style={styles.fields}>
            <NameField
              label="Player 1"
              value={one}
              active={active === 1}
              onPress={() => setActive(1)}
            />
            <NameField
              label="Player 2"
              value={two}
              active={active === 2}
              onPress={() => setActive(2)}
            />
          </View>
          <View style={styles.continue}>
            <InkButton
              label="Place fleets"
              tone="confirm"
              size="sm"
              w={142}
              h={40}
              disabled={!valid}
              onPress={continueToPlacement}
            />
          </View>
        </InkPanel>
      </View>
      <View style={styles.keyboard}>
        <InkKeyboard
          value={active === 1 ? one : two}
          onChange={active === 1 ? setOne : setTwo}
          onSubmit={submitKey}
          maxLength={MAX_LEN}
          w={CANVAS_W}
          h={KEYBOARD_H}
        />
      </View>
    </Scale>
  );
}

const styles = StyleSheet.create({
  back: { position: 'absolute', left: 8, top: 0 },
  panel: { position: 'absolute', left: 95, top: 6, width: 610, height: 148 },
  title: {
    color: color.ink,
    fontFamily: font.display,
    fontSize: typeScale.md,
    textAlign: 'center',
  },
  fields: {
    marginTop: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: space.sm,
  },
  fieldGroup: { width: FIELD_W },
  fieldLabel: { color: color.inkSoft, fontFamily: font.label, fontSize: typeScale.xs },
  field: { width: FIELD_W, height: FIELD_H },
  fieldValueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.sm,
  },
  fieldValue: { color: color.ink, fontFamily: font.display, fontSize: typeScale.md },
  caret: { width: 2, height: 22, marginLeft: 2, backgroundColor: color.inkGreen },
  continue: { position: 'absolute', left: 234, bottom: -1 },
  keyboard: { position: 'absolute', left: 0, top: CANVAS_H - KEYBOARD_H },
});
