/**
 * Registers an element as a tutorial target. Spread the result onto the
 * element's root View; its measured rect (in canvas units) lands in the
 * tutorial store under `ref`. Nothing is hardcoded — if a layout moves, the
 * spotlight and the hand cursor move with it.
 *
 *   const target = useTutorialTarget('arsenal-tab');
 *   <View {...target}>…</View>
 *
 * Measuring only happens while the tutorial is active, so the hook costs
 * nothing in a normal match.
 */
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { View } from 'react-native';

import { useScale } from '@/ui/Scale';
import { useTutorial } from './store';

export interface TutorialTargetProps {
  ref: RefObject<View | null>;
  onLayout: () => void;
}

export function useTutorialTarget(ref: string | undefined): TutorialTargetProps {
  const viewRef = useRef<View | null>(null);
  const { scale, toCanvas } = useScale();
  const active = useTutorial((s) => s.active);

  const measure = useCallback(() => {
    if (!ref || !active) return;
    const view = viewRef.current;
    if (!view) return;
    view.measureInWindow((x, y, w, h) => {
      if (w === 0 && h === 0) return;
      const p = toCanvas(x, y);
      useTutorial.getState().registerTarget(ref, { x: p.x, y: p.y, w: w / scale, h: h / scale });
    });
  }, [ref, active, scale, toCanvas]);

  // Re-measure when the tutorial turns on (the layout may already be settled).
  useEffect(() => {
    if (!active) return;
    const id = setTimeout(measure, 0);
    return () => clearTimeout(id);
  }, [active, measure]);

  useEffect(
    () => () => {
      if (ref) useTutorial.getState().unregisterTarget(ref);
    },
    [ref],
  );

  return { ref: viewRef, onLayout: measure };
}
