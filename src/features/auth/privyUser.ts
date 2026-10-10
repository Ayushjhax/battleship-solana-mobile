import type { User } from '@privy-io/expo';

type LinkedAccount = User['linked_accounts'][number];

export function privyEmail(user: User | null): string | null {
  if (!user) return null;
  const google = user.linked_accounts.find((account) => account.type === 'google_oauth');
  if (google?.email) return google.email;
  const email = user.linked_accounts.find((account) => account.type === 'email');
  return email?.address ?? null;
}

export function privyDisplayName(user: User | null): string | null {
  if (!user) return null;
  const google = user.linked_accounts.find((account) => account.type === 'google_oauth');
  return google?.name ?? null;
}

/** Privy's own markers for a key it holds — the same test the match server uses (server/src/privy.ts). */
function isEmbeddedWallet(account: LinkedAccount): boolean {
  if (account.type !== 'wallet') return false;
  const connector = 'connector_type' in account ? account.connector_type : undefined;
  const client = 'wallet_client_type' in account ? account.wallet_client_type : undefined;
  return connector === 'embedded' || client === 'privy';
}

export interface ExternalSolanaWallet {
  readonly address: string;
  readonly walletClientType: string | null;
}

/** The player's own Solana wallets Privy verified (login or linked), never the embedded one. */
export function externalSolanaWallets(user: User | null): ExternalSolanaWallet[] {
  if (!user) return [];
  return user.linked_accounts.flatMap((account) =>
    account.type === 'wallet' && account.chain_type === 'solana' && !isEmbeddedWallet(account)
      ? [{ address: account.address, walletClientType: 'wallet_client_type' in account ? (account.wallet_client_type ?? null) : null }]
      : [],
  );
}

export function privyLoginMethods(user: User | null): string[] {
  if (!user) return [];
  const methods: string[] = [];
  for (const account of user.linked_accounts) {
    if (account.type === 'google_oauth') methods.push('Google');
    else if (account.type === 'email') methods.push('Email OTP');
  }
  if (externalSolanaWallets(user).length > 0) methods.push('Solana wallet');
  return Array.from(new Set(methods));
}

/** Account types that sign a player in by themselves. Wallets are counted separately. */
const SIGN_IN_TYPES = new Set(['email', 'phone', 'passkey', 'farcaster', 'telegram', 'custom_auth', 'cross_app']);

/** How many ways the user could still sign in if `address` were unlinked. */
export function signInMethodsWithout(user: User, address: string): number {
  return user.linked_accounts.filter((account) => {
    if (account.type === 'wallet') {
      return !isEmbeddedWallet(account) && account.address !== address;
    }
    return SIGN_IN_TYPES.has(account.type) || account.type.endsWith('_oauth');
  }).length;
}

/**
 * Why unlinking this wallet must not go ahead, or null when it may. Unlinking
 * removes a way to sign in and the wallet's right to pay or be paid; it never
 * moves points or SOL. Privy alone would allow it while the embedded wallet
 * remains, but that wallet cannot sign anyone in.
 */
export function unlinkRefusal(user: User | null, address: string, paymentWalletAddress: string | null): string | null {
  if (!user) return 'Sign in first.';
  if (!externalSolanaWallets(user).some((wallet) => wallet.address === address)) {
    return 'Only a wallet you connected yourself can be unlinked.';
  }
  if (signInMethodsWithout(user, address) === 0) {
    return 'This wallet is your only way to sign in. Link Google, email or another wallet first.';
  }
  if (paymentWalletAddress === address) {
    return 'This wallet pays for your points. Choose another payment wallet first.';
  }
  return null;
}
