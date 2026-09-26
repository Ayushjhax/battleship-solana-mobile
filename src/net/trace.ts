/**
 * Opt-in action tracing for development builds: where the time between a tap
 * and its result goes. Off unless EXPO_PUBLIC_TRACE_ACTIONS=1 is set when the
 * bundle is built, and never in a release build (`__DEV__`), so a shipped app
 * only carries dead branches.
 *
 * One action is in flight at a time (the battle store's `pending` lock), so a
 * single trace is followed through its stages, every one on this device's
 * monotonic clock (`performance.now()`):
 *
 *   input     the tap reached the battle store (aim)
 *   handler   act() ran: optimistic mark, send (start and end)
 *   sent      the `action` frame left, carrying its `seq`
 *   received  the first `events` (or `error`) frame for it arrived
 *   applied   the EventPlayer committed the server's first event
 *   settled   the animation queue went idle: the result is on the board
 *   frame     the next animation frame after that
 *
 * The correlation id is the action's own wire `seq`. The server logs the same
 * seq with ITS processing time (server/src/trace.ts, SEABATTLE_TRACE=1) on its
 * own clock. The two are never subtracted from each other: `sent -> received`
 * here is the client-observed round trip, which includes the network, the
 * server's time, and any wait for this JS thread to get round to the socket
 * event; the server's line says how much of it was the server.
 *
 * "Ping": the app shows no ping of its own. The protocol ping the match client
 * sends every 10 s is timed here too, next to how late this thread's own
 * timers are running (`lag`) — a round trip reading 2 s while the lag also
 * reads ~2 s is a busy JS thread, not a slow network.
 */

declare const __DEV__: boolean | undefined;

const now = (): number => globalThis.performance.now();

let enabled =
  (typeof __DEV__ === 'undefined' || __DEV__ === true) &&
  process.env.EXPO_PUBLIC_TRACE_ACTIONS === '1';

export interface ActionTrace {
  readonly kind: string;
  /** The action's wire seq — the id the server logs too. Null until it is sent. */
  seq: number | null;
  readonly input: number;
  handlerStart: number;
  handlerEnd: number | null;
  sent: number | null;
  received: number | null;
  applied: number | null;
  settled: number | null;
  frame: number | null;
  outcome: 'ok' | 'rejected' | 'dropped' | null;
}

export interface PingTrace {
  readonly rttMs: number;
  /** The worst lateness of this thread's timers over the last few seconds. */
  readonly lagMs: number;
}

type Sink = (record: { action: ActionTrace } | { ping: PingTrace }) => void;

const round = (ms: number | null) => (ms === null ? '—' : `${Math.round(ms * 10) / 10}ms`);
const span = (from: number | null, to: number | null) =>
  from === null || to === null ? null : to - from;

function describe(t: ActionTrace): string {
  return (
    `[trace] #${t.seq ?? '?'} ${t.kind} ${t.outcome ?? 'open'}` +
    ` | input→sent ${round(span(t.input, t.sent))}` +
    ` | handler ${round(span(t.handlerStart, t.handlerEnd))}` +
    ` | sent→received (client RTT) ${round(span(t.sent, t.received))}` +
    ` | received→applied ${round(span(t.received, t.applied))}` +
    ` | applied→settled ${round(span(t.applied, t.settled))}` +
    ` | settled→frame ${round(span(t.settled, t.frame))}` +
    ` | total ${round(span(t.input, t.frame ?? t.settled ?? t.received))}`
  );
}

let sink: Sink = (record) => {
  if ('action' in record) console.log(describe(record.action));
  else
    console.log(
      `[trace] ping ${round(record.ping.rttMs)} | JS timer lag (max, last ${LAG_WINDOW_MS / 1000}s) ${round(record.ping.lagMs)}`,
    );
};

let current: ActionTrace | null = null;
let inputAt: number | null = null;
let pingSentAt: number[] = [];

// ---- JS timer lag, sampled only while tracing is on -------------------------

const LAG_TICK_MS = 100;
const LAG_WINDOW_MS = 5000;
let lagTimer: ReturnType<typeof setInterval> | null = null;
let lagSamples: { at: number; lag: number }[] = [];
let lagExpected = 0;

function startLagMonitor(): void {
  if (lagTimer) return;
  lagExpected = now() + LAG_TICK_MS;
  lagTimer = setInterval(() => {
    const at = now();
    lagSamples.push({ at, lag: Math.max(0, at - lagExpected) });
    lagExpected = at + LAG_TICK_MS;
    const cutoff = at - LAG_WINDOW_MS;
    while (lagSamples.length > 0 && (lagSamples[0] as { at: number }).at < cutoff)
      lagSamples.shift();
  }, LAG_TICK_MS);
}

function stopLagMonitor(): void {
  if (lagTimer) clearInterval(lagTimer);
  lagTimer = null;
  lagSamples = [];
}

function recentLag(): number {
  return lagSamples.reduce((max, sample) => Math.max(max, sample.lag), 0);
}

// ---- switches ------------------------------------------------------------------

export function isTracing(): boolean {
  return enabled;
}

/** Tests (and a dev menu, if ever wanted) turn it on without rebuilding. */
export function setTracing(on: boolean, to?: Sink): void {
  enabled = on;
  if (to) sink = to;
  current = null;
  inputAt = null;
  pingSentAt = [];
  if (!on) stopLagMonitor();
}

function finish(outcome: ActionTrace['outcome']): void {
  const trace = current;
  if (!trace) return;
  current = null;
  trace.outcome = outcome;
  sink({ action: trace });
}

// ---- stages --------------------------------------------------------------------

/** A tap on the enemy board reached the store. */
export function traceInput(): void {
  if (enabled) inputAt = now();
}

/** act() is handling an online FIRE / USE_ARSENAL. */
export function traceHandlerStart(kind: string): void {
  if (!enabled) return;
  if (current) finish('dropped');
  const at = now();
  current = {
    kind,
    seq: null,
    input: inputAt ?? at,
    handlerStart: at,
    handlerEnd: null,
    sent: null,
    received: null,
    applied: null,
    settled: null,
    frame: null,
    outcome: null,
  };
  inputAt = null;
}

export function traceHandlerEnd(): void {
  if (enabled && current && current.handlerEnd === null) current.handlerEnd = now();
}

/** The `action` frame is on the wire. */
export function traceSent(seq: number): void {
  if (!enabled || !current || current.sent !== null) return;
  current.seq = seq;
  current.sent = now();
}

/** An inbound frame, stamped when the socket handed it to this thread. */
export function traceReceived(type: string, at: number): void {
  if (!enabled || !current || current.sent === null || current.received !== null) return;
  if (type === 'events') current.received = at;
  else if (type === 'error') {
    current.received = at;
    finish('rejected');
  }
}

/** The EventPlayer committed an event of the server's reply. */
export function traceApplied(): void {
  if (enabled && current && current.received !== null && current.applied === null)
    current.applied = now();
}

/** The animation queue drained after the reply: the result is on the board. */
export function traceSettled(): void {
  if (!enabled || !current || current.applied === null || current.settled !== null) return;
  const trace = current;
  trace.settled = now();
  const done = () => {
    if (current !== trace) return;
    trace.frame = now();
    finish('ok');
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(done);
  else done();
}

/** The match client sent a protocol ping. */
export function tracePingSent(): void {
  if (!enabled) return;
  startLagMonitor();
  pingSentAt.push(now());
}

/** Its pong arrived (at = when the socket handed it over). */
export function tracePong(at: number): void {
  if (!enabled) return;
  const sent = pingSentAt.shift();
  if (sent === undefined) return;
  sink({ ping: { rttMs: at - sent, lagMs: recentLag() } });
}

/** The socket went away: nothing in flight on it will ever be answered. */
export function traceSocketGone(): void {
  if (!enabled) return;
  pingSentAt = [];
  if (current && current.received === null) finish('dropped');
}

export const traceClock = now;
