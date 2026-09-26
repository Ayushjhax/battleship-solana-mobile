/**
 * The opt-in action trace (src/net/trace.ts). The full happy path — tap to
 * settled, correlated with the server's own line by seq — is exercised end
 * to end by tests/perf/repeated-matches.soak.test.ts. These pin the edges a
 * soak does not reach: a refused action, a socket lost mid-flight, frames
 * that are not the reply, and that nothing is recorded when tracing is off.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  setTracing,
  traceApplied,
  traceHandlerEnd,
  traceHandlerStart,
  traceInput,
  tracePingSent,
  tracePong,
  traceReceived,
  traceSent,
  traceSettled,
  traceSocketGone,
  type ActionTrace,
  type PingTrace,
} from '../../src/net/trace';

let actions: ActionTrace[];
let pings: PingTrace[];

beforeEach(() => {
  actions = [];
  pings = [];
  setTracing(true, (record) => {
    if ('action' in record) actions.push(record.action);
    else pings.push(record.ping);
  });
});

afterEach(() => setTracing(false));

const clock = () => globalThis.performance.now();

describe('an action trace', () => {
  it('follows one tap from input to the frame after it settles, under its wire seq', () => {
    traceInput();
    traceHandlerStart('USE_ARSENAL');
    traceSent(4242);
    traceHandlerEnd();
    traceReceived('events', clock());
    traceApplied();
    traceSettled();

    expect(actions).toHaveLength(1);
    const [trace] = actions as [ActionTrace];
    expect(trace).toMatchObject({ kind: 'USE_ARSENAL', seq: 4242, outcome: 'ok' });
    const order = [
      trace.input,
      trace.handlerStart,
      trace.sent,
      trace.received,
      trace.applied,
      trace.settled,
      trace.frame,
    ];
    for (let i = 1; i < order.length; i += 1)
      expect(order[i]).toBeGreaterThanOrEqual(order[i - 1] as number);
  });

  it('ends as rejected when the server answers with an error', () => {
    traceHandlerStart('FIRE');
    traceSent(7);
    traceReceived('error', clock());

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ seq: 7, outcome: 'rejected' });
    expect(actions[0]?.applied).toBeNull();
  });

  it('ends as dropped when the socket goes before the reply', () => {
    traceHandlerStart('FIRE');
    traceSent(8);
    traceSocketGone();

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ seq: 8, outcome: 'dropped', received: null });
  });

  it('does not take a frame that arrived before its own send as the reply', () => {
    traceHandlerStart('FIRE');
    traceReceived('events', clock()); // the opponent's move, still animating
    traceReceived('state', clock());
    traceSent(9);

    expect(actions).toHaveLength(0);
  });

  it('does not count our own local shell as the reply being applied', () => {
    traceHandlerStart('FIRE');
    traceSent(10);
    traceApplied(); // the SHOT_FIRED commit happens before any reply
    traceSettled();

    expect(actions).toHaveLength(0);
  });
});

describe('the ping trace', () => {
  it('times each pong against its own ping, in order', () => {
    tracePingSent();
    tracePingSent();
    tracePong(clock());
    tracePong(clock());
    tracePong(clock()); // an unsolicited pong has nothing to pair with

    expect(pings).toHaveLength(2);
    for (const ping of pings) {
      expect(ping.rttMs).toBeGreaterThanOrEqual(0);
      expect(ping.lagMs).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('when tracing is off', () => {
  it('records nothing and keeps no timer running', () => {
    setTracing(false);
    const before = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
    traceInput();
    traceHandlerStart('FIRE');
    traceSent(1);
    traceReceived('events', clock());
    traceApplied();
    traceSettled();
    tracePingSent();
    tracePong(clock());

    expect(actions).toHaveLength(0);
    expect(pings).toHaveLength(0);
    expect(process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length).toBe(before);
  });
});
