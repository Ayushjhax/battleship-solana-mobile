/**
 * Opt-in action tracing on the match server (SEABATTLE_TRACE=1): the server's
 * half of the app's src/net/trace.ts. One line per `action` frame, keyed by
 * the action's wire `seq` — the id the client logs for the same tap — with
 * durations on THIS process's monotonic clock only:
 *
 *   waited   frame arrival -> its turn in the connection's message chain
 *            (non-zero only if something before it on that socket awaited)
 *   handled  reduce() + both projections + the events/state/turn frames
 *            handed to both sockets — i.e. until the response is emitted
 *
 * Client-observed round trip minus (waited + handled) is network and the
 * client's own thread; nothing here compares timestamps across machines.
 * No tokens and no player ids are logged — only the match id's prefix.
 */
import { performance } from 'node:perf_hooks';

export const serverTracing = process.env.SEABATTLE_TRACE === '1';

export const traceNow = (): number => performance.now();

export function traceAction(
  log: (message: string) => void,
  entry: {
    seq: number;
    type: string;
    matchId: string | undefined;
    arrived: number;
    started: number;
    emitted: number;
  },
): void {
  const ms = (value: number) => `${Math.round(value * 100) / 100}ms`;
  log(
    `[trace] #${entry.seq} ${entry.type} match=${entry.matchId?.slice(0, 8) ?? 'none'}` +
      ` waited ${ms(entry.started - entry.arrived)} handled ${ms(entry.emitted - entry.started)}`,
  );
}
