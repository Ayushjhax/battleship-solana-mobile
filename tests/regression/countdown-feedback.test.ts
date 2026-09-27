import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  players: [] as Array<{
    source: string | null; volume: number; playing: boolean; loop: boolean;
    play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>;
    seekTo: ReturnType<typeof vi.fn>;
  }>,
  profile: { soundOn: true, soundVolume: 0.4, musicOn: true, musicVolume: 0.8, hapticsOn: true },
  impact: vi.fn(async () => {}),
  background: null as null | ((state: string) => void),
  state: {
    seconds: 7, me: 'one', shown: { phase: 'playing', turn: 'one' }, mode: 'ai',
    animating: false, pending: false, aiming: null as unknown,
    fleetCovered: false, finished: false, tick: vi.fn(),
  },
  listeners: new Set<() => void>(),
}));

vi.mock('expo-audio', () => ({
  createAudioPlayer: (source: string | null) => {
    const player = {
      source, volume: 1, playing: false, loop: false,
      play: vi.fn(() => { player.playing = true; }),
      pause: vi.fn(() => { player.playing = false; }),
      seekTo: vi.fn(async () => {}), setPlaybackRate: vi.fn(), addListener: vi.fn(),
      // The Captain's lines share one player that loads each line in turn.
      replace: vi.fn((next: string) => { player.source = next; }),
    };
    native.players.push(player);
    return player;
  },
  // Deliberately never settles: unrelated preloads must not block the alarm.
  preload: () => new Promise(() => {}),
  setAudioModeAsync: async () => {}, setIsAudioActiveAsync: async () => {},
}));
vi.mock('expo-haptics', () => ({
  impactAsync: native.impact, ImpactFeedbackStyle: { Heavy: 'heavy' },
}));
vi.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: (_event: string, listener: (state: string) => void) => {
      native.background = listener;
      return { remove: () => { native.background = null; } };
    },
  },
}));
vi.mock('@/state/profile', () => ({ useProfile: { getState: () => native.profile } }));
vi.mock('@/state/battle', () => ({
  useBattle: {
    getState: () => native.state,
    subscribe: (listener: () => void) => {
      native.listeners.add(listener);
      return () => native.listeners.delete(listener);
    },
  },
}));

const nodeRequire = createRequire(import.meta.url);
const previousMp3Loader = nodeRequire.extensions['.mp3'];
let cleanup: (() => void) | undefined;
const player = (file: string) => native.players.find((p) => p.source?.endsWith(file))!;
const update = async (patch: Partial<typeof native.state>) => {
  Object.assign(native.state, patch);
  native.listeners.forEach((listener) => listener());
  await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  native.players.length = 0;
  native.listeners.clear();
  native.impact.mockClear();
  Object.assign(native.profile, { soundOn: true, soundVolume: 0.4, hapticsOn: true });
  Object.assign(native.state, {
    seconds: 7, shown: { phase: 'playing', turn: 'one' }, mode: 'ai',
    animating: false, pending: false, aiming: null, fleetCovered: false, finished: false,
  });
  nodeRequire.extensions['.mp3'] = (module, filename) => { module.exports = filename; };
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  if (previousMp3Loader) nodeRequire.extensions['.mp3'] = previousMp3Loader;
  else delete nodeRequire.extensions['.mp3'];
  vi.useRealTimers();
});

async function start() {
  const audio = await import('@/audio');
  await audio.initializeAudio();
  audio.setMusic('battle');
  const { watchBattleCountdown } = await import('@/audio/countdown');
  cleanup = watchBattleCountdown();
  return audio;
}

describe('final six seconds: actual mixer + countdown controller + haptics', () => {
  it('plays only from 6 to 0, dominates music/effects/voice, then restores volume', async () => {
    const audio = await start();
    expect(player('gmgmgm.mp3').playing).toBe(false);
    audio.play('explosion');
    audio.playCaptainVoice(1);
    await vi.advanceTimersByTimeAsync(0);
    await update({ seconds: 6 });
    expect(player('gmgmgm.mp3')).toMatchObject({ playing: true, loop: true, volume: 1 });
    expect(player('music_battle.mp3').volume).toBe(0);
    expect(player('explosion.mp3').volume).toBe(0);
    expect(player('captain-01.mp3').volume).toBe(0);
    audio.play('uiTap');
    const voice = player('captain-01.mp3');
    const voicePlays = voice.play.mock.calls.length;
    audio.playCaptainVoice(2);
    expect(player('ui_tap.mp3').play).not.toHaveBeenCalled();
    // A new line neither loads nor starts while the countdown holds the mix.
    expect(player('captain-02.mp3')).toBeUndefined();
    expect(voice.play).toHaveBeenCalledTimes(voicePlays);
    for (let seconds = 5; seconds >= 0; seconds--) {
      await vi.advanceTimersByTimeAsync(1000);
      await update({ seconds });
    }
    expect(player('gmgmgm.mp3')).toMatchObject({ playing: false, loop: false });
    expect(player('gmgmgm.mp3').play).toHaveBeenCalledTimes(1);
    expect(native.impact).toHaveBeenCalledTimes(12);
    expect(native.impact).toHaveBeenCalledWith('heavy');
    expect(player('explosion.mp3').volume).toBe(0.4);
    expect(player('music_battle.mp3').volume).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(native.impact).toHaveBeenCalledTimes(12);
  });

  it.each([
    { animating: true }, { pending: true }, { aiming: { r: 0, c: 0 } },
    { fleetCovered: true }, { finished: true }, { seconds: 20 },
    { shown: { phase: 'over', turn: 'one' } },
    { shown: { phase: 'playing', turn: 'two' } },
  ])('stops immediately when the turn becomes ineligible: %j', async (patch) => {
    await start();
    await update({ seconds: 6 });
    await update(patch);
    expect(player('gmgmgm.mp3').playing).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(native.impact).toHaveBeenCalledTimes(1);
  });

  it('cancels background feedback and cleans up all timers on screen exit', async () => {
    await start();
    await update({ seconds: 6 });
    native.background?.('background');
    expect(player('gmgmgm.mp3').playing).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(native.impact).toHaveBeenCalledTimes(1);
    native.background?.('active');
    await vi.advanceTimersByTimeAsync(0);
    expect(player('gmgmgm.mp3').playing).toBe(true);
    cleanup?.();
    expect(player('gmgmgm.mp3').playing).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(native.listeners.size).toBe(0);
  });

  it('respects sound/haptics toggles independently', async () => {
    const audio = await start();
    native.profile.soundOn = false;
    await update({ seconds: 6 });
    expect(player('gmgmgm.mp3').playing).toBe(false);
    expect(native.impact).toHaveBeenCalledTimes(1);
    native.profile.soundOn = true;
    native.profile.hapticsOn = false;
    audio.refreshAudioSettings();
    await vi.advanceTimersByTimeAsync(1000);
    expect(player('gmgmgm.mp3').playing).toBe(true);
    expect(native.impact).toHaveBeenCalledTimes(1);
  });

  it('cannot restart a canceled warning when its asynchronous seek completes', async () => {
    await start();
    let resolveSeek: (() => void) | undefined;
    player('gmgmgm.mp3').seekTo.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveSeek = resolve;
    }));
    await update({ seconds: 6 });
    await update({ seconds: 0 });
    resolveSeek?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(player('gmgmgm.mp3').play).not.toHaveBeenCalled();
  });
});
