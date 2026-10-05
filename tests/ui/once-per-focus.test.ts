/**
 * BUG-006: a fast double tap on Battle! ran the launch twice — two battle (or
 * searching) screens on the stack, two turn clocks ticking one match's timer
 * at double speed. The placement screen now lets one launch through until it
 * is focused again.
 */
import { describe, expect, it } from 'vitest';

import { createOncePerFocus } from '../../src/ui/oncePerFocus';

describe('createOncePerFocus', () => {
  it('lets the first launch through and refuses the rest', () => {
    const launch = createOncePerFocus();
    expect(launch.take()).toBe(true);
    expect(launch.take()).toBe(false);
    expect(launch.take()).toBe(false);
  });

  it('opens again when the screen is focused again', () => {
    const launch = createOncePerFocus();
    launch.take();
    launch.reopen();
    expect(launch.take()).toBe(true);
  });
});
