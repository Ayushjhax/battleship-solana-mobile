import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type ParsedInstruction,
  type PartiallyDecodedInstruction,
} from '@solana/web3.js';
import bs58 from 'bs58';

import {
  beginPointSell,
  beginPointSellTo,
  completePointBuy,
  completePointSell,
  createPointBuyOrder as recordPointBuyOrder,
  creditPointBuyOrder,
  fetchPaymentWallet,
  fetchPointBalance,
  fetchPointBalances,
  fetchPointTrade,
  fetchVerifiedWalletAddress,
  isSignatureCredited,
  listVerifiedWallets,
  markPointSellBroadcast,
  refundPointSell,
  type PaymentWallet,
  type PointTradeRow,
} from './db';

export const POINT_TRADE_POINTS = 100;
export const POINT_TRADE_LAMPORTS = 1_000_000;
export const WAGER_STAKE_POINTS = 50;
const FEE_RESERVE_LAMPORTS = 20_000;
/** How long the app may offer a buy order before it must ask for a new one. */
export const BUY_ORDER_TTL_MS = 10 * 60_000;
/** How many of the payer's latest transactions a reconcile looks through. */
const RECONCILE_SCAN = 25;
/** Slack for clocks: a payment can't be older than its order, give or take this. */
const RECONCILE_SLACK_SECONDS = 120;

export type SolanaNetwork = 'mainnet-beta' | 'devnet' | 'testnet' | 'unknown';
/** Genesis hashes of the public clusters: the RPC says which one it serves. */
const GENESIS: Readonly<Record<string, SolanaNetwork>> = {
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d': 'mainnet-beta',
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG: 'devnet',
  '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY': 'testnet',
};

/** Why a payment can't use a wallet: the account's state, never a server fault. */
export class PaymentWalletError extends Error {
  constructor(
    readonly reason: NonNullable<PaymentWallet['problem']> | 'payer_mismatch',
    message: string,
  ) {
    super(message);
    this.name = 'PaymentWalletError';
  }
}

const PAYMENT_WALLET_COPY: Record<NonNullable<PaymentWallet['problem']>, string> = {
  payment_wallet_unavailable:
    'Your chosen payment wallet is no longer linked to this account. Choose a payment wallet again.',
  payment_wallet_not_chosen: 'Choose which of your wallets pays for points.',
  no_payment_wallet: 'This account has no verified Solana wallet to pay with yet.',
};

function usablePaymentWallet(wallet: PaymentWallet): { address: string; kind: 'embedded' | 'external' } {
  if (wallet.problem || !wallet.address || !wallet.kind) {
    const reason = wallet.problem ?? 'no_payment_wallet';
    throw new PaymentWalletError(reason, PAYMENT_WALLET_COPY[reason]);
  }
  return { address: wallet.address, kind: wallet.kind };
}

interface TreasuryRuntime {
  readonly connection: Connection;
  readonly keypair: Keypair;
  readonly publicKey: PublicKey;
}

let runtime: TreasuryRuntime | null = null;

function parseSolToLamports(value: string): number | null {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,9}))?$/.exec(value.trim());
  if (!match) return null;
  const whole = BigInt(match[1] ?? '0');
  const fraction = BigInt((match[2] ?? '').padEnd(9, '0') || '0');
  const lamports = whole * 1_000_000_000n + fraction;
  return lamports <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(lamports) : null;
}

function treasury(): TreasuryRuntime {
  if (runtime) return runtime;
  const rpcUrl = process.env.SOLANA_RPC_URL?.trim();
  const publicAddress = process.env.TREASURY_PUBLIC_KEY?.trim();
  const privateValue = process.env.TREASURY_PRIVATE_KEY?.trim();
  const pointCost = Number(process.env.SELL_POINTS_COST ?? POINT_TRADE_POINTS);
  const payout = parseSolToLamports(process.env.SELL_SOL_PAYOUT ?? '0.001');
  if (!rpcUrl || !publicAddress || !privateValue) {
    throw new Error('Treasury wallet is not configured on the server');
  }
  if (pointCost !== POINT_TRADE_POINTS || payout !== POINT_TRADE_LAMPORTS) {
    throw new Error('Treasury point/SOL rate does not match the supported quote');
  }

  let bytes: unknown;
  try {
    bytes = JSON.parse(privateValue);
  } catch {
    throw new Error('TREASURY_PRIVATE_KEY must be a JSON byte array');
  }
  if (
    !Array.isArray(bytes) ||
    bytes.length !== 64 ||
    bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
  ) {
    throw new Error('TREASURY_PRIVATE_KEY must contain exactly 64 bytes');
  }
  const keypair = Keypair.fromSecretKey(Uint8Array.from(bytes as number[]));
  const publicKey = new PublicKey(publicAddress);
  if (!keypair.publicKey.equals(publicKey)) {
    throw new Error('Treasury private key does not match TREASURY_PUBLIC_KEY');
  }
  runtime = { connection: new Connection(rpcUrl, 'confirmed'), keypair, publicKey };
  return runtime;
}

let network: Promise<SolanaNetwork> | null = null;

/** The cluster the treasury's RPC serves — every payment is checked on this one. */
export function treasuryNetwork(): Promise<SolanaNetwork> {
  if (!network) {
    network = treasury()
      .connection.getGenesisHash()
      .then((hash) => GENESIS[hash] ?? 'unknown')
      .catch((error: unknown) => {
        network = null;
        throw error;
      });
  }
  return network;
}

/** Test-only: forget the treasury so env changes between tests take effect. */
export function __resetTreasuryForTests(): void {
  runtime = null;
  network = null;
}

export interface PointQuote {
  readonly balance: number;
  /** What a sale may spend: the balance less any welcome points (0014). */
  readonly sellableBalance: number;
  readonly lockedBalance: number;
  readonly points: number;
  readonly lamports: number;
  readonly sol: string;
  readonly treasuryAddress: string;
  /** The cluster payments are verified on. */
  readonly network: SolanaNetwork;
  /** Which wallet pays for points and receives a sale (0018). */
  readonly paymentWallet: PaymentWallet;
}

export async function getPointQuote(profileId: string): Promise<PointQuote> {
  const account = treasury();
  // The network is shown, not needed for balances: an RPC hiccup reads as
  // 'unknown', and the app refuses to pay against an unknown network.
  const [balances, paymentWallet, cluster] = await Promise.all([
    fetchPointBalances(profileId),
    fetchPaymentWallet(profileId),
    treasuryNetwork().catch((): SolanaNetwork => 'unknown'),
  ]);
  return {
    balance: balances.balance,
    sellableBalance: balances.sellable,
    lockedBalance: balances.locked,
    points: POINT_TRADE_POINTS,
    lamports: POINT_TRADE_LAMPORTS,
    sol: '0.001',
    treasuryAddress: account.publicKey.toBase58(),
    network: cluster,
    paymentWallet,
  };
}

/** A buy order: what to pay, from which wallet, to where, and until when. */
export interface PointBuyOrder {
  readonly requestId: string;
  readonly status: 'awaiting_payment' | 'confirmed';
  readonly points: number;
  readonly lamports: number;
  readonly sol: string;
  readonly treasuryAddress: string;
  readonly network: SolanaNetwork;
  readonly payer: { readonly address: string; readonly kind: 'embedded' | 'external' };
  readonly expiresAt: string;
  readonly signature: string | null;
}

async function orderFrom(profileId: string, trade: PointTradeRow): Promise<PointBuyOrder> {
  const account = treasury();
  const payer = trade.payer_address as string;
  const wallets = await listVerifiedWallets(profileId);
  const kind = wallets.find((wallet) => wallet.address === payer)?.kind === 'embedded' ? 'embedded' : 'external';
  return {
    requestId: trade.request_id,
    status: trade.status === 'confirmed' ? 'confirmed' : 'awaiting_payment',
    points: trade.points,
    lamports: trade.lamports,
    sol: '0.001',
    treasuryAddress: account.publicKey.toBase58(),
    network: await treasuryNetwork(),
    payer: { address: payer, kind },
    expiresAt: trade.expires_at ?? new Date(0).toISOString(),
    signature: trade.signature,
  };
}

function ownBuyOrder(profileId: string, trade: PointTradeRow | null): trade is PointTradeRow {
  if (!trade) return false;
  if (trade.profile_id !== profileId || trade.kind !== 'buy' || !trade.payer_address) {
    throw new Error('Purchase request conflicts with an existing trade');
  }
  return true;
}

/**
 * Makes (or returns) the order the app pays: its payer is the account's
 * payment wallet now, and stays that wallet whatever is chosen later — so a
 * wallet switch can never make an old order credit a different payer.
 */
export async function createPointBuyOrder(profileId: string, requestId: string): Promise<PointBuyOrder> {
  treasury();
  const existing = await fetchPointTrade(requestId);
  if (ownBuyOrder(profileId, existing)) return orderFrom(profileId, existing);
  const payer = usablePaymentWallet(await fetchPaymentWallet(profileId));
  const expiresAt = new Date(Date.now() + BUY_ORDER_TTL_MS).toISOString();
  await recordPointBuyOrder(profileId, requestId, payer.address, expiresAt);
  const created = await fetchPointTrade(requestId);
  if (!ownBuyOrder(profileId, created)) throw new Error('Purchase order was not created');
  return orderFrom(profileId, created);
}

function parsedTransfer(
  instruction: ParsedInstruction | PartiallyDecodedInstruction,
): { source: string; destination: string; lamports: number } | null {
  if (!('parsed' in instruction) || instruction.program !== 'system') return null;
  const parsed = instruction.parsed as {
    type?: unknown;
    info?: { source?: unknown; destination?: unknown; lamports?: unknown };
  };
  if (parsed.type !== 'transfer') return null;
  const source = parsed.info?.source;
  const destination = parsed.info?.destination;
  const lamports = parsed.info?.lamports;
  return typeof source === 'string' && typeof destination === 'string' && typeof lamports === 'number'
    ? { source, destination, lamports }
    : null;
}

/**
 * Reads a payment on chain and returns its transfer to the treasury, or throws.
 * A signature alone proves nothing: the transaction must be confirmed, must not
 * have failed, and must move exactly `lamports` from `payer` to the treasury.
 */
async function verifiedPayment(
  account: TreasuryRuntime,
  signature: string,
  payer: string,
  lamports: number,
): Promise<{ source: string; destination: string; lamports: number }> {
  const transaction = await account.connection.getParsedTransaction(signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  });
  if (!transaction) throw new Error('Transaction is not confirmed yet');
  if (transaction.meta?.err) throw new Error('The Solana transaction failed');
  const transfer = transaction.transaction.message.instructions
    .map(parsedTransfer)
    .find(
      (candidate) =>
        candidate?.source === payer &&
        candidate.destination === account.publicKey.toBase58() &&
        candidate.lamports === lamports,
    );
  if (!transfer) throw new Error('Transaction does not match this point purchase');
  return transfer;
}

export async function creditConfirmedPointPurchase(
  profileId: string,
  requestId: string,
  signature: string,
): Promise<number> {
  const account = treasury();
  const order = await fetchPointTrade(requestId);
  if (order?.payer_address) {
    // An order (0018): the payment must come from the payer it was made for.
    ownBuyOrder(profileId, order);
    if (order.status === 'confirmed') {
      if (order.signature === signature) return fetchPointBalance(profileId);
      throw new Error('Purchase request conflicts with an existing trade');
    }
    const transfer = await verifiedPayment(account, signature, order.payer_address, order.lamports);
    return creditPointBuyOrder(profileId, requestId, signature, transfer.source);
  }

  // No order: an app from before 0018 paid from the embedded wallet first.
  const walletAddress = await fetchVerifiedWalletAddress(profileId);
  const transaction = await account.connection.getParsedTransaction(signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  });
  if (!transaction) throw new Error('Transaction is not confirmed yet');
  if (transaction.meta?.err) throw new Error('The Solana transaction failed');
  const validTransfer = transaction.transaction.message.instructions
    .map(parsedTransfer)
    .some(
      (transfer) =>
        transfer?.source === walletAddress &&
        transfer.destination === account.publicKey.toBase58() &&
        transfer.lamports === POINT_TRADE_LAMPORTS,
    );
  if (!validTransfer) throw new Error('Transaction does not match this point purchase');
  return completePointBuy(
    profileId,
    requestId,
    signature,
    POINT_TRADE_POINTS,
    POINT_TRADE_LAMPORTS,
  );
}

export interface PointPurchaseReconcile {
  readonly status: 'confirmed' | 'awaiting_payment';
  readonly balance: number;
  readonly signature: string | null;
}

/**
 * For an order whose payment the app never reported — it paid, then closed
 * before it could say so. Looks through the payer's latest transactions for an
 * uncredited, confirmed transfer of exactly the order's amount to the treasury,
 * made after the order, and credits it once. Never asks the player to pay again.
 */
export async function reconcilePointPurchase(
  profileId: string,
  requestId: string,
): Promise<PointPurchaseReconcile> {
  const account = treasury();
  const order = await fetchPointTrade(requestId);
  if (!ownBuyOrder(profileId, order)) throw new Error('Purchase order was not found');
  if (order.status === 'confirmed') {
    return { status: 'confirmed', balance: await fetchPointBalance(profileId), signature: order.signature };
  }
  const payer = order.payer_address as string;
  const since = Math.floor(Date.parse(order.created_at) / 1000) - RECONCILE_SLACK_SECONDS;
  const recent = await account.connection.getSignaturesForAddress(
    new PublicKey(payer),
    { limit: RECONCILE_SCAN },
    'confirmed',
  );
  for (const entry of recent) {
    if (entry.err) continue;
    if (entry.blockTime && entry.blockTime < since) break;
    if (await isSignatureCredited(entry.signature)) continue;
    try {
      const transfer = await verifiedPayment(account, entry.signature, payer, order.lamports);
      const balance = await creditPointBuyOrder(profileId, requestId, entry.signature, transfer.source);
      return { status: 'confirmed', balance, signature: entry.signature };
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/already credited/i.test(message)) continue;
      if (/does not match|failed|not confirmed/i.test(message)) continue;
      throw error;
    }
  }
  return { status: 'awaiting_payment', balance: await fetchPointBalance(profileId), signature: null };
}

export interface PointSaleResult {
  readonly status: 'confirmed' | 'pending' | 'refunded';
  readonly balance: number;
  readonly signature: string | null;
  /** Where this sale's SOL goes: fixed when its points were reserved. */
  readonly destination: string | null;
}

/**
 * Sells 100 points for the treasury's SOL. The destination is the account's
 * payment wallet when the sale is first made, and is kept on the trade: a
 * retry — after a timeout, a crash, a wallet switch — pays that same address
 * or nothing, never a newly chosen one.
 */
export async function sellPoints(
  profileId: string,
  requestId: string,
): Promise<PointSaleResult> {
  const account = treasury();
  const existing = await fetchPointTrade(requestId);
  let start;
  if (!existing) {
    const destination = usablePaymentWallet(await fetchPaymentWallet(profileId));
    start = await beginPointSellTo(
      profileId,
      requestId,
      POINT_TRADE_POINTS,
      POINT_TRADE_LAMPORTS,
      destination.address,
    );
  } else {
    // Idempotent: the reservation already exists and keeps what it was made with.
    start = await beginPointSell(profileId, requestId, POINT_TRADE_POINTS, POINT_TRADE_LAMPORTS);
  }
  if (!start.ok) {
    if (start.reason === 'insufficient_points') throw new Error('Insufficient points');
    if (start.reason === 'locked_points') throw new Error('Welcome points cannot be exchanged for SOL');
    return { status: 'refunded', balance: start.balance, signature: null, destination: null };
  }

  let trade = await fetchPointTrade(requestId);
  if (!trade) throw new Error('Point sale was not created');
  if (trade.profile_id !== profileId || trade.kind !== 'sell') {
    throw new Error('Point sale belongs to another account');
  }
  // A sale reserved before 0018 has no destination of its own: it was always
  // the embedded wallet, so that is what it still pays.
  const destination = trade.destination_address ?? (await fetchVerifiedWalletAddress(profileId));
  const recipient = new PublicKey(destination);
  if (trade.status === 'confirmed') {
    return { status: 'confirmed', balance: start.balance, signature: trade.signature, destination };
  }
  if (trade.status === 'refunded') {
    return { status: 'refunded', balance: start.balance, signature: trade.signature, destination };
  }

  if (!trade.signed_transaction || !trade.signature || !trade.blockhash || !trade.last_valid_block_height) {
    const treasuryBalance = await account.connection.getBalance(account.publicKey, 'confirmed');
    if (treasuryBalance < POINT_TRADE_LAMPORTS + FEE_RESERVE_LAMPORTS) {
      const balance = await refundPointSell(requestId, 'treasury has insufficient SOL');
      return { status: 'refunded', balance, signature: null, destination };
    }
    const latest = await account.connection.getLatestBlockhash('confirmed');
    const transaction = new Transaction({
      feePayer: account.publicKey,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    }).add(
      SystemProgram.transfer({
        fromPubkey: account.publicKey,
        toPubkey: recipient,
        lamports: POINT_TRADE_LAMPORTS,
      }),
    );
    transaction.sign(account.keypair);
    if (!transaction.signature) throw new Error('Treasury transaction could not be signed');
    const raw = transaction.serialize();
    await markPointSellBroadcast(requestId, {
      signature: bs58.encode(transaction.signature),
      signedTransaction: raw.toString('base64'),
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    });
    trade = await fetchPointTrade(requestId);
    if (!trade) throw new Error('Point sale disappeared after signing');
  }

  const signature = trade.signature as string;
  const signatureStatus = (
    await account.connection.getSignatureStatuses([signature], { searchTransactionHistory: true })
  ).value[0];
  if (signatureStatus?.err) {
    const balance = await refundPointSell(requestId, 'treasury payout failed on chain');
    return { status: 'refunded', balance, signature, destination };
  }
  if (signatureStatus?.confirmationStatus === 'confirmed' || signatureStatus?.confirmationStatus === 'finalized') {
    const balance = await completePointSell(requestId, signature);
    return { status: 'confirmed', balance, signature, destination };
  }

  const blockHeight = await account.connection.getBlockHeight('confirmed');
  if (blockHeight > (trade.last_valid_block_height as number)) {
    const balance = await refundPointSell(requestId, 'treasury payout blockhash expired');
    return { status: 'refunded', balance, signature, destination };
  }

  try {
    await account.connection.sendRawTransaction(
      Buffer.from(trade.signed_transaction as string, 'base64'),
      { maxRetries: 3, skipPreflight: false },
    );
    const confirmation = await account.connection.confirmTransaction(
      {
        signature,
        blockhash: trade.blockhash as string,
        lastValidBlockHeight: trade.last_valid_block_height as number,
      },
      'confirmed',
    );
    if (confirmation.value.err) {
      const balance = await refundPointSell(requestId, 'treasury payout was rejected');
      return { status: 'refunded', balance, signature, destination };
    }
    const balance = await completePointSell(requestId, signature);
    return { status: 'confirmed', balance, signature, destination };
  } catch {
    return { status: 'pending', balance: start.balance, signature, destination };
  }
}
