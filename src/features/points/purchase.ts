/**
 * Buying 100 points: the order, the payment and the credit, in the order that
 * never loses a payment.
 *
 *   1. The purchase is saved on the phone before anything else, so a crash at
 *      any later step still leaves something to finish.
 *   2. The server makes the order (0018): its payer is the account's payment
 *      wallet, its amount and treasury are the server's, and it expires.
 *   3. Before paying, the order is checked against this phone: the payer must
 *      be the wallet that is about to sign, the server's network must be the
 *      app's, and the order must still be open. Anything else is refused with
 *      nothing paid — in particular an order for an external payment wallet is
 *      never quietly paid from the embedded one.
 *   4. The wallet signs and sends; its signature is saved at once.
 *   5. Once the transfer is confirmed on chain, the server verifies it and
 *      credits the order, once.
 *
 * A purchase saved without a signature (the app closed mid-send) is finished
 * by asking the server to look for the payment (`reconcile`), never by paying
 * again. So is one whose signature never confirmed, once its blockhash is long
 * dead. The signer is the Privy embedded wallet, or — when the account chose
 * one — the player's external wallet over Mobile Wallet Adapter; each signs
 * only orders made for it.
 *
 * Pure: every network call and the signer come in as `deps`
 * (tests/points/purchase.test.ts drives each path).
 */
import type { PointBuyOrder, PointNetwork } from '@/net/points';
import type { PendingPointBuy } from '@/state/points';

/** After an unpaid order's expiry, how long a payment could still land (a blockhash's life, generously). */
export const ABANDON_AFTER_EXPIRY_MS = 5 * 60_000;

export interface Transfer {
  readonly from: string;
  readonly to: string;
  readonly lamports: number;
}

export interface PurchaseDeps {
  readonly newRequestId: () => string;
  readonly savePending: (pending: PendingPointBuy | null) => void;
  /** Null when the server predates orders and only takes pay-then-confirm. */
  readonly createOrder: (requestId: string) => Promise<PointBuyOrder | null>;
  /** The address of the wallet that will sign. */
  readonly signerAddress: string;
  /** Which wallet signs: the embedded one (the default) or the player's external wallet. */
  readonly signerKind?: 'embedded' | 'external';
  /**
   * What the player was shown before tapping Pay: the order must be for the
   * same amount to the same treasury, or nothing is paid.
   */
  readonly expected?: { readonly treasuryAddress: string; readonly lamports: number };
  /** Shows the order's details; rejects when the player does not go ahead (nothing is paid). */
  readonly approveOrder?: (order: PointBuyOrder) => Promise<void>;
  readonly appNetwork: Exclude<PointNetwork, 'unknown'>;
  /** Signs and sends the transfer; resolves with its signature. */
  readonly pay: (transfer: Transfer) => Promise<string>;
  /** Waits for the transfer on chain. False: it landed and failed. */
  readonly confirmOnChain: (signature: string) => Promise<boolean>;
  readonly confirmCredit: (requestId: string, signature: string) => Promise<{ balance: number }>;
  readonly reconcile: (requestId: string) => Promise<{ status: 'confirmed' | 'awaiting_payment'; balance: number }>;
  /** For a server without orders: the quote's treasury and amount. */
  readonly legacyQuote: { readonly treasuryAddress: string; readonly lamports: number } | null;
  readonly now: () => number;
}

export type PurchaseRefusal =
  | 'external_payment_wallet'
  | 'payment_wallet_changed'
  | 'payer_mismatch'
  | 'network_mismatch'
  | 'order_mismatch'
  | 'order_expired'
  | 'order_missing';

export type PurchaseOutcome =
  /** Points credited after the server verified the payment. */
  | { readonly kind: 'credited'; readonly balance: number }
  /** Nothing was paid. */
  | { readonly kind: 'refused'; readonly reason: PurchaseRefusal; readonly message: string }
  /** The transfer landed and failed: no SOL moved to the treasury, nothing credited. */
  | { readonly kind: 'failed'; readonly message: string }
  /** Paid, or possibly paid, and not credited yet: kept, to be finished later. */
  | { readonly kind: 'waiting'; readonly message: string };

function short(address: string): string {
  return address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

function refusalFor(order: PointBuyOrder, deps: PurchaseDeps): PurchaseOutcome | null {
  const signerKind = deps.signerKind ?? 'embedded';
  if (order.payer.kind !== signerKind) {
    return order.payer.kind === 'external'
      ? {
          kind: 'refused',
          reason: 'external_payment_wallet',
          message:
            `This purchase is set to be paid from your external wallet (${short(order.payer.address)}), ` +
            'never from your game wallet. Nothing was charged; refresh the desk to pay from that wallet.',
        }
      : {
          kind: 'refused',
          reason: 'payment_wallet_changed',
          message: 'Your payment wallet changed to your game wallet. Nothing was charged; refresh the desk and try again.',
        };
  }
  if (order.payer.address !== deps.signerAddress) {
    return {
      kind: 'refused',
      reason: 'payer_mismatch',
      message:
        `The server expects this payment from ${short(order.payer.address)}, ` +
        `not from ${signerKind === 'embedded' ? "this phone's game wallet" : 'the wallet you chose'} (${short(deps.signerAddress)}). Nothing was charged.`,
    };
  }
  if (
    deps.expected &&
    (order.treasuryAddress !== deps.expected.treasuryAddress || order.lamports !== deps.expected.lamports)
  ) {
    return {
      kind: 'refused',
      reason: 'order_mismatch',
      message: 'The order did not match the price shown. Nothing was charged; refresh the desk and try again.',
    };
  }
  if (order.network !== deps.appNetwork) {
    return {
      kind: 'refused',
      reason: 'network_mismatch',
      message:
        order.network === 'unknown'
          ? 'The game server could not confirm which Solana network it checks payments on. Nothing was charged; try again shortly.'
          : `The game server checks payments on ${order.network}, but this app is set to ${deps.appNetwork}. Nothing was charged.`,
    };
  }
  if (!Number.isFinite(Date.parse(order.expiresAt)) || Date.parse(order.expiresAt) <= deps.now() || order.status !== 'awaiting_payment') {
    return {
      kind: 'refused',
      reason: 'order_expired',
      message: 'That purchase expired before it was paid. Nothing was charged; start a new one.',
    };
  }
  return null;
}

/**
 * Whether a failed `pay` certainly sent nothing. A wallet that says so (the MWA
 * signer's `nothingSent`/`mayHaveSent`) is believed; otherwise only the
 * player's own refusal counts, as before.
 */
function nothingWasSent(error: unknown): boolean {
  const flags = error as { nothingSent?: unknown; mayHaveSent?: unknown } | null;
  if (flags?.mayHaveSent === true) return false;
  if (flags?.nothingSent === true) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /cancel|reject|declin|denied/i.test(message);
}

async function payAndCredit(
  requestId: string,
  transfer: Transfer,
  expiresAt: string | null,
  deps: PurchaseDeps,
): Promise<PurchaseOutcome> {
  let signature: string;
  try {
    signature = await deps.pay(transfer);
  } catch (error) {
    // Declined in the wallet: nothing was sent. Any other failure may have
    // sent it anyway, so the saved purchase stays for reconcile to settle.
    if (nothingWasSent(error)) deps.savePending(null);
    throw error;
  }
  deps.savePending({ requestId, signature, expiresAt });
  if (!(await deps.confirmOnChain(signature))) {
    deps.savePending(null);
    return { kind: 'failed', message: 'The Solana transfer failed, so no points were bought.' };
  }
  const credit = await deps.confirmCredit(requestId, signature);
  deps.savePending(null);
  return { kind: 'credited', balance: credit.balance };
}

/** Starts a purchase from the player's tap. */
export async function buyPoints(deps: PurchaseDeps): Promise<PurchaseOutcome> {
  const requestId = deps.newRequestId();
  deps.savePending({ requestId, signature: null, expiresAt: null });
  let order: PointBuyOrder | null;
  try {
    order = await deps.createOrder(requestId);
  } catch (error) {
    deps.savePending(null);
    throw error;
  }

  if (!order) {
    if (deps.signerKind === 'external') {
      deps.savePending(null);
      return { kind: 'refused', reason: 'order_missing', message: 'External wallet purchases require the updated order server. Nothing was charged.' };
    }
    // A server from before orders: it only credits the embedded wallet, and
    // only once the signature is in hand, exactly as before.
    deps.savePending(null);
    if (!deps.legacyQuote) throw new Error('The points quote is not loaded yet.');
    const legacyId = deps.newRequestId();
    const transfer = { from: deps.signerAddress, to: deps.legacyQuote.treasuryAddress, lamports: deps.legacyQuote.lamports };
    const signature = await deps.pay(transfer);
    deps.savePending({ requestId: legacyId, signature, expiresAt: null });
    if (!(await deps.confirmOnChain(signature))) {
      deps.savePending(null);
      return { kind: 'failed', message: 'The Solana transfer failed, so no points were bought.' };
    }
    const credit = await deps.confirmCredit(legacyId, signature);
    deps.savePending(null);
    return { kind: 'credited', balance: credit.balance };
  }

  deps.savePending({ requestId, signature: null, expiresAt: order.expiresAt });
  const refused = refusalFor(order, deps);
  if (refused) {
    deps.savePending(null);
    return refused;
  }
  try { await deps.approveOrder?.(order); } catch (error) { deps.savePending(null); throw error; }
  const afterApproval = refusalFor(order, deps);
  if (afterApproval) { deps.savePending(null); return afterApproval; }
  return payAndCredit(
    requestId,
    { from: order.payer.address, to: order.treasuryAddress, lamports: order.lamports },
    order.expiresAt,
    deps,
  );
}

/**
 * Finishes a saved purchase: re-reports its signature (crediting is idempotent
 * on the server) or, without one, has the server look for the payment. Never
 * pays again.
 */
export async function resumePurchase(pending: PendingPointBuy, deps: PurchaseDeps): Promise<PurchaseOutcome> {
  const expiresAt = pending.expiresAt ? Date.parse(pending.expiresAt) : Number.NaN;
  const pastAnyPayment = Number.isFinite(expiresAt) && deps.now() > expiresAt + ABANDON_AFTER_EXPIRY_MS;
  if (pending.signature) {
    try {
      const credit = await deps.confirmCredit(pending.requestId, pending.signature);
      deps.savePending(null);
      return { kind: 'credited', balance: credit.balance };
    } catch (error) {
      // An order's signature that still isn't credited long after the order
      // expired is a transfer that never landed (its blockhash is dead) — or
      // one the server can find on chain by itself. Ask it to look, as for a
      // purchase saved without a signature. Older purchases keep retrying.
      if (!pastAnyPayment) throw error;
    }
  }
  let found: { status: 'confirmed' | 'awaiting_payment'; balance: number };
  try {
    found = await deps.reconcile(pending.requestId);
  } catch (error) {
    // PointsRequestError carries the status; matched by shape so this module stays pure.
    if ((error as { status?: unknown } | null)?.status === 404) {
      // The order never existed (it failed before it was made): nothing to finish.
      deps.savePending(null);
      return { kind: 'refused', reason: 'order_missing', message: 'That purchase was never placed, so nothing was charged.' };
    }
    throw error;
  }
  if (found.status === 'confirmed') {
    deps.savePending(null);
    return { kind: 'credited', balance: found.balance };
  }
  if (pastAnyPayment) {
    deps.savePending(null);
    return {
      kind: 'refused',
      reason: 'order_expired',
      message: 'No payment arrived for that purchase before it expired, so nothing was charged.',
    };
  }
  return { kind: 'waiting', message: 'No payment has arrived for that purchase yet. Check again shortly.' };
}
