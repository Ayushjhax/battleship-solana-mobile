import { create } from 'zustand';

/**
 * 'skipped' means there is nothing to wake — no server URL configured, or the
 * device is offline — so the app must carry on rather than block on it.
 */
export type WakePhase = 'idle' | 'waking' | 'awake' | 'unreachable' | 'skipped';

interface BackendWakeState {
  phase: WakePhase;
  /** When the current wake began, so the UI can count the wait out loud. */
  startedAt: number | null;
  attempts: number;
  error: string | null;
  /**
   * The player chose to carry on without the server. Offline play is the whole
   * point of a local-first game, so this can never be an inescapable wall.
   */
  dismissed: boolean;
  begin: () => void;
  noteAttempt: (attempts: number) => void;
  succeed: () => void;
  fail: (error: string) => void;
  skip: () => void;
  dismiss: () => void;
  reset: () => void;
}

export const useBackendWake = create<BackendWakeState>((set) => ({
  phase: 'idle',
  startedAt: null,
  attempts: 0,
  error: null,
  dismissed: false,
  begin: () => set({ phase: 'waking', startedAt: Date.now(), attempts: 0, error: null }),
  noteAttempt: (attempts) => set({ attempts }),
  succeed: () => set({ phase: 'awake', error: null }),
  fail: (error) => set({ phase: 'unreachable', error }),
  skip: () => set({ phase: 'skipped' }),
  dismiss: () => set({ dismissed: true }),
  reset: () => set({ phase: 'idle', startedAt: null, attempts: 0, error: null }),
}));
