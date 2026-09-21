export const LAMPORTS_PER_SOL_BIGINT = 1_000_000_000n;

export type SolanaClusterName = 'mainnet-beta' | 'devnet' | 'testnet';

export function solanaConfig(): { rpcUrl: string; cluster: SolanaClusterName } {
  const rawCluster = process.env.EXPO_PUBLIC_SOLANA_CLUSTER?.trim();
  const cluster: SolanaClusterName =
    rawCluster === 'mainnet' || rawCluster === 'mainnet-beta'
      ? 'mainnet-beta'
      : rawCluster === 'testnet'
        ? 'testnet'
        : 'devnet';
  const defaultRpc =
    cluster === 'mainnet-beta'
      ? 'https://api.mainnet-beta.solana.com'
      : `https://api.${cluster}.solana.com`;
  const rpcUrl = process.env.EXPO_PUBLIC_SOLANA_RPC_URL?.trim() || defaultRpc;
  return { rpcUrl, cluster };
}

/** Decimal parser that never rounds through a floating-point number. */
export function parseSolToLamports(value: string): bigint | null {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,9}))?$/.exec(value.trim());
  if (!match) return null;
  const whole = BigInt(match[1] ?? '0');
  const fraction = BigInt((match[2] ?? '').padEnd(9, '0') || '0');
  const lamports = whole * LAMPORTS_PER_SOL_BIGINT + fraction;
  return lamports > 0n ? lamports : null;
}

export function explorerAddressUrl(address: string, cluster: SolanaClusterName): string {
  const query = cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`;
  return `https://explorer.solana.com/address/${encodeURIComponent(address)}${query}`;
}

export function explorerTransactionUrl(signature: string, cluster: SolanaClusterName): string {
  const query = cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`;
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}${query}`;
}

export function shortAddress(address: string, edge = 6): string {
  return address.length <= edge * 2 + 1 ? address : `${address.slice(0, edge)}…${address.slice(-edge)}`;
}

/**
 * Read a balance that reflects a transaction you just confirmed.
 *
 * `confirmTransaction` resolving does not mean the node answering the *next*
 * call has caught up: a pooled RPC endpoint (Helius, and public RPC behind its
 * load balancer) can route `getBalance` to a replica still a few slots behind,
 * which hands back the pre-transaction figure. That is why the wallet and the
 * points screen needed a manual pull-to-refresh to show a transfer that had
 * already settled.
 *
 * `minContextSlot` is the fix the RPC spec provides: the node must be at least
 * that far along or it refuses the read. Nodes that reject it outright, and
 * replicas that simply stay behind, are covered by a short bounded retry.
 */
export interface BalanceReader {
  getBalance(
    address: PublicKeyLike,
    config: { commitment: 'confirmed'; minContextSlot?: number },
  ): Promise<number>;
}

/** Structural stand-in for web3.js `PublicKey`, so this module stays RPC-free. */
export type PublicKeyLike = { toBase58(): string };

export const BALANCE_SYNC_ATTEMPTS = 5;
export const BALANCE_SYNC_DELAY_MS = 400;

export async function readBalanceAtLeastSlot(
  connection: BalanceReader,
  address: PublicKeyLike,
  options: {
    minContextSlot?: number;
    /** Retry while the node still reports this figure. */
    differentFrom?: number | null;
    attempts?: number;
    delayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<number> {
  const {
    minContextSlot,
    differentFrom = null,
    attempts = BALANCE_SYNC_ATTEMPTS,
    delayMs = BALANCE_SYNC_DELAY_MS,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  } = options;

  let last: number | null = null;
  let slotFilterRejected = false;

  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    try {
      const config =
        minContextSlot !== undefined && !slotFilterRejected
          ? ({ commitment: 'confirmed', minContextSlot } as const)
          : ({ commitment: 'confirmed' } as const);
      const balance = await connection.getBalance(address, config);
      last = balance;
      // Settled: either we had no prior figure to beat, or it moved.
      if (differentFrom === null || balance !== differentFrom) return balance;
    } catch (error) {
      // A node too far behind for minContextSlot raises rather than answering;
      // so does one that does not implement the filter. Both mean "try again",
      // but the latter will never succeed with the filter attached.
      if (!slotFilterRejected && isUnsupportedSlotFilter(error)) slotFilterRejected = true;
      if (attempt === Math.max(1, attempts) - 1 && last === null) throw error;
    }
    if (attempt < Math.max(1, attempts) - 1) await sleep(delayMs);
  }

  // Every attempt is spent. The freshest figure seen beats showing nothing.
  if (last !== null) return last;
  throw new Error('Could not read the wallet balance.');
}

function isUnsupportedSlotFilter(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /minContextSlot|unsupported|invalid param|-32602/i.test(message);
}
