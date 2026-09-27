/**
 * Regression: "after a lot of games the game starts lagging and the phone
 * starts heating."
 *
 * Every expo-audio player is a native media player with its own playback
 * thread and decoder, alive for the whole session, and each one wakes the UI
 * thread on its own status timer. The mixer used to allocate 56 of them at
 * boot at expo-audio's default 500 ms — ~110 wake-ups a second on the menu
 * with nothing playing — including 14 players for the tutorial's lines and 3
 * "idle" lines nothing ever played. A phone that never rests runs warm and,
 * a few games in, throttles.
 *
 * This drives the real mixer (src/audio/index.ts) against a recording stand-in
 * for expo-audio and pins: how many players exist after boot, that none polls,
 * and that every Captain's line shares one player made on first use.
 */
import Module from 'node:module';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Metro turns `require('x.mp3')` into an asset id; here each file stands for
// itself, so every sound stays distinct.
(Module as unknown as {
  _extensions: Record<string, (module: { exports: unknown }, filename: string) => void>;
})._extensions['.mp3'] = (module, filename) => {
  module.exports = filename;
};

interface FakePlayer {
  source: unknown;
  options: { updateInterval?: number } | undefined;
  replaced: unknown[];
  volume: number;
  loop: boolean;
  playing: boolean;
  addListener: (event: string, listener: (status: { didJustFinish?: boolean }) => void) => { remove: () => void };
  play: () => void;
  pause: () => void;
  seekTo: (seconds: number) => Promise<void>;
  replace: (source: unknown) => void;
  setPlaybackRate: (rate: number) => void;
}

const created: FakePlayer[] = [];
const preloaded: unknown[] = [];

vi.mock('expo-audio', () => ({
  createAudioPlayer: (source: unknown, options?: { updateInterval?: number }) => {
    const player: FakePlayer = {
      source,
      options,
      replaced: [],
      volume: 1,
      loop: false,
      playing: false,
      addListener: () => ({ remove: () => {} }),
      play() {
        this.playing = true;
      },
      pause() {
        this.playing = false;
      },
      seekTo: async () => {},
      replace(next: unknown) {
        this.replaced.push(next);
      },
      setPlaybackRate: () => {},
    };
    created.push(player);
    return player;
  },
  preload: async (source: unknown) => {
    preloaded.push(source);
  },
  setAudioModeAsync: async () => {},
  setIsAudioActiveAsync: async () => {},
}));

vi.mock('../../src/state/profile', () => ({
  useProfile: {
    getState: () => ({ soundOn: true, soundVolume: 1, musicOn: true, musicVolume: 1 }),
  },
}));

async function bootAudio() {
  vi.resetModules();
  created.length = 0;
  preloaded.length = 0;
  const audio = await import('../../src/audio/index');
  await audio.initializeAudio();
  return audio;
}

describe('the audio pool', () => {
  beforeEach(() => {
    created.length = 0;
  });

  it('boots with only the effects and the music — a bounded pool, no voices', async () => {
    const audio = await bootAudio();
    const effects = Object.entries(audio.SFX_SOURCES).filter(([, source]) => source !== null);
    const expected =
      effects.reduce((n, [key]) => n + (audio.POLYPHONY[key as keyof typeof audio.SFX_SOURCES] ?? 1), 0) + 2;
    expect(created).toHaveLength(expected);
    expect(created.length).toBeLessThanOrEqual(34);
    // What boot preloads is exactly what boot plays from: effects and music.
    expect(preloaded).toHaveLength(effects.length + 2);
  });

  it('no player polls: status comes on a change of state, not twice a second', async () => {
    const audio = await bootAudio();
    audio.playCaptainVoice(1);
    for (const player of created) {
      expect(player.options?.updateInterval ?? 500).toBeGreaterThanOrEqual(10_000);
    }
  });

  it('every Captain line shares ONE player, made the first time a line plays', async () => {
    const audio = await bootAudio();
    const atBoot = created.length;
    audio.playCaptainVoice(1);
    expect(created).toHaveLength(atBoot + 1);
    const voice = created[created.length - 1] as FakePlayer;
    audio.playCaptainVoice(7);
    audio.playCaptainVoice(14);
    audio.playCaptainVoice(7);
    expect(created).toHaveLength(atBoot + 1);
    expect(voice.replaced).toHaveLength(4);
    // The same line twice in a row is not reloaded.
    audio.playCaptainVoice(7);
    expect(voice.replaced).toHaveLength(4);
    audio.stopVoice();
    expect(voice.playing).toBe(false);
  });

  it('a line that does not exist makes no player at all', async () => {
    const audio = await bootAudio();
    const atBoot = created.length;
    audio.playCaptainVoice(99);
    expect(created).toHaveLength(atBoot);
  });
});
