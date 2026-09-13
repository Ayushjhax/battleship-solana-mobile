/**
 * The 800 x 360 virtual canvas — docs/brief.md 5.4.
 *
 *   scale   = min(screenW / 800, screenH / 360)
 *   offsetX = (screenW - 800 * scale) / 2
 *   offsetY = (screenH - 360 * scale) / 2
 *
 * (with the safe-area insets taken off screenW/screenH first, so a display
 * cutout in landscape never covers the canvas.)
 *
 * Every screen is authored in 800 x 360 design units inside <Scale> and never
 * reads raw pixel dimensions again. useScale() gives the few things that need
 * real pixels — hit targets, haptic-free maths — s(n) = n * scale.
 *
 * What the screen has left over around the canvas is paper too: PaperBackdrop
 * continues the sheet's rules outward so the whole display is one page
 * (`backdrop="plain"` for the boot, whose sheet inks its own rules in).
 *
 * `canvasRef` is the 800 x 360 box itself. Measuring an element relative to
 * it (measureLayout) yields canvas units directly, which is what the
 * tutorial's spotlight uses — window coordinates on Android can carry an
 * inset offset the layout never applied, and toCanvas() cannot know that.
 */
import { createContext, useContext, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PaperBackdrop } from './PaperBackdrop';
import { CANVAS_H, CANVAS_W, color } from './tokens';

export interface ScaleValue {
  /** Real pixels per design unit. */
  readonly scale: number;
  /** Screen x of the canvas's left edge. */
  readonly ox: number;
  /** Screen y of the canvas's top edge. */
  readonly oy: number;
  /** Design units -> real pixels. */
  readonly s: (n: number) => number;
  /** Screen point -> canvas point. Use for raw touch coordinates. */
  readonly toCanvas: (x: number, y: number) => { x: number; y: number };
  /** The 800 x 360 box; null outside a <Scale>. */
  readonly canvasRef: RefObject<View | null>;
}

const identity: ScaleValue = {
  scale: 1,
  ox: 0,
  oy: 0,
  s: (n) => n,
  toCanvas: (x, y) => ({ x, y }),
  canvasRef: { current: null },
};

const ScaleContext = createContext<ScaleValue>(identity);

export function useScale(): ScaleValue {
  return useContext(ScaleContext);
}

export function Scale({
  children,
  transparent = false,
  backdrop = 'paper',
}: {
  children?: ReactNode;
  transparent?: boolean;
  /** 'paper' continues the rules around the canvas; 'plain' is a bare sheet. */
  backdrop?: 'paper' | 'plain';
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const canvasRef = useRef<View | null>(null);

  const value = useMemo<ScaleValue>(() => {
    const availW = Math.max(1, width - insets.left - insets.right);
    const availH = Math.max(1, height - insets.top - insets.bottom);
    const scale = Math.min(availW / CANVAS_W, availH / CANVAS_H);
    const ox = insets.left + (availW - CANVAS_W * scale) / 2;
    const oy = insets.top + (availH - CANVAS_H * scale) / 2;
    return {
      scale,
      ox,
      oy,
      s: (n) => n * scale,
      toCanvas: (x, y) => ({ x: (x - ox) / scale, y: (y - oy) / scale }),
      canvasRef,
    };
  }, [width, height, insets.left, insets.right, insets.top, insets.bottom]);

  const { scale, ox, oy } = value;

  return (
    <ScaleContext.Provider value={value}>
      <View
        pointerEvents={transparent ? 'box-none' : 'auto'}
        style={{
          flex: 1,
          backgroundColor: transparent ? 'transparent' : color.paper,
          overflow: 'hidden',
        }}
      >
        {transparent ? null : (
          <PaperBackdrop
            width={width}
            height={height}
            scale={scale}
            ox={ox}
            oy={oy}
            rules={backdrop === 'paper'}
          />
        )}
        <View
          ref={canvasRef}
          pointerEvents={transparent ? 'box-none' : 'auto'}
          style={{
            position: 'absolute',
            // RN scales about the centre, so place the unscaled box such that
            // its scaled top-left lands exactly on (ox, oy).
            left: ox - (CANVAS_W * (1 - scale)) / 2,
            top: oy - (CANVAS_H * (1 - scale)) / 2,
            width: CANVAS_W,
            height: CANVAS_H,
            transform: [{ scale }],
          }}
        >
          {children}
        </View>
      </View>
    </ScaleContext.Provider>
  );
}
