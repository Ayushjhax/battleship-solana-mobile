/**
 * Two real players, over real sockets, against the real server stack.
 *
 * `attachWebSocketServer` + `matchmaker` + `Room` + the real rules engine all
 * run unchanged. Only the two process edges are faked: Supabase (`./db`) and
 * JWT verification (`./auth`), because neither can be reached from a test and
 * neither is what an online match is likely to get wrong.
 *
 * Everything an online match actually depends on — pairing, seating, layout
 * deadlines, turn order, event fan-out, view masking, disconnect grace — is
 * the shipped code.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { WebSocket } from 'ws';

import type { ClientMessage, LayoutPayload, ServerMessage } from '../../src/protocol';

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function until(
  predicate: () => boolean,
  what = 'condition',
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

/**
 * One player's socket, recording everything the server ever sent so a test can
 * assert on ordering and on what a player was allowed to learn.
 */
export class TestPlayer {
  readonly received: ServerMessage[] = [];
  readonly sent: ClientMessage[] = [];
  private socket: WebSocket;
  private seq = 0;

  constructor(
    readonly id: string,
    private readonly url: string,
  ) {
    this.socket = new WebSocket(url);
  }

  async open(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
    this.socket.on('message', (raw) => {
      try {
        this.received.push(JSON.parse(String(raw)) as ServerMessage);
      } catch {
        /* a frame that is not JSON is itself a failure the tests assert on */
      }
    });
  }

  send(message: ClientMessage): void {
    this.sent.push(message);
    this.socket.send(JSON.stringify(message));
  }

  /** `hello` carries the token; the fake verifier turns it straight into an id. */
  hello(resumeMatchId?: string): void {
    this.send({
      t: 'hello',
      v: 1,
      token: this.id,
      ...(resumeMatchId ? { resumeMatchId } : {}),
    } as ClientMessage);
  }

  queue(mode: 'classic' | 'advanced' = 'classic'): void {
    this.send({ t: 'queue', v: 1, mode, wagered: false, opponent: 'player' } as ClientMessage);
  }

  ready(layout: LayoutPayload): void {
    this.send({ t: 'ready', v: 1, layout } as ClientMessage);
  }

  /** Action seq is wall-clock ms so it stays monotonic across a restart. */
  fire(at: { r: number; c: number }): void {
    this.seq += 1;
    this.send({
      t: 'action',
      v: 1,
      seq: Date.now() * 10 + this.seq,
      action: { type: 'FIRE', at },
    } as ClientMessage);
  }

  useArsenal(itemId: string, target: { at?: { r: number; c: number }; row?: number }): void {
    this.seq += 1;
    this.send({
      t: 'action',
      v: 1,
      seq: Date.now() * 10 + this.seq,
      action: { type: 'USE_ARSENAL', itemId, ...target },
    } as ClientMessage);
  }

  resign(): void {
    this.send({ t: 'resign', v: 1 } as ClientMessage);
  }

  ping(): void {
    this.send({ t: 'ping', v: 1 } as ClientMessage);
  }

  cancelQueue(): void {
    this.send({ t: 'cancelQueue', v: 1 } as ClientMessage);
  }

  /** Every message of a type, oldest first. */
  all<T extends ServerMessage['t']>(type: T): Extract<ServerMessage, { t: T }>[] {
    return this.received.filter((m) => m.t === type) as Extract<ServerMessage, { t: T }>[];
  }

  last<T extends ServerMessage['t']>(type: T): Extract<ServerMessage, { t: T }> | undefined {
    return this.all(type).at(-1);
  }

  has(type: ServerMessage['t']): boolean {
    return this.received.some((m) => m.t === type);
  }

  close(): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.close();
  }

  /** Drop the socket without a close frame — a phone losing signal. */
  kill(): void {
    this.socket.terminate();
  }

  /** Reconnect as the same player, e.g. to resume a match. */
  reopen(): void {
    this.socket = new WebSocket(this.url);
  }
}

export interface Harness {
  readonly url: string;
  player: (id: string) => TestPlayer;
  stop: () => Promise<void>;
}

export async function startServer(): Promise<Harness> {
  const { attachWebSocketServer } = await import('../../src/ws');
  const http: Server = createServer();
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const { port } = http.address() as AddressInfo;
  // attachWebSocketServer binds `path: '/ws'`; anything else is a 400.
  const url = `ws://127.0.0.1:${port}/ws`;
  const wss = attachWebSocketServer(http, () => {});
  const players: TestPlayer[] = [];

  return {
    url,
    player(id: string) {
      const player = new TestPlayer(id, url);
      players.push(player);
      return player;
    },
    async stop() {
      for (const player of players) player.kill();
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => {
        const done = setTimeout(resolve, 1000);
        wss.close(() => {
          clearTimeout(done);
          resolve();
        });
      });
      await new Promise<void>((resolve) => {
        const done = setTimeout(resolve, 1000);
        http.close(() => {
          clearTimeout(done);
          resolve();
        });
      });
    },
  };
}

/** Connect and queue both players, then wait until the server has paired them. */
export async function pair(
  harness: Harness,
  a: string,
  b: string,
  mode: 'classic' | 'advanced' = 'classic',
): Promise<[TestPlayer, TestPlayer]> {
  const one = harness.player(a);
  const two = harness.player(b);
  await Promise.all([one.open(), two.open()]);
  one.hello();
  two.hello();
  await until(() => one.has('hello:ok') && two.has('hello:ok'), 'both hello:ok');
  one.queue(mode);
  two.queue(mode);
  await until(() => one.has('matched') && two.has('matched'), 'both matched');
  return [one, two];
}
