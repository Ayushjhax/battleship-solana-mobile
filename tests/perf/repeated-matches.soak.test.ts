/**
 * Soak: many online matches in ONE app session, measured.
 *
 * Reported as: "the app becomes progressively slower after playing many
 * matches in one session", ping near 2 s, arsenal drops taking ~2 s to show,
 * the phone getting hot. This harness answers the network half of that
 * question with evidence rather than inspection: does anything in the client
 * transport, the battle store, or the match server grow with every match, and
 * does a late match respond slower than an early one?
 *
 * Everything that runs is shipped code — two real `useMatchClient` +
 * `useBattle` instances (one module graph each, like two phones) over real
 * WebSockets to the real ws.ts + matchmaker + Room + engine. Taps go through
 * the battle store's `aim()` / `selectArsenal()`, exactly what the screen
 * calls. Only the process edges are faked (Supabase, JWT verification,
 * expo-sqlite). The animations are the headless ones (commit only).
 *
 * Every match also: taps twice at once (one action must reach the server),
 * probes the socket the way a return to the foreground does (`nudge`), and —
 * every fourth match — has the server drop a player's socket mid-match so the
 * client must reconnect and resync without replaying or duplicating anything.
 *
 * Timing comes from the app's own opt-in tracing (src/net/trace.ts and
 * server/src/trace.ts), correlated by the action's wire `seq`; each side
 * measures on its own monotonic clock and nothing subtracts one from the
 * other. Between matches, with both phones back at the menu, it snapshots:
 * server rooms, player index, queue, sockets on both ends, active timers and
 * handles, store subscriptions, EventPlayer listeners, and the heap after a
 * forced GC (when node runs with --expose-gc).
 *
 * Runs by default with a few matches as a fast guard. To soak and keep the
 * numbers:
 *
 *   NODE_OPTIONS=--expose-gc SOAK_MATCHES=25 SOAK_REPORT=/tmp/soak.txt \
 *     npx vitest run tests/perf/repeated-matches.soak.test.ts
 */
import { appendFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';

import { autoPlaceFleet } from '@engine/placement';
import { createRng } from '@engine/rng';
import type { ArsenalItem, Coord, Ship } from '@engine/types';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ActionTrace, PingTrace } from '../../src/net/trace';

const ALICE = 'alice';
const BOB = 'bob';
const MATCHES = Number(process.env.SOAK_MATCHES ?? 4);
/** Per match: each side's first action is its radar, then its bomber, then shots. */
const ACTIONS_PER_MATCH = 8;
const DROP_EVERY = 4;

/** Which player the NEXT `getAccessToken` call belongs to (see two-client-online-match). */
const auth = { token: ALICE };

vi.mock('expo-sqlite/localStorage/install', () => ({}));
vi.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isInternetReachable: true, isConnected: true }),
}));
vi.mock('../../src/net/api', () => ({
  getAccessToken: vi.fn(async () => ({ ok: true as const, value: auth.token })),
}));
vi.mock('../../src/state/profile', () => ({
  useProfile: {
    getState: () => ({ userId: auth.token, setUserId: () => {}, queueResult: () => {} }),
  },
}));
vi.mock('../../src/state/points', () => ({
  usePoints: { getState: () => ({ activeWager: null, sync: () => {}, finishWager: () => {} }) },
}));
vi.mock('../../server/src/auth', () => ({
  verifyAccessToken: vi.fn(async (token: string) =>
    token
      ? { ok: true, token: { userId: token, isAnonymous: false } }
      : { ok: false, reason: 'no token' },
  ),
}));
vi.mock('../../server/src/db', () => ({
  BOT_PLAYER_ID: 'b0000000-0000-4000-8000-000000000001',
  appendMatchEvent: vi.fn(async () => {}),
  applyMatchResult: vi.fn(async () => true),
  abandonMatch: vi.fn(async () => {}),
  cancelWageredMatchBeforeStart: vi.fn(async () => []),
  dbEndReason: vi.fn((reason: string) => reason),
  fetchOpponentSummary: vi.fn(async (id: string) => ({
    id,
    name: id,
    avatarId: 1,
    avatarColor: '#3E2FB8',
    countryCode: 'IN',
    rankPoints: 0,
    isBot: false,
  })),
  fetchPointBalance: vi.fn(async () => 500),
  insertMatch: vi.fn(async () => {}),
  insertWageredMatch: vi.fn(async () => {}),
  refundPointWager: vi.fn(async () => 500),
  reservePointWager: vi.fn(async () => ({ ok: true, balance: 450, requestId: 'r' })),
}));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate: () => boolean, what: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

// ---------------------------------------------------------------------------
// Client sockets, counted (the app's own tracing does the timing)
// ---------------------------------------------------------------------------

const liveSockets = new Set<WebSocket>();
const NativeWebSocket = globalThis.WebSocket;

class CountedWebSocket extends NativeWebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols);
    liveSockets.add(this);
    this.addEventListener('close', () => liveSockets.delete(this));
  }

  override close(code?: number, reason?: string): void {
    liveSockets.delete(this);
    super.close(code, reason);
  }
}

// ---------------------------------------------------------------------------
// Two app sessions, one module graph each
// ---------------------------------------------------------------------------

interface Phone {
  readonly id: string;
  readonly battle: typeof import('../../src/state/battle');
  readonly client: (typeof import('../../src/net/match-client'))['useMatchClient'];
  readonly setup: typeof import('../../src/features/battle/setup');
  readonly protocol: typeof import('../../src/net/protocol');
  readonly traces: ActionTrace[];
  readonly pings: PingTrace[];
  /** Live subscriptions on this phone's match-client store. */
  subscriptions: number;
  /** Actions this harness asked the phone to take (duplicate taps excluded). */
  intended: number;
}

async function bootPhone(id: string): Promise<Phone> {
  vi.resetModules();
  const battle = await import('../../src/state/battle');
  const { useMatchClient } = await import('../../src/net/match-client');
  const setup = await import('../../src/features/battle/setup');
  const protocol = await import('../../src/net/protocol');
  const trace = await import('../../src/net/trace');
  const phone: Phone = {
    id,
    battle,
    client: useMatchClient,
    setup,
    protocol,
    traces: [],
    pings: [],
    subscriptions: 0,
    intended: 0,
  };
  trace.setTracing(true, (record) => {
    if ('action' in record) phone.traces.push(record.action);
    else phone.pings.push(record.ping);
  });
  const subscribe = useMatchClient.subscribe;
  useMatchClient.subscribe = ((listener: Parameters<typeof subscribe>[0]) => {
    phone.subscriptions += 1;
    const off = subscribe(listener);
    let live = true;
    return () => {
      if (live) phone.subscriptions -= 1;
      live = false;
      off();
    };
  }) as typeof subscribe;
  return phone;
}

function playerInternals(phone: Phone) {
  const player = phone.battle.battlePlayer as unknown as {
    listeners: Set<unknown>;
    sleepers: Set<unknown>;
  };
  return { busyListeners: player.listeners.size, sleepers: player.sleepers.size };
}

function layoutFor(phone: Phone, seed: number) {
  const ships = autoPlaceFleet(createRng(seed)) as Ship[];
  const arsenal: ArsenalItem[] = [
    { id: `${phone.id}-radar`, kind: 'radar' },
    { id: `${phone.id}-bomber`, kind: 'bomber' },
  ];
  return phone.protocol.toLayoutPayload(ships, arsenal);
}

/** The first cell of the enemy grid this phone has not marked yet. */
function freshCell(phone: Phone): Coord {
  const marks = phone.battle.useBattle.getState().shown?.enemy.marks ?? {};
  for (let r = 0; r < 10; r += 1) {
    for (let c = 0; c < 10; c += 1) if (!marks[`${r},${c}`]) return { r, c };
  }
  return { r: 9, c: 9 };
}

/** One tap — plus an impatient second tap in the same tick, which must go nowhere. */
async function act(phone: Phone, action: 'radar' | 'bomber' | 'fire'): Promise<void> {
  const store = phone.battle.useBattle;
  const before = store.getState().shown?.moves ?? 0;
  const at = freshCell(phone);
  if (action !== 'fire') store.getState().selectArsenal(`${phone.id}-${action}`);
  store.getState().aim(at);
  store.getState().aim({ r: 9 - at.r, c: 9 - at.c });
  phone.intended += 1;
  await until(
    () =>
      (store.getState().shown?.moves ?? 0) > before &&
      !store.getState().pending &&
      !store.getState().animating,
    `${phone.id} ${action} confirmed`,
  ).catch((error: unknown) => {
    // What each side believed when it stuck — the first thing to know.
    const s = store.getState();
    const room = serverModules.room.findRoomForPlayer(phone.id);
    const view = (p: Phone) => p.client.getState().view;
    console.log(
      `[soak] stuck: ${phone.id} ${action} at ${at.r},${at.c}; store moves=${s.shown?.moves} turn=${s.shown?.turn} ` +
        `pending=${s.pending} animating=${s.animating}; client status=${phone.client.getState().status} ` +
        `lastError=${phone.client.getState().lastError?.message ?? '-'}; views alice=${view(alice)?.turn} ` +
        `bob=${view(bob)?.turn}; server turn=${room?.state.turn} moves=${room?.state.moves}`,
    );
    throw error;
  });
}

// ---------------------------------------------------------------------------

let http: Server;
let wss: import('ws').WebSocketServer;
let serverModules: {
  room: typeof import('../../server/src/room');
  matchmaker: typeof import('../../server/src/matchmaker');
};
const serverTrace: { seq: number; waited: number; handled: number }[] = [];
let alice: Phone;
let bob: Phone;

beforeAll(async () => {
  globalThis.WebSocket = CountedWebSocket as unknown as typeof WebSocket;
  process.env.SEABATTLE_TRACE = '1';
  vi.resetModules();
  const { attachWebSocketServer } = await import('../../server/src/ws');
  serverModules = {
    room: await import('../../server/src/room'),
    matchmaker: await import('../../server/src/matchmaker'),
  };
  http = createServer();
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const { port } = http.address() as AddressInfo;
  process.env.EXPO_PUBLIC_WS_URL = `ws://127.0.0.1:${port}/ws`;
  wss = attachWebSocketServer(http, (line) => {
    const m = /^\[trace\] #(\d+) \S+ match=\S+ waited ([\d.]+)ms handled ([\d.]+)ms$/.exec(line);
    if (m) serverTrace.push({ seq: Number(m[1]), waited: Number(m[2]), handled: Number(m[3]) });
  });
  alice = await bootPhone(ALICE);
  bob = await bootPhone(BOB);
});

afterAll(async () => {
  alice?.client.getState().disconnect();
  bob?.client.getState().disconnect();
  for (const socket of wss?.clients ?? []) socket.terminate();
  wss?.close();
  await new Promise<void>((resolve) => http.close(() => resolve()));
  globalThis.WebSocket = NativeWebSocket;
  delete process.env.SEABATTLE_TRACE;
});

interface Snapshot {
  match: number;
  rooms: number;
  roomIndex: number;
  queued: number;
  serverSockets: number;
  clientSockets: number;
  timers: number;
  handles: number;
  subscriptions: number;
  busyListeners: number;
  sleepers: number;
  heapMb: number | null;
}

function snapshot(match: number): Snapshot {
  // The faked db's vi.fn()s keep every call's arguments (whole event batches);
  // that is the harness's memory, not the app's, so it is let go first.
  vi.clearAllMocks();
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
  const resources = process.getActiveResourcesInfo();
  return {
    match,
    rooms: serverModules.room.rooms.size,
    roomIndex: serverModules.room.roomIdForPlayer.size,
    queued: serverModules.matchmaker.totalQueued(),
    serverSockets: wss.clients.size,
    clientSockets: liveSockets.size,
    timers: resources.filter((r) => r === 'Timeout').length,
    handles: resources.filter((r) => r !== 'Timeout').length,
    subscriptions: alice.subscriptions + bob.subscriptions,
    busyListeners: playerInternals(alice).busyListeners + playerInternals(bob).busyListeners,
    sleepers: playerInternals(alice).sleepers + playerInternals(bob).sleepers,
    heapMb: gc ? Math.round((process.memoryUsage().heapUsed / 1048576) * 10) / 10 : null,
  };
}

/** The server cuts one phone's socket mid-match, as a lost radio would. */
async function dropAndResync(phone: Phone): Promise<void> {
  const room = serverModules.room.findRoomForPlayer(phone.id);
  const seat = room?.seats.find((s) => s.playerId === phone.id);
  if (!room || !seat?.socket) throw new Error(`${phone.id} has no live seat to drop`);
  // Its reconnect fetches a token again: make it this phone's (see `auth`).
  auth.token = phone.id;
  seat.socket.terminate();
  await until(() => phone.client.getState().status === 'reconnecting', `${phone.id} reconnecting`);
  await until(() => phone.client.getState().status === 'active', `${phone.id} resynced`, 12_000);
  expect(serverModules.room.findRoomForPlayer(phone.id)).toBe(room);
  // ws.ts counts the resume burst against the 10-a-second limit.
  await sleep(1050);
}

/** One match exactly as the app plays it: queue, reveal, battle, result, menu. */
async function playOneMatch(n: number): Promise<void> {
  // /searching — each phone's hello is pinned to its own player id.
  auth.token = ALICE;
  alice.client.getState().queue('advanced', { wagered: false, opponent: 'player' });
  await until(() => alice.client.getState().status === 'queued', `alice queued #${n}`);
  auth.token = BOB;
  bob.client.getState().queue('advanced', { wagered: false, opponent: 'player' });
  await until(
    () =>
      alice.client.getState().status === 'matched' && bob.client.getState().status === 'matched',
    `both matched #${n}`,
  );

  // The reveal sends the placed fleet; /battle then starts the store.
  alice.client.getState().ready(layoutFor(alice, 100 + n));
  bob.client.getState().ready(layoutFor(bob, 200 + n));
  for (const phone of [alice, bob]) {
    phone.client.getState().enterMatch();
    const setup = phone.setup.buildOnlineSetup({} as never);
    if (!setup) throw new Error('no online setup');
    phone.battle.useBattle.getState().start(setup);
  }
  await until(
    () =>
      alice.battle.useBattle.getState().shown?.phase === 'playing' &&
      bob.battle.useBattle.getState().shown?.phase === 'playing',
    `both playing #${n}`,
  );
  // ws.ts cuts a socket above 10 frames a second; let the setup burst age out.
  await sleep(1050);

  // Back from the background: the probe the screens send on AppState 'active'.
  alice.client.getState().nudge();
  bob.client.getState().nudge();

  const used: Record<string, number> = { [ALICE]: 0, [BOB]: 0 };
  for (let k = 0; k < ACTIONS_PER_MATCH; k += 1) {
    if (n % DROP_EVERY === 0 && k === ACTIONS_PER_MATCH / 2)
      await dropAndResync(n % (2 * DROP_EVERY) === 0 ? bob : alice);
    const turn = alice.battle.useBattle.getState().shown?.turn;
    const mover = turn === ALICE ? alice : bob;
    const count = used[mover.id] ?? 0;
    used[mover.id] = count + 1;
    await act(mover, count === 0 ? 'radar' : count === 1 ? 'bomber' : 'fire');
    await sleep(120);
  }

  // Leave through the resign path, as the Home button does.
  const me = alice.battle.useBattle.getState();
  me.act({ type: 'RESIGN', playerId: me.me });
  await until(
    () => alice.battle.useBattle.getState().finished && bob.battle.useBattle.getState().finished,
    `both finished #${n}`,
  );
  expect(alice.client.getState().over?.winnerId).toBe(BOB);
  expect(bob.client.getState().over?.winnerId).toBe(BOB);

  // battle.tsx unmounts (reset), result.tsx disconnects the finished socket.
  for (const phone of [alice, bob]) {
    phone.battle.useBattle.getState().reset();
    phone.client.getState().disconnect();
  }
  await until(
    () => wss.clients.size === 0 && serverModules.room.rooms.size === 0 && liveSockets.size === 0,
    `server idle after #${n}`,
  );
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round((sorted[index] as number) * 100) / 100;
}

function summary(label: string, values: readonly number[]): string {
  return `${label.padEnd(26)} n=${String(values.length).padStart(3)}  p50=${percentile(values, 50)}ms  p95=${percentile(values, 95)}ms  max=${percentile(values, 100)}ms`;
}

const stage = (traces: readonly ActionTrace[], from: keyof ActionTrace, to: keyof ActionTrace) =>
  traces
    .map((t) =>
      typeof t[from] === 'number' && typeof t[to] === 'number'
        ? (t[to] as number) - (t[from] as number)
        : null,
    )
    .filter((v): v is number => v !== null);

describe(`${MATCHES} online matches in one session`, () => {
  it(
    'leaves nothing behind between matches, never duplicates an action, and does not get slower',
    async () => {
      const snapshots: Snapshot[] = [snapshot(0)];
      const tracesPerMatch: ActionTrace[][] = [];
      for (let n = 1; n <= MATCHES; n += 1) {
        const from = alice.traces.length + bob.traces.length;
        await playOneMatch(n);
        tracesPerMatch.push([...alice.traces, ...bob.traces].slice(from));
        snapshots.push(snapshot(n));
      }

      const traces = [...alice.traces, ...bob.traces];
      const ok = traces.filter((t) => t.outcome === 'ok');
      const pings = [...alice.pings, ...bob.pings];
      const half = Math.max(1, Math.floor(MATCHES / 2));
      const early = tracesPerMatch.slice(0, half).flat();
      const late = tracesPerMatch.slice(-half).flat();
      const columns = Object.keys(snapshots[0] as Snapshot) as (keyof Snapshot)[];
      const report = [
        `--- resting state after each match (0 = fresh session) ---`,
        columns.join('\t'),
        ...snapshots.map((s) => columns.map((key) => String(s[key])).join('\t')),
        `--- ${MATCHES} matches, Node ${process.version}, loopback, headless animations ---`,
        summary(
          'ping RTT (client)',
          pings.map((p) => p.rttMs),
        ),
        summary(
          'JS timer lag at pong',
          pings.map((p) => p.lagMs),
        ),
        summary('input -> sent', stage(ok, 'input', 'sent')),
        summary('sent -> received (RTT)', stage(ok, 'sent', 'received')),
        summary(
          '  server waited',
          serverTrace.map((s) => s.waited),
        ),
        summary(
          '  server handled',
          serverTrace.map((s) => s.handled),
        ),
        summary('received -> applied', stage(ok, 'received', 'applied')),
        summary('input -> settled', stage(ok, 'input', 'settled')),
        `--- first ${half} matches vs last ${half} ---`,
        summary('input -> settled (early)', stage(early, 'input', 'settled')),
        summary('input -> settled (late)', stage(late, 'input', 'settled')),
        summary('client RTT (early)', stage(early, 'sent', 'received')),
        summary('client RTT (late)', stage(late, 'sent', 'received')),
      ].join('\n');
      console.log(report);
      if (process.env.SOAK_REPORT) appendFileSync(process.env.SOAK_REPORT, `${report}\n`);

      // One tap, one action: every intended action produced exactly one
      // completed trace, and the server handled each traced seq exactly once.
      const intended = alice.intended + bob.intended;
      expect(intended).toBe(MATCHES * ACTIONS_PER_MATCH);
      expect(ok).toHaveLength(intended);
      const handled = serverTrace.map((s) => s.seq).sort((a, b) => a - b);
      expect(handled).toEqual(ok.map((t) => t.seq as number).sort((a, b) => a - b));
      for (const t of ok) {
        // Every stage in order on the client's clock.
        const order = [t.input, t.handlerStart, t.sent, t.received, t.applied, t.settled, t.frame];
        for (let i = 1; i < order.length; i += 1)
          expect(order[i] as number).toBeGreaterThanOrEqual(order[i - 1] as number);
      }

      // Every match returns the app and the server to the same resting state.
      const first = snapshots[1] as Snapshot;
      for (const s of snapshots.slice(1)) {
        expect(s.rooms).toBe(0);
        expect(s.roomIndex).toBe(0);
        expect(s.queued).toBe(0);
        expect(s.serverSockets).toBe(0);
        expect(s.clientSockets).toBe(0);
        // One module-level onBusy listener per phone, nothing per match.
        expect(s.busyListeners).toBe(2);
        expect(s.sleepers).toBe(0);
        // The battle store lets go of the match client when the screen unmounts.
        expect(s.subscriptions).toBe(0);
        expect(s.timers).toBeLessThanOrEqual(first.timers + 1);
        expect(s.handles).toBeLessThanOrEqual(first.handles);
      }
      // And a late match is not slower than an early one (generous: loopback jitter).
      const earlyP50 = percentile(stage(early, 'input', 'settled'), 50);
      const lateP50 = percentile(stage(late, 'input', 'settled'), 50);
      expect(lateP50).toBeLessThan(earlyP50 * 3 + 5);
    },
    MATCHES * 15_000 + 20_000,
  );
});
