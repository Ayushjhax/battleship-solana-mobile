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
  completePointBuy,
  completePointSell,
  fetchPointBalance,
  fetchPointTrade,
  fetchVerifiedWalletAddress,
  markPointSellBroadcast,
  refundPointSell,
} from './db';

export const POINT_TRADE_POINTS = 100;
export const POINT_TRADE_LAMPORTS = 1_000_000;
export const WAGER_STAKE_POINTS = 50;
const FEE_RESERVE_LAMPORTS = 20_000;

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

export interface PointQuote {
  readonly balance: number;
  readonly points: number;
  readonly lamports: number;
  readonly sol: string;
  readonly treasuryAddress: string;
}

export async function getPointQuote(profileId: string): Promise<PointQuote> {
  const account = treasury();
  return {
    balance: await fetchPointBalance(profileId),
    points: POINT_TRADE_POINTS,
    lamports: POINT_TRADE_LAMPORTS,
    sol: '0.001',
    treasuryAddress: account.publicKey.toBase58(),
  };
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

export async function creditConfirmedPointPurchase(
  profileId: string,
  requestId: string,
  signature: string,
): Promise<number> {
  const account = treasury();
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

export interface PointSaleResult {
  readonly status: 'confirmed' | 'pending' | 'refunded';
  readonly balance: number;
  readonly signature: string | null;
}

export async function sellPoints(
  profileId: string,
  requestId: string,
): Promise<PointSaleResult> {
  const account = treasury();
  const recipient = new PublicKey(await fetchVerifiedWalletAddress(profileId));
  const start = await beginPointSell(
    profileId,
    requestId,
    POINT_TRADE_POINTS,
    POINT_TRADE_LAMPORTS,
  );
  if (!start.ok) {
    if (start.reason === 'insufficient_points') throw new Error('Insufficient points');
    return { status: 'refunded', balance: start.balance, signature: null };
  }

  let trade = await fetchPointTrade(requestId);
  if (!trade) throw new Error('Point sale was not created');
  if (trade.profile_id !== profileId || trade.kind !== 'sell') {
    throw new Error('Point sale belongs to another account');
  }
  if (trade.status === 'confirmed') {
    return { status: 'confirmed', balance: start.balance, signature: trade.signature };
  }
  if (trade.status === 'refunded') {
    return { status: 'refunded', balance: start.balance, signature: trade.signature };
  }

  if (!trade.signed_transaction || !trade.signature || !trade.blockhash || !trade.last_valid_block_height) {
    const treasuryBalance = await account.connection.getBalance(account.publicKey, 'confirmed');
    if (treasuryBalance < POINT_TRADE_LAMPORTS + FEE_RESERVE_LAMPORTS) {
      const balance = await refundPointSell(requestId, 'treasury has insufficient SOL');
      return { status: 'refunded', balance, signature: null };
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
    return { status: 'refunded', balance, signature };
  }
  if (signatureStatus?.confirmationStatus === 'confirmed' || signatureStatus?.confirmationStatus === 'finalized') {
    const balance = await completePointSell(requestId, signature);
    return { status: 'confirmed', balance, signature };
  }

  const blockHeight = await account.connection.getBlockHeight('confirmed');
  if (blockHeight > (trade.last_valid_block_height as number)) {
    const balance = await refundPointSell(requestId, 'treasury payout blockhash expired');
    return { status: 'refunded', balance, signature };
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
      return { status: 'refunded', balance, signature };
    }
    const balance = await completePointSell(requestId, signature);
    return { status: 'confirmed', balance, signature };
  } catch {
    return { status: 'pending', balance: start.balance, signature };
  }
}
