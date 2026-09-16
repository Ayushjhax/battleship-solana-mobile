import { useMemo } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type TextInputProps,
} from 'react-native';
import Svg from 'react-native-svg';

import { color, font, space, type as typeScale } from './tokens';
import { RoughShape, hashString, useRough } from './useRough';

export interface InkTextInputProps
  extends Pick<
    TextInputProps,
    | 'accessibilityLabel'
    | 'autoCapitalize'
    | 'autoComplete'
    | 'autoCorrect'
    | 'editable'
    | 'inputMode'
    | 'maxLength'
    | 'onBlur'
    | 'onFocus'
    | 'onSubmitEditing'
    | 'returnKeyType'
    | 'textContentType'
  > {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  seedKey: string;
  w: number;
  h?: number;
  keyboardType?: KeyboardTypeOptions;
}

export function InkTextInput({
  value,
  onChangeText,
  placeholder,
  seedKey,
  w,
  h = 42,
  editable = true,
  ...props
}: InkTextInputProps) {
  const { roughRect } = useRough();
  const border = useMemo(
    () =>
      roughRect(2, 2, w - 4, h - 4, {
        seed: hashString(`input-${seedKey}`),
        stroke: editable ? color.ink : color.inkFaint,
        strokeWidth: 1.4,
        fill: color.paper,
        fillStyle: 'solid',
      }),
    [editable, h, roughRect, seedKey, w],
  );

  return (
    <View style={{ width: w, height: h, opacity: editable ? 1 : 0.65 }}>
      <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={StyleSheet.absoluteFill}>
        <RoughShape paths={border} />
      </Svg>
      <TextInput
        {...props}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={color.inkFaint}
        selectionColor={color.inkSoft}
        editable={editable}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    flex: 1,
    color: color.ink,
    fontFamily: font.body,
    fontSize: typeScale.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 0,
  },
});
