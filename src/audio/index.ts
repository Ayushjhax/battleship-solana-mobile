/**
 * App-wide audio mixer. Every local source is preloaded and every player is
 * allocated during boot; gameplay only seeks and starts an existing player.
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

const CAPTAIN_IDLE_SOURCES: readonly AudioSource[] = [
  require('../../assets/audio/voice/captain-idle-01.mp3') as AudioSource,
  require('../../assets/audio/voice/captain-idle-02.mp3') as AudioSource,
  require('../../assets/audio/voice/captain-idle-03.mp3') as AudioSource,
];

const POLYPHONY: Partial<Record<SfxKey, number>> = {
  explosion: 5,
  splash: 4,
  bombDrop: 4,
  penScratchShort: 3,
  uiTap: 3,
  torpedo: 2,
};

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
const music = new Map<MusicKey, AudioPlayer>();
const voices = new Map<number, AudioPlayer>();
let idleVoices: AudioPlayer[] = [];
let currentVoice: AudioPlayer | null = null;
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

function playerFor(source: AudioSource): AudioPlayer | null {
  return quiet(() => createAudioPlayer(source, { updateInterval: 500 })) ?? null;
}

function applyMix(): void {
  const profile = useProfile.getState();
  for (const group of pools.values()) {
    for (const player of group) player.volume = profile.soundOn ? profile.soundVolume : 0;
  }
  for (const player of voices.values()) player.volume = profile.soundOn ? profile.soundVolume : 0;
  for (const player of idleVoices) player.volume = profile.soundOn ? profile.soundVolume : 0;
  for (const player of music.values()) {
    player.volume = profile.musicOn ? profile.musicVolume * (ducked ? 0.3 : 1) : 0;
  }
  if (!profile.soundOn) stopVoice();
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
  for (const [line, source] of Object.entries(CAPTAIN_SOURCES)) {
    const player = playerFor(source);
    if (!player) continue;
    player.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish && currentVoice === player) {
        currentVoice = null;
        duckMusic(false);
      }
    });
    voices.set(Number(line), player);
  }
  idleVoices = CAPTAIN_IDLE_SOURCES.map(playerFor).filter(
    (player): player is AudioPlayer => player !== null,
  );
}

/** Called once by the root layout. Failures are intentionally silent. */
export function initializeAudio(): Promise<void> {
  if (initializing) return initializing;
  initializing = (async () => {
    await setAudioModeAsync({
      playsInSilentMode: false,
      shouldPlayInBackground: false,
      interruptionMode: 'mixWithOthers',
    }).catch(() => {});
    const sources = [
      ...Object.values(SFX_SOURCES),
      ...Object.values(MUSIC_SOURCES),
      ...Object.values(CAPTAIN_SOURCES),
      ...CAPTAIN_IDLE_SOURCES,
    ].filter((source): source is AudioSource => source !== null);
    await Promise.allSettled(sources.map((source) => preload(source)));
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
  player.volume = Math.max(0, Math.min(1, profile.soundVolume * (options.volume ?? 1)));
  player.setPlaybackRate(Math.max(0.1, Math.min(2, (options.rate ?? 1) * variation)), 'low');
  void player.seekTo(0).then(
    () => player.play(),
    () => {},
  );
}

export const playSfx = play;

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
  const player = voices.get(line);
  if (!player) return;
  stopVoice();
  currentVoice = player;
  duckMusic(true);
  player.volume = useProfile.getState().soundVolume;
  void player.seekTo(0).then(
    () => player.play(),
    () => duckMusic(false),
  );
}

export function stopVoice(): void {
  if (currentVoice) quiet(() => currentVoice?.pause());
  currentVoice = null;
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
  void setIsAudioActiveAsync(value).then(
    () => {
      if (value) setMusic(desiredMusic);
    },
    () => {},
  );
}
