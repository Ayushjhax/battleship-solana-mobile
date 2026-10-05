/**
 * Lets a screen's "go" action through once, until the screen is focused
 * again. Pure, so the guard itself is testable without React Native.
 *
 * A fast double tap on Battle! used to run the launch twice: two battle (or
 * searching) screens on the stack, and two turn clocks ticking one match's
 * timer at double speed (BUG-006). The placement screen takes the guard just
 * before it navigates and reopens it in a focus effect.
 */
export interface OncePerFocus {
  /** True the first time; false until reopen(). */
  take(): boolean;
  reopen(): void;
}

export function createOncePerFocus(): OncePerFocus {
  let open = true;
  return {
    take() {
      if (!open) return false;
      open = false;
      return true;
    },
    reopen() {
      open = true;
    },
  };
}
