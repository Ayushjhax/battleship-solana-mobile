import { createHash } from 'node:crypto';

import { db, upsertPrivyAccount, type SyncedPrivyAccountResult } from './db';
import { AuthFailure, detailOf } from './errors';
import type { TrustedPrivyAccount } from './privy';

export interface PrivySessionBootstrap {
  readonly profileId: string;
  readonly account: SyncedPrivyAccountResult;
  readonly handoff: {
    readonly tokenHash: string;
    readonly type: 'magiclink';
  };
}

function identityDigest(privyUserId: string): Buffer {
  return createHash('sha256').update(`empire-of-bits:privy:${privyUserId}`).digest();
}

/** Stable auth id: the same verified Privy DID always resolves to one profile. */
export function profileIdForPrivyUser(privyUserId: string): string {
  const bytes = Buffer.from(identityDigest(privyUserId).subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Internal only; the player's verified email remains in privy_accounts. */
export function authEmailForPrivyUser(privyUserId: string): string {
  return `privy-${identityDigest(privyUserId).toString('hex').slice(0, 40)}@users.invalid`;
}

async function mappedProfileId(privyUserId: string): Promise<string | null> {
  const { data, error } = await db()
    .from('privy_accounts')
    .select('profile_id')
    .eq('privy_user_id', privyUserId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle<{ profile_id: string }>();
  if (error) {
    throw new AuthFailure('database_unavailable', `Privy profile lookup failed: ${error.message}`);
  }
  return data?.profile_id ?? null;
}

async function ensureAuthUser(profileId: string, account: TrustedPrivyAccount): Promise<string> {
  const email = authEmailForPrivyUser(account.privyUserId);
  const existing = await db().auth.admin.getUserById(profileId);
  if (existing.error && existing.error.status !== 404) {
    throw new AuthFailure(
      'supabase_admin_failed',
      `Supabase Auth lookup failed: ${existing.error.message}`,
    );
  }

  if (!existing.data.user) {
    const created = await db().auth.admin.createUser({
      id: profileId,
      email,
      email_confirm: true,
      app_metadata: { identity_provider: 'privy', privy_user_id: account.privyUserId },
      user_metadata: { display_name: account.displayName, verified_email: account.email },
    });
    if (created.error) {
      // Two devices can bootstrap the same identity simultaneously. The ID is
      // deterministic, so a racing winner is safe to reuse after one lookup.
      const raced = await db().auth.admin.getUserById(profileId);
      if (raced.error || !raced.data.user) {
        throw new AuthFailure(
          'supabase_admin_failed',
          `Supabase Auth user creation failed: ${created.error.message}`,
        );
      }
    }
  } else {
    const linkedPrivyId = existing.data.user.app_metadata?.privy_user_id;
    if (linkedPrivyId && linkedPrivyId !== account.privyUserId) {
      throw new AuthFailure(
        'profile_conflict',
        'Supabase Auth profile belongs to another Privy identity',
      );
    }
    if (existing.data.user.email !== email || linkedPrivyId !== account.privyUserId) {
      const updated = await db().auth.admin.updateUserById(profileId, {
        email,
        email_confirm: true,
        app_metadata: { identity_provider: 'privy', privy_user_id: account.privyUserId },
        user_metadata: { display_name: account.displayName, verified_email: account.email },
      });
      if (updated.error) {
        throw new AuthFailure(
          'supabase_admin_failed',
          `Supabase Auth user update failed: ${updated.error.message}`,
        );
      }
    }
  }
  return email;
}

/**
 * Creates/finds the Supabase gameplay user behind our own API, initializes the
 * Privy account and points, then returns a one-use token for the mobile client.
 */
export async function bootstrapPrivySession(
  trustedAccount: TrustedPrivyAccount,
): Promise<PrivySessionBootstrap> {
  const profileId =
    (await mappedProfileId(trustedAccount.privyUserId)) ??
    profileIdForPrivyUser(trustedAccount.privyUserId);
  const authEmail = await ensureAuthUser(profileId, trustedAccount);
  const account = await upsertPrivyAccount(profileId, trustedAccount);
  let generated;
  try {
    generated = await db().auth.admin.generateLink({ type: 'magiclink', email: authEmail });
  } catch (error) {
    throw new AuthFailure('session_handoff_failed', `generateLink threw: ${detailOf(error)}`, {
      cause: error,
    });
  }
  if (generated.error || !generated.data.properties.hashed_token) {
    // This is the line that used to surface as "invalid Privy access token":
    // the literal fallback text below contains the word "token".
    throw new AuthFailure(
      'session_handoff_failed',
      `Gameplay session handoff failed: ${generated.error?.message ?? 'link carried no hashed_token'}`,
    );
  }
  if (generated.data.user.id !== profileId) {
    throw new AuthFailure(
      'session_handoff_failed',
      'Gameplay session handoff resolved to the wrong profile',
    );
  }
  return {
    profileId,
    account,
    handoff: { tokenHash: generated.data.properties.hashed_token, type: 'magiclink' },
  };
}
