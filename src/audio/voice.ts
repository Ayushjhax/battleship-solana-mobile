/**
 * The Captain's lines — assets/audio/voice/captain-NN.mp3, docs/assets.md 5.2.
 * Sources are null until the files land; a missing line is silent. The text
 * in the speech bubble always shows regardless.
 */
import { createAudioPlayer, type AudioPlayer, type AudioSource } from 'expo-audio';

import { useProfile } from '@/state/profile';

export const CAPTAIN_LINES: Record<number, AudioSource> = {
  1: null, // require('../../assets/audio/voice/captain-01.mp3')
  2: null, // require('../../assets/audio/voice/captain-02.mp3')
  3: null, // require('../../assets/audio/voice/captain-03.mp3')
  4: null, // require('../../assets/audio/voice/captain-04.mp3')
  5: null, // require('../../assets/audio/voice/captain-05.mp3')
  6: null, // require('../../assets/audio/voice/captain-06.mp3')
  7: null, // require('../../assets/audio/voice/captain-07.mp3')
  8: null, // require('../../assets/audio/voice/captain-08.mp3')
  9: null, // require('../../assets/audio/voice/captain-09.mp3')
  10: null, // require('../../assets/audio/voice/captain-10.mp3')
  11: null, // require('../../assets/audio/voice/captain-11.mp3')
  12: null, // require('../../assets/audio/voice/captain-12.mp3')
  13: null, // require('../../assets/audio/voice/captain-13.mp3')
  14: null, // require('../../assets/audio/voice/captain-14.mp3')
};

export const CAPTAIN_IDLE: AudioSource[] = [
  null, // require('../../assets/audio/voice/captain-idle-01.mp3')
  null, // require('../../assets/audio/voice/captain-idle-02.mp3')
  null, // require('../../assets/audio/voice/captain-idle-03.mp3')
];

let current: AudioPlayer | null = null;

export function playCaptainLine(n: number): void {
  const source = CAPTAIN_LINES[n];
  if (!source || !useProfile.getState().soundOn) return;
  try {
    current?.pause();
    current?.remove();
    current = createAudioPlayer(source);
    current.play();
  } catch (error) {
    console.warn(`[voice] could not play captain-${n}`, error);
  }
}

export function stopCaptain(): void {
  try {
    current?.pause();
    current?.remove();
  } catch {
    /* already gone */
  }
  current = null;
}
