/**
 * BUG-023: every online match joined the private Supabase Realtime channel
 * `match:{id}`, even when the match server relays emotes over the socket both
 * players already hold. The channel then carried nothing (a sender uses the
 * socket whenever the server relays) but still cost a Realtime join and auth
 * round trip per match. Realtime is now the fallback only: a phone whose
 * server relays emotes never joins it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SocketEmote = { from: string; emoteId: number };

const mocks = vi.hoisted(() => {
  const handlers: Array<(event: { payload: unknown }) => void> = [];
  const channel = {
    state: 'joined',
    on: vi.fn((_type: string, _filter: unknown, handler: (event: { payload: unknown }) => void) => {
      handlers.push(handler);
      return channel;
    }),
    subscribe: vi.fn(() => channel),
    send: vi.fn(async () => 'ok'),
  };
  return {
    channel,
    handlers,
    supabase: { channel: vi.fn(() => channel), removeChannel: vi.fn(async () => 'ok') },
    relays: { value: true },
    socketListeners: new Set<(emote: SocketEmote) => void>(),
  };
});

vi.mock('../../src/net/supabase', () => ({ isSupabaseConfigured: true, supabase: mocks.supabase }));
vi.mock('../../src/state/demo', () => ({ isForcedOffline: () => false }));
vi.mock('../../src/net/match-client', () => ({
  emotesRelayedByServer: () => mocks.relays.value,
  sendEmoteOverSocket: () => mocks.relays.value,
  onServerEmote: (listener: (emote: SocketEmote) => void) => {
    mocks.socketListeners.add(listener);
    return () => mocks.socketListeners.delete(listener);
  },
}));

import { sendEmote, subscribeEmotes } from '../../src/net/chat';

const RELAYED_MATCH = '11111111-1111-4111-8111-111111111111';
const FALLBACK_MATCH = '22222222-2222-4222-8222-222222222222';

describe('emote transport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.handlers.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('never joins Realtime when the match server relays emotes', async () => {
    mocks.relays.value = true;
    const heard: unknown[] = [];

    const off = subscribeEmotes(RELAYED_MATCH, (message) => heard.push(message));
    for (const listener of mocks.socketListeners) listener({ from: 'them', emoteId: 3 });
    await sendEmote({ matchId: RELAYED_MATCH, from: 'me', emoteId: 1 });
    off();
    vi.advanceTimersByTime(2000);

    expect(mocks.supabase.channel).not.toHaveBeenCalled();
    expect(mocks.channel.send).not.toHaveBeenCalled();
    expect(mocks.supabase.removeChannel).not.toHaveBeenCalled();
    expect(heard).toEqual([{ matchId: RELAYED_MATCH, from: 'them', emoteId: 3 }]);
    expect(mocks.socketListeners.size).toBe(0);
  });

  it('falls back to the private Realtime channel against a server that does not relay', async () => {
    mocks.relays.value = false;
    const heard: unknown[] = [];

    const off = subscribeEmotes(FALLBACK_MATCH, (message) => heard.push(message));
    expect(mocks.supabase.channel).toHaveBeenCalledWith(`match:${FALLBACK_MATCH}`, {
      config: { private: true, broadcast: { self: false } },
    });
    for (const handler of mocks.handlers) handler({ payload: { from: 'them', emoteId: 2 } });
    await sendEmote({ matchId: FALLBACK_MATCH, from: 'me', emoteId: 4 });
    off();
    vi.advanceTimersByTime(2000);

    expect(heard).toEqual([{ matchId: FALLBACK_MATCH, from: 'them', emoteId: 2 }]);
    expect(mocks.channel.send).toHaveBeenCalledWith({
      type: 'broadcast',
      event: 'emote',
      payload: { matchId: FALLBACK_MATCH, from: 'me', emoteId: 4 },
    });
    expect(mocks.supabase.removeChannel).toHaveBeenCalledTimes(1);
  });
});
