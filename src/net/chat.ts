/**
 * Emotes over the private Realtime match channel `match:{matchId}` —
 * broadcast only, never game state (that is the Node server's job). RLS on
 * realtime.messages lets only the two players of the match in
 * (0005_realtime.sql), so a stranger's subscribe fails with CHANNEL_ERROR.
 *
 * Offline matches (ai, hotseat, tutorial) have no channel: sending resolves
 * and nothing is broadcast.
 *
 * Subscriptions are reference-counted per match. A Realtime channel instance
 * may be `subscribe()`d only once, and two screens want it in a row:
 * searching.tsx opens it during the arena reveal so it is already joined
 * when the battle starts, and battle.tsx holds it for the match. On a route
 * change the old screen's cleanup runs before the new screen's effect, so
 * the last unsubscribe lets go after a short grace instead of at once — the
 * next subscriber inside that window reuses the joined channel.
 */
import type { RealtimeChannel } from '@supabase/supabase-js';

import { isForcedOffline } from '@/state/demo';
import { isSupabaseConfigured, supabase } from './supabase';

export interface EmoteMessage {
  readonly matchId: string;
  readonly from: string;
  readonly emoteId: number;
}

type Listener = (message: EmoteMessage) => void;

interface Entry {
  readonly channel: RealtimeChannel;
  readonly listeners: Set<Listener>;
  releaseTimer: ReturnType<typeof setTimeout> | null;
}

const HANDOVER_GRACE_MS = 1500;
const entries = new Map<string, Entry>();

/** Only server-created matches have uuid ids; local ones ("local-…") never touch Realtime. */
function isServerMatch(matchId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(matchId);
}

function open(matchId: string): Entry {
  const entry = entries.get(matchId);
  if (entry) {
    if (entry.releaseTimer) {
      clearTimeout(entry.releaseTimer);
      entry.releaseTimer = null;
    }
    return entry;
  }
  const channel = supabase.channel(`match:${matchId}`, {
    config: { private: true, broadcast: { self: false } },
  });
  const created: Entry = { channel, listeners: new Set(), releaseTimer: null };
  entries.set(matchId, created);
  channel
    .on('broadcast', { event: 'emote' }, ({ payload }) => {
      const p = payload as Partial<EmoteMessage>;
      if (typeof p.emoteId !== 'number' || typeof p.from !== 'string') return;
      const message: EmoteMessage = { matchId, from: p.from, emoteId: p.emoteId };
      for (const listener of created.listeners) listener(message);
    })
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') console.warn(`[chat] not allowed on match:${matchId}`);
    });
  return created;
}

function release(matchId: string): void {
  const entry = entries.get(matchId);
  if (!entry || entry.listeners.size > 0 || entry.releaseTimer) return;
  entry.releaseTimer = setTimeout(() => {
    if (entry.listeners.size > 0) {
      entry.releaseTimer = null;
      return;
    }
    entries.delete(matchId);
    void supabase.removeChannel(entry.channel);
  }, HANDOVER_GRACE_MS);
}

export async function sendEmote(message: EmoteMessage): Promise<void> {
  if (!isSupabaseConfigured || isForcedOffline() || !isServerMatch(message.matchId)) return;
  try {
    const entry = entries.get(message.matchId);
    if (!entry || entry.channel.state !== 'joined') return; // subscribeEmotes() opens it; no join, no send
    await entry.channel.send({ type: 'broadcast', event: 'emote', payload: message });
  } catch (error) {
    console.warn('[chat] emote not sent', error);
  }
}

/**
 * Opens (or joins) the match channel and delivers the opponent's emotes.
 * Returns the unsubscribe. Pass no listener just to warm the channel up.
 */
export function subscribeEmotes(matchId: string, onEmote?: Listener): () => void {
  if (!isSupabaseConfigured || isForcedOffline() || !isServerMatch(matchId)) return () => {};
  const entry = open(matchId);
  const listener: Listener = onEmote ?? (() => {});
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
    release(matchId);
  };
}
