/**
 * The Captain's dialogue box. One rough polygon: a rectangle with a scalloped
 * edge and a tail pointing to the configured side. Bitter 700, centred,
 * auto-height. Enters at scale 0.9 with a 180 ms spring.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg from 'react-native-svg';

import { BUBBLE, bubbleOutline, type BubbleTail } from './geometry';
import { color, font, space, type as typeScale } from './tokens';
import { RoughShape, hashString, useRough, type Point } from './useRough';

export type { BubbleTail };

export interface SpeechBubbleProps {
  text: string;
  tail?: BubbleTail;
  /** Where along the tail's edge the tail sits, 0..1. */
  tailAt?: number;
  /** Width of the body, design units. */
  w?: number;
  seedKey?: string;
  style?: ViewStyle;
}

const PAD = space.sm;
const FONT_SIZE = typeScale.sm;
const LINE_H = Math.round(FONT_SIZE * 1.3);
const TAIL_LEN = BUBBLE.tailLen;

function estimateLines(text: string, innerW: number): number {
  const perLine = Math.max(1, Math.floor(innerW / (FONT_SIZE * 0.55)));
  return Math.max(1, Math.ceil(text.length / perLine));
}

export function SpeechBubble({
  text,
  tail = 'left',
  tailAt = 0.5,
  w = 260,
  seedKey,
  style,
}: SpeechBubbleProps) {
  const { roughPolygon } = useRough();
  const innerW = w - PAD * 2;
  const [textH, setTextH] = useState(() => estimateLines(text, innerW) * LINE_H);

  const bodyH = Math.max(40, textH + PAD * 2);
  // The tail pushes the body away from the SVG's edge on its side.
  const bodyX = tail === 'left' ? TAIL_LEN : 0;
  const bodyY = tail === 'top' ? TAIL_LEN : 0;
  const boxW = w + (tail === 'left' || tail === 'right' ? TAIL_LEN : 0);
  const boxH = bodyH + (tail === 'top' || tail === 'bottom' ? TAIL_LEN : 0);

  const seed = hashString(`bubble-${seedKey ?? text}`);
  const outline = roughPolygon(
    bubbleOutline(w, bodyH, tail, tailAt).map(([x, y]) => [x + bodyX + 4, y + bodyY + 4] as Point),
    {
      seed,
      fill: color.paper,
      fillStyle: 'solid',
      strokeWidth: 1.6,
      roughness: 0.7,
      bowing: 0.5,
      disableMultiStroke: true,
    },
  );

  const scale = useSharedValue(0.9);
  const opacity = useSharedValue(0);
  useEffect(() => {
    scale.value = withSpring(1, { duration: 180, dampingRatio: 0.65 });
    opacity.value = withTiming(1, { duration: 120 });
  }, [scale, opacity]);
  const entrance = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  const onTextLayout = (e: LayoutChangeEvent) => {
    const h = Math.ceil(e.nativeEvent.layout.height);
    if (h > 0 && h !== textH) setTextH(h);
  };

  // +8 leaves room for the scallops and the stroke past the body rectangle.
  const svgW = boxW + 8;
  const svgH = boxH + 8;

  return (
    <Animated.View style={[{ width: svgW, height: svgH }, entrance, style]}>
      <Svg
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        style={StyleSheet.absoluteFill}
      >
        <RoughShape paths={outline} />
      </Svg>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: bodyX + 4 + PAD,
          top: bodyY + 4 + PAD,
          width: innerW,
          minHeight: bodyH - PAD * 2,
          justifyContent: 'center',
        }}
      >
        <Text
          onLayout={onTextLayout}
          style={{
            color: color.ink,
            fontFamily: font.display,
            fontSize: FONT_SIZE,
            lineHeight: LINE_H,
            textAlign: 'center',
          }}
        >
          {text}
        </Text>
      </View>
    </Animated.View>
  );
}
