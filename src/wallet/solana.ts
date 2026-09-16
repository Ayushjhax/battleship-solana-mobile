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
