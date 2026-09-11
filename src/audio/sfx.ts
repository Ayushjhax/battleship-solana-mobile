/**
 * One-shot sound effects. Sources are `null` until the files from
 * docs/assets.md 5.1 land (Metro needs require() targets to exist); a missing
 * effect is a silent no-op, so the game never waits on audio.
 *
 * P16 owns mixing, music loops and the settings toggles' behaviour.
 */
import { createAudioPlayer, type AudioPlayer, type AudioSource } from 'expo-audio';

import { useProfile } from '@/state/profile';

export const SFX_SOURCES = {
  paperDrop: null as AudioSource, // require('../../assets/audio/sfx/paper_drop.mp3')
  penScratchLong: null as AudioSource, // require('../../assets/audio/sfx/pen_scratch_long.mp3')
  penScratchShort: null as AudioSource, // require('../../assets/audio/sfx/pen_scratch_short.mp3')
  uiTap: null as AudioSource, // require('../../assets/audio/sfx/ui_tap.mp3')
  // The source file currently has a duplicated extension; keep the registry
  // honest so placement audio works without renaming a supplied asset.
  shipPlace: require('../../assets/audio/sfx/ship_place.mp3.mp3') as AudioSource,
  shipInvalid: require('../../assets/audio/sfx/ship_invalid.mp3') as AudioSource,
  shotFire: null as AudioSource, // require('../../assets/audio/sfx/shot_fire.mp3')
  splash: null as AudioSource, // require('../../assets/audio/sfx/splash.mp3')
  explosion: null as AudioSource, // require('../../assets/audio/sfx/explosion.mp3')
  shipSink: null as AudioSource, // require('../../assets/audio/sfx/ship_sink.mp3')
  mine: null as AudioSource, // require('../../assets/audio/sfx/mine.mp3')
  planeFlyby: null as AudioSource, // require('../../assets/audio/sfx/plane_flyby.mp3')
  planeDown: null as AudioSource, // require('../../assets/audio/sfx/plane_down.mp3')
  bombDrop: null as AudioSource, // require('../../assets/audio/sfx/bomb_drop.mp3')
  nuke: null as AudioSource, // require('../../assets/audio/sfx/nuke.mp3')
  torpedo: null as AudioSource, // require('../../assets/audio/sfx/torpedo.mp3')
  radarPing: null as AudioSource, // require('../../assets/audio/sfx/radar_ping.mp3')
  subSurface: null as AudioSource, // require('../../assets/audio/sfx/sub_surface.mp3')
  turnTick: null as AudioSource, // require('../../assets/audio/sfx/turn_tick.mp3')
  rankUp: null as AudioSource, // require('../../assets/audio/sfx/rank_up.mp3')
  victory: null as AudioSource, // require('../../assets/audio/sfx/victory.mp3')
  defeat: null as AudioSource, // require('../../assets/audio/sfx/defeat.mp3')
};

export type SfxKey = keyof typeof SFX_SOURCES;

const players = new Map<SfxKey, AudioPlayer>();

export function playSfx(key: SfxKey): void {
  if (!useProfile.getState().soundOn) return;
  const source = SFX_SOURCES[key];
  if (!source) return;

  try {
    let player = players.get(key);
    if (!player) {
      player = createAudioPlayer(source);
      players.set(key, player);
    }
    void player.seekTo(0);
    player.play();
  } catch (error) {
    console.warn(`[sfx] could not play ${key}`, error);
  }
}
