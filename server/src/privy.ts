/**
 * Privy is verified only on the server. The client sends an access token; this
 * module verifies its signature/audience, fetches the authoritative user, and
 * reduces it to the identity fields the game actually needs to retain.
 */
import { PrivyClient, type User } from '@privy-io/node';

import { AuthFailure, detailOf } from './errors';
import type { Json } from '../../src/net/database.types';

/** A Solana wallet Privy has verified for the identity, as Privy's own server reports it. */
export interface VerifiedWallet {
  readonly address: string;
  /** 'embedded': Privy holds the key. 'external': the player's own wallet app. */
  readonly kind: 'embedded' | 'external';
  /** The wallet's name as Privy recorded it (`wallet_client_type`), when it has one. */
  readonly walletClient: string | null;
  readonly connectorType: string | null;
}

export type LoginMethod = 'google' | 'email' | 'solana_wallet';

export interface TrustedPrivyAccount {
  readonly privyUserId: string;
  readonly email: string | null;
  readonly displayName: string | null;
  /** The one label privy_accounts keeps: Google, then email, then a Solana wallet. */
  readonly authProvider: string;
  /** Every way this identity can sign in — a player may have several. */
  readonly loginMethods: readonly LoginMethod[];
  /** The embedded wallet only. External wallets are in `wallets`, never here. */
  readonly solanaWalletAddress: string | null;
  readonly solanaWalletId: string | null;
  /** Every Solana wallet Privy has verified for the identity, embedded and external. */
  readonly wallets: readonly VerifiedWallet[];
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
      walletClientType: 'wallet_client_type' in account ? (account.wallet_client_type ?? null) : null,
      walletId: 'id' in account ? (account.id ?? null) : null,
    };
  }
  return { type: account.type };
}

type LinkedAccount = User['linked_accounts'][number];

function solanaWalletOf(account: LinkedAccount): VerifiedWallet | null {
  if (account.type !== 'wallet' || account.chain_type !== 'solana' || !('address' in account)) return null;
  const address = String(account.address ?? '');
  if (!address) return null;
  const connectorType = 'connector_type' in account ? (account.connector_type ?? null) : null;
  const clientType = 'wallet_client_type' in account ? (account.wallet_client_type ?? null) : null;
  // Privy's own markers for a key it holds; anything else is the player's wallet.
  const embedded = connectorType === 'embedded' || clientType === 'privy';
  return {
    address,
    kind: embedded ? 'embedded' : 'external',
    walletClient: clientType,
    connectorType,
  };
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
  const wallets = user.linked_accounts
    .map(solanaWalletOf)
    .filter((wallet): wallet is VerifiedWallet => wallet !== null);
  const hasExternalWallet = wallets.some((wallet) => wallet.kind === 'external');
  const loginMethods: LoginMethod[] = [];
  if (google) loginMethods.push('google');
  if (emailAccount) loginMethods.push('email');
  // A Solana wallet Privy verified with Sign In With Solana is one more way in.
  if (hasExternalWallet) loginMethods.push('solana_wallet');

  const email = google?.email ?? emailAccount?.address ?? null;
  return {
    privyUserId: user.id,
    email,
    displayName: google?.name ?? null,
    authProvider: loginMethods[0] ?? 'unknown',
    loginMethods,
    solanaWalletAddress:
      solanaWallet && 'address' in solanaWallet ? String(solanaWallet.address) : null,
    solanaWalletId: solanaWallet && 'id' in solanaWallet ? (solanaWallet.id ?? null) : null,
    wallets,
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
