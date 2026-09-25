/**
 * Sliced images. SlicedImage: left cap, stretched middle strip, right cap, for
 * any width. VSlicedImage: the same stood on end, for any height.
 * GridSlicedImage: any grid of cells, for frames whose ornaments must keep one
 * size across panels of different shapes. Caps keep their own shape (corners and icons never
 * distort); only the strip stretches. Cap sizes come from the cut files
 * themselves (scripts/color-assets.sh), never duplicated here.
 */
import { Image } from 'expo-image';
import { Image as RNImage, View, type ViewStyle } from 'react-native';

import type { Asset, GridCells, Slices, VSlices } from './assets';

/** How far the strip runs under each cap, so a fractional seam never shows a hairline. */
const SEAM = 0.6;

function aspect(asset: Asset): number {
  if (typeof asset !== 'number') return 1;
  const { width, height } = RNImage.resolveAssetSource(asset);
  return width && height ? width / height : 1;
}

/** The caps' widths in design units at height `h`. */
export function sliceCaps(slices: Slices, h: number): { left: number; right: number } {
  return { left: aspect(slices.left) * h, right: aspect(slices.right) * h };
}

export function SlicedImage({
  slices,
  w,
  h,
  style,
}: {
  slices: Slices;
  w: number;
  h: number;
  style?: ViewStyle;
}) {
  const caps = sliceCaps(slices, h);
  const mid = Math.max(0, w - caps.left - caps.right);
  return (
    <View pointerEvents="none" style={[{ width: w, height: h }, style]}>
      <Image
        source={slices.mid}
        contentFit="fill"
        cachePolicy="memory-disk"
        style={{ position: 'absolute', top: 0, height: h, left: caps.left - SEAM, width: mid + SEAM * 2 }}
      />
      <Image
        source={slices.left}
        contentFit="fill"
        cachePolicy="memory-disk"
        style={{ position: 'absolute', top: 0, left: 0, width: caps.left, height: h }}
      />
      <Image
        source={slices.right}
        contentFit="fill"
        cachePolicy="memory-disk"
        style={{ position: 'absolute', top: 0, right: 0, width: caps.right, height: h }}
      />
    </View>
  );
}

/** The caps' heights in design units at width `w`. */
export function vsliceCaps(slices: VSlices, w: number): { top: number; bottom: number } {
  return { top: w / aspect(slices.top), bottom: w / aspect(slices.bottom) };
}

export function VSlicedImage({
  slices,
  w,
  h,
  style,
}: {
  slices: VSlices;
  w: number;
  h: number;
  style?: ViewStyle;
}) {
  const caps = vsliceCaps(slices, w);
  const mid = Math.max(0, h - caps.top - caps.bottom);
  return (
    <View pointerEvents="none" style={[{ width: w, height: h }, style]}>
      <Image
        source={slices.mid}
        contentFit="fill"
        cachePolicy="memory-disk"
        style={{ position: 'absolute', left: 0, width: w, top: caps.top - SEAM, height: mid + SEAM * 2 }}
      />
      <Image
        source={slices.top}
        contentFit="fill"
        cachePolicy="memory-disk"
        style={{ position: 'absolute', left: 0, top: 0, width: w, height: caps.top }}
      />
      <Image
        source={slices.bottom}
        contentFit="fill"
        cachePolicy="memory-disk"
        style={{ position: 'absolute', left: 0, bottom: 0, width: w, height: caps.bottom }}
      />
    </View>
  );
}

function size(asset: Asset): { width: number; height: number } {
  if (typeof asset !== 'number') return { width: 1, height: 1 };
  const { width, height } = RNImage.resolveAssetSource(asset);
  return { width: width || 1, height: height || 1 };
}

/** Track sizes along one axis: fixed tracks at `k` per source px, stretch tracks share the rest. */
function tracks(src: readonly number[], stretch: readonly boolean[], k: number, total: number): number[] {
  const fixed = src.reduce((sum, s, i) => (stretch[i] ? sum : sum + s * k), 0);
  const stretchSrc = src.reduce((sum, s, i) => (stretch[i] ? sum + s : sum), 0);
  const slack = Math.max(0, total - fixed);
  return src.map((s, i) => (stretch[i] ? (stretchSrc > 0 ? (slack * s) / stretchSrc : 0) : s * k));
}

/**
 * A frame cut into a grid by scripts/color-assets.sh (grid_slice). Fixed cells
 * draw at `k` design units per source pixel — so two panels given the same `k`
 * wear the same corners and crown whatever their size — and the stretch rows
 * and columns take up the difference. Cells overlap by a hair so no fractional
 * seam ever shows the page through.
 */
export function GridSlicedImage({
  cells,
  stretchCols,
  stretchRows,
  k,
  w,
  h,
  style,
}: {
  cells: GridCells;
  stretchCols: readonly boolean[];
  stretchRows: readonly boolean[];
  k: number;
  w: number;
  h: number;
  style?: ViewStyle;
}) {
  const first = cells[0] ?? [];
  const colW = tracks(first.map((a) => size(a).width), stretchCols, k, w);
  const rowH = tracks(cells.map((row) => size(row[0] ?? null).height), stretchRows, k, h);
  const xs = colW.map((_, i) => colW.slice(0, i).reduce((a, b) => a + b, 0));
  const ys = rowH.map((_, i) => rowH.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <View pointerEvents="none" style={[{ width: w, height: h }, style]}>
      {cells.map((row, r) =>
        row.map((cell, c) => (
          <Image
            key={`${r}-${c}`}
            source={cell}
            contentFit="fill"
            cachePolicy="memory-disk"
            style={{
              position: 'absolute',
              left: (xs[c] ?? 0) - (c > 0 ? SEAM / 2 : 0),
              top: (ys[r] ?? 0) - (r > 0 ? SEAM / 2 : 0),
              width: (colW[c] ?? 0) + (c > 0 ? SEAM / 2 : 0) + (c < row.length - 1 ? SEAM / 2 : 0),
              height: (rowH[r] ?? 0) + (r > 0 ? SEAM / 2 : 0) + (r < cells.length - 1 ? SEAM / 2 : 0),
            }}
          />
        )),
      )}
    </View>
  );
}
