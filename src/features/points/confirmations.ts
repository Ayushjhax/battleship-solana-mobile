/**
 * What the points desk shows before money moves: every figure comes from the
 * server's order or quote, the network fee from the RPC's own estimate (or the
 * wallet's screen when there is none) — never a number made up here. Pure
 * (tests/points/confirmations.test.ts).
 */
import type { PaymentWallet, PointBuyOrder, PointNetwork } from '@/net/points';
import { formatLamports } from '@/wallet/solana';

function walletName(kind: 'embedded' | 'external' | null | undefined): string {
  return kind === 'external' ? 'your external wallet' : 'your game wallet';
}

function networkName(network: PointNetwork): string {
  return network === 'unknown' ? 'an unconfirmed network' : `Solana ${network}`;
}

/** Shown before an external wallet is asked to pay an order. */
export function purchaseApproval(
  order: PointBuyOrder,
  options: { readonly feeLamports: number | null; readonly walletLabel: string | null },
): { readonly title: string; readonly body: string } {
  const from = options.walletLabel
    ? `${walletName(order.payer.kind)} “${options.walletLabel}”`
    : walletName(order.payer.kind);
  const fee =
    options.feeLamports === null
      ? 'Network fee: shown by your wallet before you approve.'
      : `Network fee: about ${formatLamports(options.feeLamports)} SOL by the network’s estimate, paid from the same wallet. Your wallet may add a priority fee and shows the final figure.`;
  const expires = new Date(order.expiresAt);
  return {
    title: `Pay ${order.sol} SOL for ${order.points} points?`,
    body: [
      `Amount: ${order.sol} SOL (${order.lamports.toLocaleString('en-US')} lamports).`,
      `From: ${from}\n${order.payer.address}`,
      `To: the game treasury\n${order.treasuryAddress}`,
      `Network: ${networkName(order.network)}.`,
      fee,
      `The order expires at ${expires.toLocaleTimeString()}. Your wallet app will ask you to approve this exact transfer. Points are credited after the server sees it confirmed on chain.`,
    ].join('\n\n'),
  };
}

/** Shown before a sale: what is redeemed, what arrives, and where. */
export function saleConfirmation(
  quote: { readonly points: number; readonly sol: string; readonly lamports: number; readonly network?: PointNetwork },
  destination: PaymentWallet | undefined,
  fallbackAddress: string | null,
): { readonly title: string; readonly body: string } | null {
  const address = destination?.address ?? fallbackAddress;
  if (!address) return null;
  const kind = destination?.address ? destination.kind : 'embedded';
  return {
    title: `Sell ${quote.points} points for ${quote.sol} SOL?`,
    body: [
      `Redeems: ${quote.points} points.`,
      `You receive: ${quote.sol} SOL (${quote.lamports.toLocaleString('en-US')} lamports). The treasury pays the network fee.`,
      `Paid to: ${walletName(kind)}\n${address}`,
      `Network: ${networkName(quote.network ?? 'unknown')}.`,
      'The destination is fixed when you confirm. No signature is needed to receive it.',
    ].join('\n\n'),
  };
}
