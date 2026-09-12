import { z } from 'zod';

import { useProfile } from '@/state/profile';
import { ensureSession } from './auth';
import { hasInternet } from './connectivity';
import { getAccessToken } from './api';

const ResponseSchema = z.object({
  acknowledged: z.array(z.string()),
  profile: z.object({
    rankPoints: z.number().int(),
    battlesPlayed: z.number().int(),
    battlesWon: z.number().int(),
    coins: z.number().int(),
  }),
});

let inFlight: Promise<boolean> | null = null;

function endpoint(): string | null {
  const explicit = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (explicit) return `${explicit.replace(/\/$/, '')}/offline-results`;
  const ws = process.env.EXPO_PUBLIC_WS_URL?.trim();
  if (!ws) return null;
  try {
    const url = new URL(ws);
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    url.pathname = '/offline-results';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

async function flush(): Promise<boolean> {
  let profile = useProfile.getState();
  if (profile.pendingResults.length === 0) return true;
  const url = endpoint();
  if (!url || !(await hasInternet())) return false;

  let userId = profile.userId;
  if (!userId) {
    userId = await ensureSession();
    if (!userId) return false;
    useProfile.getState().setUserId(userId);
  }
  const token = await getAccessToken();
  if (!token.ok) return false;

  profile = useProfile.getState();
  const snapshot = [...profile.pendingResults];
  if (snapshot.length === 0) return true;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.value}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ results: snapshot }),
    });
    if (!response.ok) return false;
    const parsed = ResponseSchema.safeParse(await response.json());
    if (!parsed.success) return false;
    useProfile.getState().settleResults(parsed.data.acknowledged, parsed.data.profile);
    return true;
  } catch {
    return false;
  }
}

/** Dedupes foreground and connectivity listeners into one request. */
export function flushPendingResults(): Promise<boolean> {
  if (inFlight) return inFlight;
  inFlight = flush().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
