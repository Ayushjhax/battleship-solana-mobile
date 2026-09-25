/**
 * A panel skinned with a drawn-paper image instead of Rough.js strokes — for
 * the handful of panels with their own commissioned art (docs/assets.md).
 * Same shape as InkPanel (w, h, padding, children) so it drops in wherever
 * InkPanel was.
 */
import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import type { Asset } from './assets';
import { space } from './tokens';

export interface ImagePanelProps {
  source: Asset;
  w: number;
  h: number;
  /** Inner padding for children, design units. */
  padding?: number;
  style?: ViewStyle;
  children?: ReactNode;
}

export function ImagePanel({ source, w, h, padding = space.sm, style, children }: ImagePanelProps) {
  return (
    <View style={[{ width: w, height: h }, style]}>
      <Image source={source} style={StyleSheet.absoluteFill} contentFit="fill" cachePolicy="memory-disk" />
      {children ? <View style={{ flex: 1, padding }}>{children}</View> : null}
    </View>
  );
}
