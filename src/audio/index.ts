/**
 * App-wide audio mixer. The effects and the music are preloaded and their
 * players allocated during boot, so gameplay only seeks and starts an existing
 * player. The Captain's lines (the tutorial's) share ONE player, made the
 * first time a line plays.
 *
 * Every player is a native media player with its own playback thread and
 * decoder for the life of the app, and each wakes the UI thread on its own
 * status timer. So the pool holds only what a match can sound at once, and a
 * player reports on a change of state rather than twice a second
 * (STATUS_INTERVAL_MS). It used to be 56 players at expo-audio's default
 * 500 ms — ~110 wake-ups a second for the whole session, on the menu too, with
 * nothing playing — and a phone that never got to rest ran warm and, a few
 * games in, throttled. tests/regression/audio-pool.test.ts holds the line.
 */
import {
  createAudioPlayer,
  preload,
  setAudioModeAsync,
  setIsAudioActiveAsync,
  type AudioPlayer,
  type AudioSource,
} from 'expo-audio';

import { useProfile } from '@/state/profile';

export const SFX_SOURCES = {
  paperDrop: require('../../assets/audio/sfx/paper_drop.mp3') as AudioSource,
  penScratchLong: require('../../assets/audio/sfx/pen_scratch_long.mp3') as AudioSource,
  penScratchShort: require('../../assets/audio/sfx/pen_scratch_short.mp3') as AudioSource,
  uiTap: require('../../assets/audio/sfx/ui_tap.mp3') as AudioSource,
  shipPlace: require('../../assets/audio/sfx/ship_place.mp3') as AudioSource,
  shipInvalid: require('../../assets/audio/sfx/ship_invalid.mp3') as AudioSource,
  shotFire: require('../../assets/audio/sfx/shot_fire.mp3') as AudioSource,
  splash: require('../../assets/audio/sfx/splash.mp3') as AudioSource,
  explosion: require('../../assets/audio/sfx/explosion.mp3') as AudioSource,
  shipSink: require('../../assets/audio/sfx/ship_sink.mp3') as AudioSource,
  mine: require('../../assets/audio/sfx/mine.mp3') as AudioSource,
  planeFlyby: null,
  planeDown: require('../../assets/audio/sfx/plane_down.mp3') as AudioSource,
  bombDrop: require('../../assets/audio/sfx/bomb_drop.mp3') as AudioSource,
  nuke: require('../../assets/audio/sfx/nuke.mp3') as AudioSource,
  torpedo: require('../../assets/audio/sfx/torpedo.mp3') as AudioSource,
  radarPing: require('../../assets/audio/sfx/radar_ping.mp3') as AudioSource,
  subSurface: require('../../assets/audio/sfx/sub_surface.mp3') as AudioSource,
  turnTick: require('../../assets/audio/sfx/turn_tick.mp3') as AudioSource,
  finalCountdown: require('../../assets/audio/sfx/gmgmgm.mp3') as AudioSource,
  rankUp: require('../../assets/audio/sfx/rank_up.mp3') as AudioSource,
  coinFlow: require('../../assets/audio/sfx/coin_flow.mp3') as AudioSource,
  victory: require('../../assets/audio/sfx/victory.mp3') as AudioSource,
  defeat: require('../../assets/audio/sfx/defeat.mp3') as AudioSource,
} satisfies Record<string, AudioSource | null>;

export type SfxKey = keyof typeof SFX_SOURCES;
export type MusicKey = 'menu' | 'battle';

const MUSIC_SOURCES: Record<MusicKey, AudioSource> = {
  menu: require('../../assets/audio/music/music_menu.mp3') as AudioSource,
  battle: require('../../assets/audio/music/music_battle.mp3') as AudioSource,
};

const CAPTAIN_SOURCES: Record<number, AudioSource> = {
  1: require('../../assets/audio/voice/captain-01.mp3') as AudioSource,
  2: require('../../assets/audio/voice/captain-02.mp3') as AudioSource,
  3: require('../../assets/audio/voice/captain-03.mp3') as AudioSource,
  4: require('../../assets/audio/voice/captain-04.mp3') as AudioSource,
  5: require('../../assets/audio/voice/captain-05.mp3') as AudioSource,
  6: require('../../assets/audio/voice/captain-06.mp3') as AudioSource,
  7: require('../../assets/audio/voice/captain-07.mp3') as AudioSource,
  8: require('../../assets/audio/voice/captain-08.mp3') as AudioSource,
  9: require('../../assets/audio/voice/captain-09.mp3') as AudioSource,
  10: require('../../assets/audio/voice/captain-10.mp3') as AudioSource,
  11: require('../../assets/audio/voice/captain-11.mp3') as AudioSource,
  12: require('../../assets/audio/voice/captain-12.mp3') as AudioSource,
  13: require('../../assets/audio/voice/captain-13.mp3') as AudioSource,
  14: require('../../assets/audio/voice/captain-14.mp3') as AudioSource,
};

/**
 * Voices per effect. A full pool drops the next sound rather than cutting one
 * off — three explosions on top of each other read the same as five.
 */
export const POLYPHONY: Partial<Record<SfxKey, number>> = {
  explosion: 3,
  splash: 3,
  bombDrop: 3,
  penScratchShort: 2,
  uiTap: 2,
  torpedo: 2,
};

/**
 * How often a player reports its position to JS. Nothing here reads position
 * or progress; the one thing listened for — a line finishing — is reported on
 * the state change itself, not on this timer.
 */
export const STATUS_INTERVAL_MS = 60_000;

const VARIED = new Set<SfxKey>([
  'explosion',
  'splash',
  'bombDrop',
  'penScratchShort',
  'uiTap',
  'torpedo',
]);

const pools = new Map<SfxKey, AudioPlayer[]>();
const cursors = new Map<SfxKey, number>();
const loopingSfx = new Set<SfxKey>();
const loopRevisions = new Map<SfxKey, number>();
const music = new Map<MusicKey, AudioPlayer>();
/** The Captain's one voice, created on first use, and the line it holds. */
let voice: AudioPlayer | null = null;
let voiceSource: AudioSource | null = null;
let voicePlaying = false;
let desiredMusic: MusicKey | null = 'menu';
let activeMusic: MusicKey | null = null;
let ducked = false;
let initialized = false;
let active = true;
let initializing: Promise<void> | null = null;

function quiet<T>(work: () => T): T | undefined {
  try {
    return work();
  } catch {
    return undefined;
  }
}

function playerFor(source: AudioSource | null): AudioPlayer | null {
  return quiet(() => createAudioPlayer(source, { updateInterval: STATUS_INTERVAL_MS })) ?? null;
}

function countdownHasPriority(): boolean {
  const profile = useProfile.getState();
  return active && loopingSfx.has('finalCountdown') && profile.soundOn && profile.soundVolume > 0;
}

function effectVolume(id: SfxKey): number {
  const profile = useProfile.getState();
  if (!profile.soundOn || profile.soundVolume <= 0) return 0;
  if (countdownHasPriority()) return id === 'finalCountdown' ? 1 : 0;
  return profile.soundVolume;
}

function applyMix(): void {
  const profile = useProfile.getState();
  const priority = countdownHasPriority();
  for (const [id, group] of pools) {
    for (const player of group) player.volume = effectVolume(id);
  }
  const voiceVolume = profile.soundOn && !priority ? profile.soundVolume : 0;
  if (voice) voice.volume = voiceVolume;
  for (const player of music.values()) {
    player.volume = profile.musicOn && !priority ? profile.musicVolume * (ducked ? 0.3 : 1) : 0;
  }
  if (!profile.soundOn) stopVoice();
  for (const id of loopingSfx) syncLoopingSfx(id);
}

function syncLoopingSfx(id: SfxKey): void {
  const player = pools.get(id)?.[0];
  if (!player) return;

  const revision = (loopRevisions.get(id) ?? 0) + 1;
  loopRevisions.set(id, revision);
  const profile = useProfile.getState();
  const shouldPlay =
    initialized && active && loopingSfx.has(id) && profile.soundOn && profile.soundVolume > 0;

  if (!shouldPlay) {
    quiet(() => player.pause());
    return;
  }

  player.loop = true;
  player.volume = effectVolume(id);
  if (player.playing) return;
  void player.seekTo(0).then(
    () => {
      const latest = useProfile.getState();
      if (
        loopRevisions.get(id) === revision &&
        initialized &&
        active &&
        loopingSfx.has(id) &&
        latest.soundOn &&
        latest.soundVolume > 0
      ) {
        player.play();
      }
    },
    () => {},
  );
}

function createPlayers(): void {
  for (const [key, source] of Object.entries(SFX_SOURCES) as [SfxKey, AudioSource | null][]) {
    if (!source) continue;
    const group: AudioPlayer[] = [];
    for (let i = 0; i < (POLYPHONY[key] ?? 1); i++) {
      const player = playerFor(source);
      if (player) group.push(player);
    }
    if (group.length > 0) pools.set(key, group);
  }
  for (const [key, source] of Object.entries(MUSIC_SOURCES) as [MusicKey, AudioSource][]) {
    const player = playerFor(source);
    if (!player) continue;
    player.loop = true;
    music.set(key, player);
  }
}

function voicePlayer(): AudioPlayer | null {
  if (voice) return voice;
  const player = playerFor(null);
  if (!player) return null;
  player.addListener('playbackStatusUpdate', (status) => {
    if (status.didJustFinish && voicePlaying) {
      voicePlaying = false;
      duckMusic(false);
    }
  });
  voice = player;
  return player;
}

/** Called once by the root layout. Failures are intentionally silent. */
export function initializeAudio(): Promise<void> {
  if (initializing) return initializing;
  initializing = (async () => {
    // playsInSilentMode must be true: on Android `false` mutes everything while
    // the ringer is on vibrate/silent, which is how most people carry a phone.
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'mixWithOthers',
    }).catch(() => {});
    // The Captain's lines load when the tutorial speaks them, not at boot.
    const sources = [...Object.values(SFX_SOURCES), ...Object.values(MUSIC_SOURCES)].filter(
      (source): source is AudioSource => source !== null,
    );
    // A slow asset download must not hold every sound (including the warning)
    // hostage. Players load independently while the cache warms in parallel.
    void Promise.allSettled(sources.map((source) => preload(source)));
    createPlayers();
    initialized = true;
    applyMix();
    setMusic(desiredMusic);
  })().catch(() => {});
  return initializing;
}

export interface PlayOptions {
  readonly volume?: number;
  readonly rate?: number;
}

/** Starts a preallocated voice; saturated pools drop a sound instead of turning muddy. */
export function play(id: SfxKey, options: PlayOptions = {}): void {
  if (!initialized || !active) return;
  const profile = useProfile.getState();
  if (!profile.soundOn || profile.soundVolume <= 0) return;
  if (countdownHasPriority() && id !== 'finalCountdown') return;
  const group = pools.get(id);
  if (!group?.length) return;

  const start = cursors.get(id) ?? 0;
  let chosen = -1;
  for (let offset = 0; offset < group.length; offset++) {
    const index = (start + offset) % group.length;
    if (!group[index]!.playing) {
      chosen = index;
      break;
    }
  }
  if (chosen < 0) return;
  cursors.set(id, (chosen + 1) % group.length);

  const player = group[chosen]!;
  const variation = VARIED.has(id) ? 0.95 + Math.random() * 0.1 : 1;
  player.volume = Math.max(0, Math.min(1, effectVolume(id) * (options.volume ?? 1)));
  player.setPlaybackRate(Math.max(0.1, Math.min(2, (options.rate ?? 1) * variation)), 'low');
  void player.seekTo(0).then(
    () => {
      if (!active || !useProfile.getState().soundOn) return;
      player.volume = Math.max(0, Math.min(1, effectVolume(id) * (options.volume ?? 1)));
      if (player.volume > 0) player.play();
    },
    () => {},
  );
}

export const playSfx = play;

/** Starts or stops a preloaded effect as a continuous loop. */
export function setSfxLooping(id: SfxKey, value: boolean): void {
  const revision = (loopRevisions.get(id) ?? 0) + 1;
  loopRevisions.set(id, revision);

  if (value) {
    loopingSfx.add(id);
    if (initialized) applyMix();
    else void initializeAudio();
    return;
  }

  loopingSfx.delete(id);
  if (initialized) applyMix();
  const player = pools.get(id)?.[0];
  if (!player) return;
  player.loop = false;
  quiet(() => player.pause());
  void player.seekTo(0).catch(() => {});
}

export function setMusic(next: MusicKey | null): void {
  desiredMusic = next;
  if (!initialized || !active) return;
  const previous = activeMusic;
  if (previous && previous !== next) quiet(() => music.get(previous)?.pause());
  activeMusic = next;
  if (!next) return;
  const player = music.get(next);
  if (!player) return;
  applyMix();
  if (!player.playing) player.play();
}

export function duckMusic(value: boolean): void {
  ducked = value;
  applyMix();
}

export function playCaptainVoice(line: number): void {
  if (!initialized || !active || !useProfile.getState().soundOn) return;
  if (countdownHasPriority()) return;
  const source = CAPTAIN_SOURCES[line];
  if (!source) return;
  const player = voicePlayer();
  if (!player) return;
  stopVoice();
  if (voiceSource !== source) {
    quiet(() => player.replace(source));
    voiceSource = source;
  }
  voicePlaying = true;
  duckMusic(true);
  player.volume = useProfile.getState().soundVolume;
  void player.seekTo(0).then(
    () => {
      if (active && !countdownHasPriority() && useProfile.getState().soundOn) player.play();
    },
    () => duckMusic(false),
  );
}

export function stopVoice(): void {
  if (voicePlaying) quiet(() => voice?.pause());
  voicePlaying = false;
  if (ducked) {
    ducked = false;
    applyMix();
  }
}

export function refreshAudioSettings(): void {
  if (initialized) applyMix();
}

export function setAudioActive(value: boolean): void {
  active = value;
  if (!value) {
    for (const id of loopingSfx) syncLoopingSfx(id);
  }
  void setIsAudioActiveAsync(value).then(
    () => {
      if (value) {
        setMusic(desiredMusic);
        for (const id of loopingSfx) syncLoopingSfx(id);
      }
    },
    () => {},
  );
}
