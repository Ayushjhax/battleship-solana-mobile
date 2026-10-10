/**
 * The one transaction a purchase pays with: a single System Program transfer of
 * the order's lamports from its payer to the treasury, fee paid by the payer.
 * The embedded and the external wallet are handed exactly this, and the match
 * server credits only a confirmed transfer of exactly this shape
 * (server/src/points.ts verifiedPayment). Pure (tests/points/transfer.test.ts).
 */
import { PublicKey, SystemInstruction, SystemProgram, Transaction } from '@solana/web3.js';

import type { Transfer } from './purchase';

export interface Blockhash {
  readonly blockhash: string;
  readonly lastValidBlockHeight: number;
}

export function buildTransferTransaction(transfer: Transfer, latest: Blockhash): Transaction {
  const from = new PublicKey(transfer.from);
  return new Transaction({
    feePayer: from,
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
  }).add(
    SystemProgram.transfer({
      fromPubkey: from,
      toPubkey: new PublicKey(transfer.to),
      lamports: transfer.lamports,
    }),
  );
}

/** True only for a transaction that is exactly `transfer` and nothing else. */
export function isExactTransfer(transaction: Transaction, transfer: Transfer): boolean {
  if (!transaction.feePayer?.equals(new PublicKey(transfer.from))) return false;
  if (transaction.instructions.length !== 1) return false;
  const [instruction] = transaction.instructions;
  if (!instruction || !instruction.programId.equals(SystemProgram.programId)) return false;
  try {
    if (SystemInstruction.decodeInstructionType(instruction) !== 'Transfer') return false;
    const decoded = SystemInstruction.decodeTransfer(instruction);
    return (
      decoded.fromPubkey.toBase58() === transfer.from &&
      decoded.toPubkey.toBase58() === transfer.to &&
      BigInt(decoded.lamports) === BigInt(transfer.lamports)
    );
  } catch {
    return false;
  }
}
