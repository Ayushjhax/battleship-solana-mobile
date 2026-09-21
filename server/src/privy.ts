/**
 * Privy is verified only on the server. The client sends an access token; this
 * module verifies its signature/audience, fetches the authoritative user, and
 * reduces it to the identity fields the game actually needs to retain.
 */
import { PrivyClient, type User } from '@privy-io/node';

import { AuthFailure, detailOf } from './errors';
import type { Json } from '../../src/net/database.types';

export interface TrustedPrivyAccount {
  readonly privyUserId: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly authProvider: string;
  readonly solanaWalletAddress: string | null;
  readonly solanaWalletId: string | null;
  readonly linkedAccounts: Json;
  readonly privyCreatedAt: string;
}

let client: PrivyClient | null = null;

function privyClient(): PrivyClient {
  if (client) return client;
  const appId = process.env.PRIVY_APP_ID?.trim();
  const appSecret = process.env.PRIVY_APP_SECRET?.trim();
  if (!appId || !appSecret) {
    throw new AuthFailure('privy_not_configured', 'PRIVY_APP_ID and PRIVY_APP_SECRET must be set');
  }
  const jwtVerificationKey = process.env.PRIVY_JWT_VERIFICATION_KEY?.trim() || undefined;
  client = new PrivyClient({ appId, appSecret, jwtVerificationKey });
  return client;
}

function compactLinkedAccount(account: User['linked_accounts'][number]): Json {
  if (account.type === 'email') return { type: account.type, address: account.address };
  if (account.type === 'google_oauth') {
    return {
      type: account.type,
      email: account.email,
      name: account.name,
      subject: account.subject,
    };
  }
  if (account.type === 'wallet') {
    return {
      type: account.type,
      address: account.address,
      chainType: account.chain_type,
      connectorType: 'connector_type' in account ? (account.connector_type ?? null) : null,
      walletClient: account.wallet_client,
      walletId: 'id' in account ? (account.id ?? null) : null,
    };
  }
  return { type: account.type };
}

/** Pure and exported so account-shape selection is covered by tests. */
export function normalizePrivyUser(user: User): TrustedPrivyAccount {
  const google = user.linked_accounts.find((account) => account.type === 'google_oauth');
  const emailAccount = user.linked_accounts.find((account) => account.type === 'email');
  const solanaWallet = user.linked_accounts.find(
    (account) =>
      account.type === 'wallet' &&
      account.chain_type === 'solana' &&
      'connector_type' in account &&
      account.connector_type === 'embedded',
  );

  const email = google?.email ?? emailAccount?.address ?? null;
  return {
    privyUserId: user.id,
    email,
    displayName: google?.name ?? null,
    authProvider: google ? 'google' : emailAccount ? 'email' : 'unknown',
    solanaWalletAddress:
      solanaWallet && 'address' in solanaWallet ? String(solanaWallet.address) : null,
    solanaWalletId: solanaWallet && 'id' in solanaWallet ? (solanaWallet.id ?? null) : null,
    linkedAccounts: user.linked_accounts.map(compactLinkedAccount),
    privyCreatedAt: new Date(user.created_at * 1000).toISOString(),
  };
}

export async function verifyAndLoadPrivyUser(accessToken: string): Promise<TrustedPrivyAccount> {
  const privy = privyClient();

  // Only the signature/audience check may report a bad credential. Everything
  // after it has already proven the caller's identity, so a failure there is
  // ours to own rather than theirs to re-authenticate against.
  let userId: string;
  try {
    const verified = await privy.utils().auth().verifyAccessToken(accessToken);
    userId = verified.user_id;
  } catch (error) {
    throw new AuthFailure('privy_token_invalid', detailOf(error), { cause: error });
  }

  let user: User;
  try {
    user = await privy.users()._get(userId);
  } catch (error) {
    // Privy accepted the token; their user API being unreachable is an outage
    // on the identity provider, not an invalid credential.
    throw new AuthFailure(
      'identity_provider_unavailable',
      `Privy user fetch failed: ${detailOf(error)}`,
      { cause: error },
    );
  }

  if (user.id !== userId) {
    throw new AuthFailure('privy_token_invalid', 'Privy user did not match token subject');
  }
  return normalizePrivyUser(user);
}

/** Test-only: make env-specific client creation deterministic between tests. */
export function __resetPrivyClientForTests(): void {
  client = null;
}
