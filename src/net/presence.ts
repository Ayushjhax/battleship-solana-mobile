/**
 * Lobby presence — "142 sailors online" on the menu. A private Realtime
 * channel `lobby:{mode}` with presence only (0005_realtime.sql). Returns null
 * until the count is known, so the menu hides the line rather than showing 0.
 */
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

import { useDemo } from '@/state/demo';
import { useProfile } from '@/state/profile';
import { hasInternet, subscribeConnectivity } from './connectivity';
import { isSupabaseConfigured, supabase } from './supabase';

export type LobbyMode = 'classic' | 'advanced';

export function useOnlineCount(mode: LobbyMode = 'classic'): number | null {
  const userId = useProfile((s) => s.userId);
  const forcedOffline = useDemo((s) => s.forceOffline);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured || !userId || forcedOffline) return;
    let channel: RealtimeChannel | null = null;
    let disposed = false;

    const stop = () => {
      if (channel) void supabase.removeChannel(channel);
      channel = null;
      setCount(null);
    };
    const start = async () => {
      if (disposed || channel || !(await hasInternet()) || disposed) return;
      const next = supabase.channel(`lobby:${mode}`, {
        config: { private: true, presence: { key: userId } },
      });
      channel = next;
      next
        .on('presence', { event: 'sync' }, () => {
          setCount(Object.keys(next.presenceState()).length);
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') void next.track({ at: Date.now() });
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setCount(null);
        });
    };

    void start();
    const unsubscribe = subscribeConnectivity((online) => {
      if (online) void start();
      else stop();
    });
    return () => {
      disposed = true;
      unsubscribe();
      stop();
    };
  }, [forcedOffline, mode, userId]);

  return count;
}
