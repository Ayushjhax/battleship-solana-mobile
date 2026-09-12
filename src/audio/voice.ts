/**
 * The Captain's lines — assets/audio/voice/captain-NN.mp3, docs/assets.md 5.2.
 * Sources are null until the files land; a missing line is silent. The text
 * in the speech bubble always shows regardless.
 */
import { playCaptainVoice, stopVoice } from './index';

export function playCaptainLine(n: number): void {
  playCaptainVoice(n);
}

export function stopCaptain(): void {
  stopVoice();
}
