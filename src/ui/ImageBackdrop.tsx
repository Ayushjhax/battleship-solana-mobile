/**
 * A full-bleed illustrated page backdrop, layered over PaperBackdrop inside
 * <Scale>. expo-image decodes off the UI thread. PaperBackdrop stays mounted
 * underneath as the fallback: if an asset is missing, the grid still reads as
 * a page rather than a blank flash.
 *
 * It paints at once when a screen mounts — the route transition is the
 * transition, and a fade-in there only showed the fallback for 300 ms — and
 * crossfades only when the source changes under a screen already showing
 * (the boot's logo beat, matchmaking finding an opponent).
 */
import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import type { Asset } from './assets';

const CROSSFADE_MS = 300;

export function ImageBackdrop({
  source,
  onDisplay,
}: {
  source: Asset | undefined;
  onDisplay?: () => void;
}) {
  // React's "adjust state when a prop changes" pattern: the first source this
  // backdrop mounted with never fades; any later one does.
  const [shown, setShown] = useState(source);
  const [crossfade, setCrossfade] = useState(false);
  if (source !== shown) {
    setShown(source);
    setCrossfade(true);
  }

  if (!source) return null;
  return (
    <Image
      source={source}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      transition={crossfade ? CROSSFADE_MS : null}
      cachePolicy="memory-disk"
      pointerEvents="none"
      onDisplay={onDisplay}
    />
  );
}
