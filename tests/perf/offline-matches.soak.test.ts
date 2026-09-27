/**
 * Soak: many OFFLINE matches against the AI in one app session, measured —
 * the half repeated-matches.soak (online) does not cover.
 *
 * Every match runs through shipped code: the battle store and its LocalMatch
 * AI, the EventPlayer (headless: commit only), the FX store, and the way out
 * the battle screen takes — `routeAfterMatch()`, then, for a loss, the
 * reveal session the reveal screen opens and leaves. Matches alternate: a win
 * (every enemy ship sunk, straight to the result) and a resignation (a loss,
 * through the winner's-base reveal). After each, the screen's unmount is
 * replayed (`reset()`, `useFx.clear()`) and the resting state is snapshotted:
 * live timers, store subscriptions, EventPlayer listeners and sleepers, what
 * the FX and reveal stores still hold, and the heap after a forced GC (when
 * node runs with --expose-gc).
 *
 *   NODE_OPTIONS=--expose-gc SOAK_MATCHES=30 npx vitest run tests/perf/offline-matches.soak.test.ts
 */
import { autoPlaceFleet } from '@engine/placement';
import { createRng } from '@engine/rng';
import type { Coord, Ship } from '@engine/types';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-sqlite/localStorage/install', () => ({}));
vi.mock('../../src/net/api', () => ({
  getAccessToken: vi.fn(async () => ({ ok: true as const, value: 'me' })),
}));
vi.mock('../../src/state/profile', () => ({
  useProfile: { getState: () => ({ userId: 'me', setUserId: () => {}, queueResult: () => {} }) },
}));
vi.mock('../../src/state/points', () => ({
  usePoints: { getState: () => ({ activeWager: null, sync: () => {}, finishWager: () => {} }) },
}));

const MATCHES = Number(process.env.SOAK_MATCHES ?? 6);
const ME = 'me';
const AI = 'ai-captain';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate: () => boolean, what: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

/** Counts live subscriptions on a zustand store by wrapping its subscribe. */
function countSubscriptions(store: { subscribe: (...args: never[]) => () => void }): () => number {
  let live = 0;
  const original = store.subscribe.bind(store) as (...args: unknown[]) => () => void;
  (store as { subscribe: unknown }).subscribe = (...args: unknown[]) => {
    live += 1;
    const off = original(...args);
    let on = true;
    return () => {
      if (on) live -= 1;
      on = false;
      off();
    };
  };
  return () => live;
}

function timersAlive(): number {
  return process.getActiveResourcesInfo().filter((kind) => kind === 'Timeout').length;
}

function heapMb(): number {
  (globalThis as { gc?: () => void }).gc?.();
  return Math.round((process.memoryUsage().heapUsed / 1048576) * 10) / 10;
}

function cellsOf(ship: Ship): Coord[] {
  return Array.from({ length: ship.len }, (_, i) =>
    ship.orientation === 'h'
      ? { r: ship.origin.r, c: ship.origin.c + i }
      : { r: ship.origin.r + i, c: ship.origin.c },
  );
}

describe('many offline matches in one session', () => {
  it(
    'leave nothing running or held between matches',
    async () => {
      const battle = await import('../../src/state/battle');
      const { useFx } = await import('../../src/fx/fxStore');
      const { useMatchClient } = await import('../../src/net/match-client');
      const { routeAfterMatch } = await import('../../src/features/reveal/afterMatch');
      const { revealWinner } = await import('../../src/features/reveal/plan');
      const { useReveal } = await import('../../src/features/reveal/revealStore');
      const { useBattle, battlePlayer, selectOpponent, setAiThinkTime } = battle;
      setAiThinkTime(0, 0);

      const battleSubs = countSubscriptions(useBattle);
      const clientSubs = countSubscriptions(useMatchClient);
      const player = battlePlayer as unknown as { listeners: Set<unknown>; sleepers: Set<unknown> };

      const rows: string[] = ['match\toutcome\ttimers\tbattleSubs\tclientSubs\tbusyListeners\tsleepers\tfx\treveal\theapMb'];
      const snapshots: { timers: number; heap: number }[] = [];
      let revealed = 0;

      for (let n = 0; n <= MATCHES; n += 1) {
        if (n > 0) {
          const win = n % 2 === 1;
          const mine = autoPlaceFleet(createRng(1000 + n)) as Ship[];
          const theirs = autoPlaceFleet(createRng(2000 + n)) as Ship[];
          useBattle.getState().start({
            mode: 'ai',
            ruleset: 'classic',
            seed: 500 + n,
            difficulty: 'normal',
            one: { id: ME, name: 'Me', points: 0, avatarId: 1, avatarColor: '', countryCode: 'IN', ships: mine, arsenal: [] },
            two: { id: AI, name: 'Berhan', points: 13365, avatarId: 3, avatarColor: '', countryCode: 'RU', ships: theirs, arsenal: [] },
          });

          if (win) {
            // Every shot a hit, so once it is our turn the turn never passes back.
            for (const at of theirs.flatMap(cellsOf)) {
              await until(() => {
                const s = useBattle.getState();
                return s.finished || (s.shown?.turn === ME && !s.animating && !s.aiming && s.shown.phase === 'playing');
              }, `our turn (match ${n})`);
              if (useBattle.getState().finished) break;
              useBattle.getState().aim(at);
              await until(() => !useBattle.getState().aiming, 'the shot to fly');
            }
          } else {
            // A few turns each way, then resign: a loss, so the reveal path.
            for (let shot = 0; shot < 3; shot += 1) {
              await until(() => {
                const s = useBattle.getState();
                return s.shown?.turn === ME && !s.animating && !s.aiming;
              }, `our turn (match ${n})`);
              const marks = useBattle.getState().shown?.enemy.marks ?? {};
              const free = Array.from({ length: 100 }, (_, i) => ({ r: Math.floor(i / 10), c: i % 10 })).find(
                (c) => !marks[`${c.r},${c.c}`],
              ) as Coord;
              useBattle.getState().aim(free);
              await until(() => !useBattle.getState().aiming, 'the shot to fly');
            }
            await until(() => !useBattle.getState().animating, 'the board to settle');
            useBattle.getState().act({ type: 'RESIGN', playerId: ME });
          }
          await until(() => useBattle.getState().finished, `match ${n} to finish`);

          // The battle screen's way out, exactly as battle.tsx calls it.
          const s = useBattle.getState();
          const them = selectOpponent(s);
          let target: string | null | undefined;
          const cancel = routeAfterMatch({
            key: s.resultId,
            facts: { mode: s.mode, tutorial: false, ownerId: s.ownerId, winnerId: s.shown?.winner, opponentId: them?.id },
            winner: them ? revealWinner(them) : null,
            match: s.match,
            go: (key) => {
              target = key;
            },
          });
          expect(target).toBe(win ? null : s.resultId);
          if (target) {
            // The reveal screen: start the five seconds, then leave once.
            revealed += 1;
            expect(useReveal.getState().session?.board.ships).toHaveLength(theirs.length);
            useReveal.getState().start(target, Date.now());
            expect(useReveal.getState().leave(target)).toBe(true);
          }
          cancel();
          // …and the battle screen unmounting.
          useBattle.getState().reset();
          useFx.getState().clear();
          await sleep(30);
        }

        const fx = useFx.getState();
        const fxHeld =
          fx.shells.length + fx.sprites.length + fx.aircraft.length + fx.bombs.length + fx.torpedoes.length + fx.stamps.length;
        const reveal = useReveal.getState();
        const snap = {
          timers: timersAlive(),
          battleSubs: battleSubs(),
          clientSubs: clientSubs(),
          busyListeners: player.listeners.size,
          sleepers: player.sleepers.size,
          fx: fxHeld,
          reveal: (reveal.session ? 1 : 0) + reveal.opened.length + reveal.left.length,
          heap: heapMb(),
        };
        snapshots.push({ timers: snap.timers, heap: snap.heap });
        rows.push(
          [n, n === 0 ? 'fresh' : n % 2 === 1 ? 'win' : 'loss', snap.timers, snap.battleSubs, snap.clientSubs, snap.busyListeners, snap.sleepers, snap.fx, snap.reveal, snap.heap].join('\t'),
        );

        if (n > 0) {
          expect(snap.battleSubs).toBe(0);
          expect(snap.clientSubs).toBe(0);
          expect(snap.busyListeners).toBe(1);
          expect(snap.sleepers).toBe(0);
          expect(snap.fx).toBe(0);
          expect(reveal.session).toBeNull();
          expect(reveal.opened.length).toBeLessThanOrEqual(12);
          expect(snap.timers).toBeLessThanOrEqual((snapshots[0]?.timers ?? 0) + 1);
        }
      }

      console.log(rows.join('\n'));
      expect(revealed).toBe(Math.floor(MATCHES / 2));
    },
    240_000,
  );
});
