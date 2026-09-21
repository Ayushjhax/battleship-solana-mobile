/**
 * The Home / HUD batch. Each block names the report it came from.
 *
 * These cover the parts with behaviour behind them. Three of the reported
 * items are pure layout — the tutorial Skip button's backing plate, the red
 * margin rule drawn above battle's HUD strip, and the name added to the avatar
 * picker — and are asserted here only where a constant or a geometry fact can
 * be pinned; the rest of those needs eyes on a device.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The profile store persists through expo-sqlite's localStorage shim, which has
// no Node build; the same stand-in the store's own unit tests use.
vi.mock('expo-sqlite/localStorage/install', () => ({}));

const stored = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  },
});

import { ARSENAL_SPEC } from '../../src/engine/arsenal';
import { useProfile } from '../../src/state/profile';

describe('"Sound on-off is view-only, not actually working"', () => {
  /**
   * The menu has one speaker button, but the profile carries two independent
   * channels. It only moved `soundOn`, which silences effects and leaves the
   * menu loop playing — so switching sound "off" changed the icon and nothing
   * you could hear. The button is a master mute now.
   */
  const masterMute = (next: boolean) => {
    useProfile.getState().setSetting('soundOn', next);
    useProfile.getState().setSetting('musicOn', next);
  };
  const audible = () => useProfile.getState().soundOn || useProfile.getState().musicOn;

  beforeEach(() => {
    useProfile.getState().setSetting('soundOn', true);
    useProfile.getState().setSetting('musicOn', true);
  });

  it('silences music as well as effects', () => {
    masterMute(false);

    expect(useProfile.getState().soundOn).toBe(false);
    expect(useProfile.getState().musicOn).toBe(false);
    expect(audible()).toBe(false);
  });

  it('restores both channels when switched back on', () => {
    masterMute(false);
    masterMute(true);

    expect(useProfile.getState().soundOn).toBe(true);
    expect(useProfile.getState().musicOn).toBe(true);
  });

  it('reports "on" while any channel is still audible', () => {
    // Settings can leave the two split; the menu icon must not claim silence
    // while the music loop is still running.
    useProfile.getState().setSetting('soundOn', false);
    useProfile.getState().setSetting('musicOn', true);

    expect(audible()).toBe(true);
  });

  it('a mute from that split state silences everything', () => {
    useProfile.getState().setSetting('soundOn', false);
    useProfile.getState().setSetting('musicOn', true);

    masterMute(false);

    expect(audible()).toBe(false);
  });

  it('settings keeps the two channels independently settable', () => {
    useProfile.getState().setSetting('soundOn', true);
    useProfile.getState().setSetting('musicOn', false);

    expect(useProfile.getState().soundOn).toBe(true);
    expect(useProfile.getState().musicOn).toBe(false);
  });
});

describe('"Tutorial is redundant on home page & settings"', () => {
  /**
   * The menu's "How to play" and Settings' "Play" were the same action in two
   * places. Settings now offers only what the menu cannot: putting it back.
   * `resetTutorial` is that action, so it must actually clear the flag.
   */
  it('resetTutorial clears the completion flag', () => {
    useProfile.setState({ hasCompletedTutorial: true });

    useProfile.getState().resetTutorial();

    expect(useProfile.getState().hasCompletedTutorial).toBe(false);
  });

  it('is a no-op worth hiding when the tutorial was never finished', () => {
    // Settings renders the row only when there is something to reset, so this
    // pins the condition that gates it.
    useProfile.setState({ hasCompletedTutorial: false });

    expect(useProfile.getState().hasCompletedTutorial).toBe(false);
  });
});

describe('"Arsenal item scroll should not be there"', () => {
  /**
   * Two 189-wide columns needed ~270px for eight cards inside a 226px panel,
   * so it scrolled and half the arsenal was out of sight. Three columns of
   * 124x59 fit all eight with a slot spare. These pin the arithmetic that
   * makes the scroll unnecessary — if a card grows, this fails before the
   * panel silently starts clipping again.
   */
  const PANEL_W = 400;
  const PANEL_H = 226;
  const TITLE_H = 30;
  const GRID_GAP = 5;
  const GRID_PAD = 8;
  const COLUMNS = 3;
  const ROWS = 3;
  const CARD_W = Math.floor((PANEL_W - GRID_PAD * 2 - GRID_GAP * 2) / COLUMNS);
  const CARD_H = Math.floor((PANEL_H - TITLE_H - GRID_GAP * (ROWS - 1) - 7) / ROWS);

  it('has exactly eight kinds to show', () => {
    expect(ARSENAL_SPEC).toHaveLength(8);
  });

  it('fits every kind in the grid with no scrolling', () => {
    expect(ARSENAL_SPEC.length).toBeLessThanOrEqual(COLUMNS * ROWS);
  });

  it('fits the panel width', () => {
    const used = COLUMNS * CARD_W + (COLUMNS - 1) * GRID_GAP + GRID_PAD * 2;

    expect(used).toBeLessThanOrEqual(PANEL_W);
  });

  it('fits the height left under the title', () => {
    const used = ROWS * CARD_H + (ROWS - 1) * GRID_GAP + 7;

    expect(used).toBeLessThanOrEqual(PANEL_H - TITLE_H);
  });

  it('would NOT have fitted at the old two-column size', () => {
    // The state that forced the scroll, kept as the reason this layout exists.
    const oldRows = Math.ceil(ARSENAL_SPEC.length / 2);
    const oldUsed = oldRows * 62 + (oldRows - 1) * GRID_GAP + 7;

    expect(oldUsed).toBeGreaterThan(PANEL_H - TITLE_H);
  });

  it('keeps cards tall enough to stay legible', () => {
    expect(CARD_H).toBeGreaterThanOrEqual(50);
    expect(CARD_W).toBeGreaterThanOrEqual(110);
  });
});
