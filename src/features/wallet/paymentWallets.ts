/**
 * The wallets screen's model (app/wallets.tsx): the account's wallets as the
 * match server verified them from Privy, which one pays, and what was just
 * linked. Pure (tests/wallet/paymentWallets.test.ts).
 *
 * Only a wallet the server lists can be chosen to pay — the app never offers an
 * address it merely holds a session for. A wallet linked a moment ago appears
 * once the server's Privy sync has recorded it, or is reported as a conflict
 * when the server already records it for another account.
 */
import type { AccountWallets } from '@/net/points';

export interface WalletRow {
  readonly address: string;
  readonly kind: 'embedded' | 'external';
  readonly name: string;
  /** Pays for points and receives sales. */
  readonly paying: boolean;
  /** This phone holds a wallet-app connection for it. */
  readonly connectedHere: boolean;
}

/** 'phantom' → 'Phantom'; the wallet's own name, never a guess at the device. */
export function walletClientName(client: string | null | undefined): string | null {
  if (!client || client === 'unknown' || client === 'privy') return null;
  return client.charAt(0).toUpperCase() + client.slice(1);
}

export function walletRows(
  wallets: AccountWallets | null,
  connected: { readonly address: string; readonly label: string | null } | null,
): WalletRow[] {
  if (!wallets) return [];
  const paying = wallets.paymentWallet.problem ? null : wallets.paymentWallet.address;
  return wallets.wallets
    .map((wallet) => {
      const here = connected?.address === wallet.address;
      const name =
        wallet.kind === 'embedded'
          ? 'Game wallet (Privy)'
          : (here && connected?.label) || walletClientName(wallet.walletClient) || 'External wallet';
      return { address: wallet.address, kind: wallet.kind, name, paying: wallet.address === paying, connectedHere: here };
    })
    .sort((a, b) => Number(b.paying) - Number(a.paying) || Number(a.kind === 'external') - Number(b.kind === 'external'));
}

export type LinkedWalletState = 'verified' | 'conflict' | 'pending';

/**
 * After linking: waits for the server's sync to record `address` for this
 * account, or to report it held by another account. 'pending' when neither
 * happened in time — the next sync will settle it.
 */
export async function awaitLinkedWallet(options: {
  readonly address: string;
  readonly load: () => Promise<AccountWallets>;
  readonly conflicts: () => readonly string[];
  readonly attempts?: number;
  readonly delayMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}): Promise<{ readonly state: LinkedWalletState; readonly wallets: AccountWallets | null }> {
  const attempts = options.attempts ?? 8;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let latest: AccountWallets | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (options.conflicts().includes(options.address)) return { state: 'conflict', wallets: latest };
    try {
      latest = await options.load();
      if (latest.wallets.some((wallet) => wallet.address === options.address)) return { state: 'verified', wallets: latest };
    } catch {
      // The next attempt asks again.
    }
    if (attempt < attempts - 1) await sleep(options.delayMs ?? 1500);
  }
  return { state: options.conflicts().includes(options.address) ? 'conflict' : 'pending', wallets: latest };
}
