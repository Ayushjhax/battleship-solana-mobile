/**
 * Lobby presence — "142 sailors online" on the menu. A private Realtime
 * channel `lobby:{mode}` with presence only (0005_realtime.sql). Returns null
 * until the count is known, so the menu hides the line rather than showing 0.
 *
 * One channel per mode is shared by every hook instance and reference
 * counted, the way chat.ts shares the match channel: the menu and the
 * searching screen can both want `lobby:classic` at the same time, and
 * supabase-js hands back the EXISTING channel for a topic — a channel that
 * accepts no new callbacks once subscribe() has run, so a second
 * `channel().on()` throws ("cannot add `presence` callbacks … after
 * `subscribe()`"). Opening is serialised here too, so a burst of
 * connectivity events cannot start two joins in flight at once.
 */
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

import { useDemo } from '@/state/demo';
import { useProfile } from '@/state/profile';
import { hasInternet, subscribeConnectivity } from './connectivity';
import { isSupabaseConfigured, supabase } from './supabase';

export type LobbyMode = 'classic' | 'advanced';

type Listener = (count: number | null) => void;

interface Entry {
  channel: RealtimeChannel | null;
  /** True while a join is being set up; the guard against the double open. */
  opening: boolean;
  count: number | null;
  readonly listeners: Set<Listener>;
}

const entries = new Map<LobbyMode, Entry>();

function entryFor(mode: LobbyMode): Entry {
  let entry = entries.get(mode);
  if (!entry) {
    entry = { channel: null, opening: false, count: null, listeners: new Set() };
    entries.set(mode, entry);
  }
  return entry;
}

function publish(entry: Entry): void {
  for (const listener of entry.listeners) listener(entry.count);
}

async function open(mode: LobbyMode, userId: string): Promise<void> {
  const entry = entryFor(mode);
  if (entry.channel || entry.opening) return;
  entry.opening = true;
  try {
    if (!(await hasInternet())) return;
    if (entry.channel || entry.listeners.size === 0) return;

    // A channel on this topic that nobody here owns is a leftover from a
    // close() whose removal is still in flight; the client would hand it
    // straight back to us, already subscribed. Finish removing it first.
    const topic = `realtime:lobby:${mode}`;
    const stale = supabase.getChannels().find((candidate) => candidate.topic === topic);
    if (stale) await supabase.removeChannel(stale);
    if (entry.channel || entry.listeners.size === 0) return;

    const channel = supabase.channel(`lobby:${mode}`, {
      config: { private: true, presence: { key: userId } },
    });
    entry.channel = channel;
    channel
      .on('presence', { event: 'sync' }, () => {
        if (entry.channel !== channel) return;
        entry.count = Object.keys(channel.presenceState()).length;
        publish(entry);
      })
      .subscribe((status) => {
        if (entry.channel !== channel) return;
        if (status === 'SUBSCRIBED') void channel.track({ at: Date.now() });
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          entry.count = null;
          publish(entry);
        }
      });
  } finally {
    entry.opening = false;
  }
}

function close(mode: LobbyMode): void {
  const entry = entries.get(mode);
  if (!entry?.channel) return;
  const channel = entry.channel;
  entry.channel = null;
  entry.count = null;
  publish(entry);
  void supabase.removeChannel(channel);
}

export function useOnlineCount(mode: LobbyMode = 'classic'): number | null {
  const userId = useProfile((s) => s.userId);
  const forcedOffline = useDemo((s) => s.forceOffline);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured || !userId || forcedOffline) return;
    const entry = entryFor(mode);
    const listener: Listener = setCount;
    entry.listeners.add(listener);
    setCount(entry.count);

    void open(mode, userId);
    const unsubscribe = subscribeConnectivity((online) => {
      if (online) void open(mode, userId);
      else close(mode);
    });
    return () => {
      unsubscribe();
      entry.listeners.delete(listener);
      if (entry.listeners.size === 0) close(mode);
      setCount(null);
    };
  }, [forcedOffline, mode, userId]);

  return count;
}
