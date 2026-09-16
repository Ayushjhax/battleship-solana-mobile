import { z } from 'zod';

import type { SyncedPrivyAccount } from '@/state/privySync';
import {
  getAccessToken as getSupabaseAccessToken,
  installGameplaySession,
} from './api';
import { hasInternet } from './connectivity';

const AccountSchema = z.object({
  profileId: z.string().uuid(),
  privyUserId: z.string().min(1),
  email: z.string().email().nullable(),
  displayName: z.string().nullable(),
  authProvider: z.string().min(1),
  solanaWalletAddress: z.string().nullable(),
  solanaWalletId: z.string().nullable(),
  privyCreatedAt: z.string().min(1),
  pointBalance: z.number().int().nonnegative(),
  welcomeAwarded: z.boolean(),
});

const ResponseSchema = z.object({
  account: AccountSchema,
  session: z
    .object({ tokenHash: z.string().min(20), type: z.literal('magiclink') })
    .nullable(),
});

function endpoint(): string | null {
  const explicit = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (explicit) return `${explicit.replace(/\/$/, '')}/auth/privy/sync`;
  const ws = process.env.EXPO_PUBLIC_WS_URL?.trim();
  if (!ws) return null;
  try {
    const url = new URL(ws);
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    url.pathname = '/auth/privy/sync';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

async function responseMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : `server returned ${response.status}`;
  } catch {
    return `server returned ${response.status}`;
  }
}

export async function syncPrivyAccount(privyAccessToken: string): Promise<SyncedPrivyAccount> {
  const url = endpoint();
  if (!url) throw new Error('Match server URL is not configured');
  if (!(await hasInternet())) throw new Error('You are offline. Account sync will retry later.');

  const supabaseToken = await getSupabaseAccessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${privyAccessToken}`,
    'Content-Type': 'application/json',
  };
  if (supabaseToken.ok) headers['X-Supabase-Access-Token'] = supabaseToken.value;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      body: '{}',
      headers,
    });
  } catch {
    throw new Error('The game server could not be reached. Start the backend and retry.');
  }
  if (!response.ok) throw new Error(await responseMessage(response));
  const parsed = ResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('Account sync returned an invalid response');
  if (parsed.data.session) {
    const installed = await installGameplaySession(
      parsed.data.session.tokenHash,
      parsed.data.session.type,
    );
    if (!installed.ok) {
      throw new Error(`Could not open the gameplay session: ${installed.error.message}`);
    }
    if (installed.value.userId !== parsed.data.account.profileId) {
      throw new Error('Gameplay session did not match the verified Privy account');
    }
  }
  return parsed.data.account;
}
