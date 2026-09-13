/**
 * Registers an element as a tutorial target. Spread the result onto the
 * element's root View; its measured rect (in canvas units) lands in the
 * tutorial store under `ref`. Nothing is hardcoded — if a layout moves, the
 * spotlight and the hand cursor move with it.
 *
 *   const target = useTutorialTarget('arsenal-tab');
 *   <View {...target}>…</View>
 *
 * The rect is measured RELATIVE TO THE SCALE CANVAS (measureLayout against
 * Scale's canvasRef), which is canvas units by construction. Window
 * coordinates are not used: on Android they can carry a system-inset offset
 * the view tree never applied, and converting them back through the Scale
 * maths then lands every target tens of units up and left — the spotlight
 * over open water, the real cell under a guard, every tap "wrong".
 *
 * Measuring only happens while the tutorial is active, so the hook costs
 * nothing in a normal match. While active it re-measures on layout, shortly
 * after the tutorial starts (screens are still settling), and on every step.
 */
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { View } from 'react-native';

import { useScale } from '@/ui/Scale';
import { useTutorial } from './store';

export interface TutorialTargetProps {
  ref: RefObject<View | null>;
  onLayout: () => void;
}

/** Delays after activation at which every target measures itself again. */
const SETTLE_MS = [0, 250, 700] as const;

export function useTutorialTarget(ref: string | undefined): TutorialTargetProps {
  const viewRef = useRef<View | null>(null);
  const { canvasRef } = useScale();
  const active = useTutorial((s) => s.active);

  const measure = useCallback(() => {
    if (!ref || !active) return;
    const view = viewRef.current;
    const canvas = canvasRef.current;
    if (!view || !canvas) return;
    view.measureLayout(
      canvas,
      (x, y, w, h) => {
        if (w === 0 && h === 0) return;
        useTutorial.getState().registerTarget(ref, { x, y, w, h });
      },
      () => {
        /* not mounted under this canvas yet — the next layout pass measures */
      },
    );
  }, [ref, active, canvasRef]);

  // Re-measure when the tutorial turns on, a few times while the screen settles.
  useEffect(() => {
    if (!active) return;
    const timers = SETTLE_MS.map((ms) => setTimeout(measure, ms));
    return () => timers.forEach(clearTimeout);
  }, [active, measure]);

  // And on every beat, again a few times: a target that moved since (a
  // dropped ship) is current, and one that is still sliding in (the arsenal
  // popover's cards) gets measured once it has landed.
  useEffect(() => {
    if (!active) return;
    let timers: ReturnType<typeof setTimeout>[] = [];
    const unsubscribe = useTutorial.subscribe((state, previous) => {
      if (state.stepIndex === previous.stepIndex) return;
      timers.forEach(clearTimeout);
      timers = SETTLE_MS.map((ms) => setTimeout(measure, ms));
    });
    return () => {
      unsubscribe();
      timers.forEach(clearTimeout);
    };
  }, [active, measure]);

  useEffect(
    () => () => {
      if (ref) useTutorial.getState().unregisterTarget(ref);
    },
    [ref],
  );

  return { ref: viewRef, onLayout: measure };
}
