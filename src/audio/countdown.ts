import { AppState } from 'react-native';

import { haptic } from '@/audio/haptics';
import { setSfxLooping } from '@/audio/sfx';
import { useBattle } from '@/state/battle';

/** Follow the live store so firing/timeout stops feedback before the next render. */
export function watchBattleCountdown(): () => void {
  let foreground = AppState.currentState === 'active';
  let warning = false;
  let pulses: ReturnType<typeof setInterval> | undefined;
  let cutoff: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    warning = false;
    clearInterval(pulses);
    clearTimeout(cutoff);
    pulses = undefined;
    cutoff = undefined;
    setSfxLooping('finalCountdown', false);
  };

  const sync = () => {
    const state = useBattle.getState();
    const eligible = foreground && state.seconds > 0 && state.seconds <= 6 &&
      state.shown?.phase === 'playing' && state.shown.turn === state.me &&
      !state.animating && !state.pending && !state.aiming &&
      !state.fleetCovered && !state.finished;
    if (!eligible) {
      if (warning) stop();
      return;
    }
    if (warning) return;
    warning = true;
    setSfxLooping('finalCountdown', true);
    haptic('countdown');
    pulses = setInterval(() => haptic('countdown'), 500);
    // A stalled clock can never leave the native audio loop running forever.
    cutoff = setTimeout(stop, state.seconds * 1000);
  };

  const unsubscribe = useBattle.subscribe(sync);
  const appState = AppState.addEventListener('change', (next) => {
    foreground = next === 'active';
    // Online time can have expired while the JS thread was suspended.
    if (foreground && useBattle.getState().mode === 'online') useBattle.getState().tick();
    sync();
  });
  sync();
  return () => {
    unsubscribe();
    appState.remove();
    stop();
  };
}
