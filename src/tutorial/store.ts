/**
 * Tutorial state: which beat is live, where the registered targets are on the
 * canvas, and the nudge/hand-restart counters that keep a wrong tap from ever
 * soft-locking a step.
 */
import { create } from 'zustand';

import { STEPS, type Step } from './script';

export interface TargetRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface TutorialData {
  active: boolean;
  stepIndex: number;
  /** Measured rects of registered elements, in canvas units. */
  targets: Record<string, TargetRect>;
  /** Bumped on every wrong tap or re-prompt: restarts the hand cursor. */
  handNonce: number;
  /** A short correction the Captain says instead of the line, or null. */
  nudge: string | null;
  wrongTaps: number;
  finished: boolean;
}

interface TutorialActions {
  start: () => void;
  advance: () => void;
  wrongTap: () => void;
  clearNudge: () => void;
  registerTarget: (ref: string, rect: TargetRect) => void;
  unregisterTarget: (ref: string) => void;
  finish: () => void;
  reset: () => void;
}

export type TutorialState = TutorialData & TutorialActions;

const EMPTY: TutorialData = {
  active: false,
  stepIndex: 0,
  targets: {},
  handNonce: 0,
  nudge: null,
  wrongTaps: 0,
  finished: false,
};

let nudgeTimer: ReturnType<typeof setTimeout> | null = null;

export const useTutorial = create<TutorialState>((set, get) => ({
  ...EMPTY,

  start: () => set({ ...EMPTY, active: true, targets: get().targets }),

  advance: () => {
    const next = get().stepIndex + 1;
    if (nudgeTimer) clearTimeout(nudgeTimer);
    if (next >= STEPS.length) {
      set({ finished: true, nudge: null });
      return;
    }
    set({ stepIndex: next, nudge: null, wrongTaps: 0, handNonce: get().handNonce + 1 });
  },

  wrongTap: () => {
    const step = STEPS[get().stepIndex];
    if (!step?.require || step.require.kind === 'wait') return;
    if (nudgeTimer) clearTimeout(nudgeTimer);
    set((s) => ({
      wrongTaps: s.wrongTaps + 1,
      nudge: step.nudge ?? 'Not there — where I am pointing.',
      handNonce: s.handNonce + 1,
    }));
    nudgeTimer = setTimeout(() => set({ nudge: null }), 1800);
  },

  clearNudge: () => set({ nudge: null }),

  registerTarget: (ref, rect) =>
    set((s) => {
      const prev = s.targets[ref];
      if (prev && prev.x === rect.x && prev.y === rect.y && prev.w === rect.w && prev.h === rect.h)
        return s;
      return { targets: { ...s.targets, [ref]: rect } };
    }),

  unregisterTarget: (ref) =>
    set((s) => {
      if (!(ref in s.targets)) return s;
      const targets = { ...s.targets };
      delete targets[ref];
      return { targets };
    }),

  finish: () => {
    if (nudgeTimer) clearTimeout(nudgeTimer);
    set({ finished: true, active: false, nudge: null });
  },

  reset: () => {
    if (nudgeTimer) clearTimeout(nudgeTimer);
    set({ ...EMPTY, targets: {} });
  },
}));

export function currentStep(state: Pick<TutorialData, 'stepIndex'>): Step {
  return STEPS[Math.min(state.stepIndex, STEPS.length - 1)] as Step;
}
