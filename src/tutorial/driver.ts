/**
 * Runs the script: plays each beat's voice, performs the automatic actions,
 * and watches the REAL stores (battle, placement) for the thing the beat
 * requires. When it happens, the tutorial advances. If the player taps the
 * wrong thing, the overlay's swallow layer calls wrongTap(); if nothing
 * happens for a while, a watchdog re-prompts — no beat can soft-lock.
 */
import { sameCoord } from '@engine/board';
import type { Coord, MatchEvent } from '@engine/types';
import { useEffect } from 'react';

import { playCaptainLine, stopCaptain } from '@/audio/voice';
import { useBattle } from '@/state/battle';
import { usePlacement } from '@/state/placement';
import { AUTO_ACTIONS, STEPS, type Requirement } from './script';
import { useTutorial } from './store';

const WATCHDOG_MS = 20000;

function targetOf(action: ReturnType<typeof useBattle.getState>['lastAction']): Coord | undefined {
  if (!action) return undefined;
  if (action.type === 'FIRE') return action.at;
  if (action.type === 'USE_ARSENAL') return action.at;
  return undefined;
}

function warnIfUnexpected(
  expected: readonly MatchEvent['type'][] | undefined,
  events: readonly MatchEvent[],
): void {
  if (!expected) return;
  const seen = new Set(events.map((e) => e.type));
  const missing = expected.filter((t) => !seen.has(t));
  if (missing.length > 0) {
    console.warn(
      `[tutorial] expected ${missing.join(', ')} but the engine produced ${[...seen].join(', ')}`,
    );
  }
}

/** Resolves once the battle queue is idle (immediately if it already is). */
function whenBattleIdle(run: () => void): () => void {
  if (!useBattle.getState().animating) {
    run();
    return () => {};
  }
  const unsub = useBattle.subscribe((b) => {
    if (!b.animating) {
      unsub();
      run();
    }
  });
  return unsub;
}

function watchRequirement(req: Requirement, complete: () => void): () => void {
  const cleanups: (() => void)[] = [];

  switch (req.kind) {
    case 'wait': {
      cleanups.push(
        whenBattleIdle(() => {
          const t = setTimeout(complete, req.ms);
          cleanups.push(() => clearTimeout(t));
        }),
      );
      break;
    }

    case 'tap-cell': {
      const startMoves = useBattle.getState().match?.moves ?? 0;
      cleanups.push(
        useBattle.subscribe((b) => {
          const at = targetOf(b.lastAction);
          if (!at || !sameCoord(at, req.coord)) return;
          if ((b.match?.moves ?? 0) <= startMoves) return;
          if (b.animating) return;
          complete();
        }),
      );
      break;
    }

    case 'tap-element': {
      if (req.ref === 'arsenal-tab') {
        cleanups.push(useBattle.subscribe((b) => b.arsenalOpen && complete()));
      } else if (
        req.ref.startsWith('card-') &&
        STEPS.some((s) => s.screen === 'battle' && s.require === req)
      ) {
        const kind = req.ref.slice(5).toLowerCase();
        cleanups.push(
          useBattle.subscribe((b) => b.targeting?.kind.toLowerCase() === kind && complete()),
        );
      } else if (req.ref.startsWith('ship-')) {
        const shipId = req.ref.slice(5);
        const before = usePlacement.getState().ships.find((s) => s.id === shipId)?.orientation;
        cleanups.push(
          usePlacement.subscribe((p) => {
            const ship = p.ships.find((s) => s.id === shipId);
            if (ship && before && ship.orientation !== before) complete();
          }),
        );
      } else if (req.ref.startsWith('card-')) {
        const kind = req.ref.slice(5).toLowerCase();
        cleanups.push(
          usePlacement.subscribe((p) => {
            const pending = p.arsenal.find((i) => i.id === p.pendingArsenalId);
            if (pending && pending.kind.toLowerCase() === kind) complete();
          }),
        );
      }
      break;
    }

    case 'drag-ship': {
      let lastWrong = '';
      cleanups.push(
        usePlacement.subscribe((p) => {
          const ship = p.ships.find((s) => s.id === req.shipId);
          if (!ship) return;
          if (sameCoord(ship.origin, req.to)) {
            complete();
            return;
          }
          const key = `${ship.origin.r},${ship.origin.c}`;
          if (key !== lastWrong) {
            lastWrong = key;
            useTutorial.getState().wrongTap();
          }
        }),
      );
      break;
    }

    case 'place-item': {
      cleanups.push(
        usePlacement.subscribe((p) => {
          if (p.arsenal.some((i) => i.kind === req.itemKind && i.at !== undefined)) complete();
        }),
      );
      break;
    }
  }

  return () => cleanups.forEach((c) => c());
}

export function useTutorialDriver(onFinish: () => void): void {
  const active = useTutorial((s) => s.active);
  const stepIndex = useTutorial((s) => s.stepIndex);
  const finished = useTutorial((s) => s.finished);

  useEffect(() => {
    if (finished) onFinish();
  }, [finished, onFinish]);

  useEffect(() => {
    if (!active) return;
    const step = STEPS[stepIndex];
    if (!step) return;

    const cleanups: (() => void)[] = [];
    let done = false;
    const complete = () => {
      if (done) return;
      done = true;
      const b = useBattle.getState();
      if (step.screen === 'battle') warnIfUnexpected(step.forceOutcome, b.lastEvents);
      cleanups.forEach((c) => c());
      useTutorial.getState().advance();
    };

    if (step.say?.voice) playCaptainLine(step.say.voice);

    if (step.prepare === 'clear-fleet') {
      // The placement screen auto-places a fleet on mount; the lesson starts empty.
      // Its mount effect runs before this one, so the next tick is safe.
      const t = setTimeout(() => usePlacement.getState().clearFleet(), 0);
      cleanups.push(() => clearTimeout(t));
    }

    if (step.auto) {
      const action = AUTO_ACTIONS[step.auto];
      cleanups.push(whenBattleIdle(() => useBattle.getState().act(action)));
    }

    if (!step.require) {
      complete();
      return () => cleanups.forEach((c) => c());
    }

    // Give an automatic action's events a tick to enqueue before watching.
    const start = setTimeout(
      () => cleanups.push(watchRequirement(step.require as Requirement, complete)),
      step.auto ? 50 : 0,
    );
    cleanups.push(() => clearTimeout(start));

    if (step.require.kind !== 'wait') {
      const watchdog = setInterval(() => useTutorial.getState().wrongTap(), WATCHDOG_MS);
      cleanups.push(() => clearInterval(watchdog));
    }

    return () => {
      cleanups.forEach((c) => c());
      stopCaptain();
    };
  }, [active, stepIndex]);
}
