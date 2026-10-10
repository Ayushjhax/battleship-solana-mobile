/**
 * The purchase transaction (src/features/points/transfer.ts) is exactly the
 * transfer the server credits: one System Program transfer, payer → treasury,
 * of the order's lamports, fee paid by the payer.
 */
import { Keypair, SystemInstruction, SystemProgram } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';

import { buildTransferTransaction, isExactTransfer } from '../../src/features/points/transfer';

const payer = Keypair.generate().publicKey.toBase58();
const treasury = Keypair.generate().publicKey.toBase58();
const latest = { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1234 };
const transfer = { from: payer, to: treasury, lamports: 1_000_000 };

describe('the purchase transfer', () => {
  it('is one transfer of the order’s lamports from the payer to the treasury', () => {
    const transaction = buildTransferTransaction(transfer, latest);
    expect(transaction.feePayer?.toBase58()).toBe(payer);
    expect(transaction.recentBlockhash).toBe(latest.blockhash);
    expect(transaction.lastValidBlockHeight).toBe(1234);
    expect(transaction.instructions).toHaveLength(1);
    const decoded = SystemInstruction.decodeTransfer(transaction.instructions[0]!);
    expect(decoded.fromPubkey.toBase58()).toBe(payer);
    expect(decoded.toPubkey.toBase58()).toBe(treasury);
    expect(BigInt(decoded.lamports)).toBe(1_000_000n);
    expect(isExactTransfer(transaction, transfer)).toBe(true);
  });

  it.each([
    ['another amount', { ...transfer, lamports: 999_999 }],
    ['another destination', { ...transfer, to: Keypair.generate().publicKey.toBase58() }],
    ['another payer', { ...transfer, from: Keypair.generate().publicKey.toBase58() }],
  ])('does not pass for %s', (_name, expected) => {
    expect(isExactTransfer(buildTransferTransaction(transfer, latest), expected)).toBe(false);
  });

  it('does not pass with anything added to it', () => {
    const transaction = buildTransferTransaction(transfer, latest).add(
      SystemProgram.transfer({ fromPubkey: Keypair.generate().publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }),
    );
    expect(isExactTransfer(transaction, transfer)).toBe(false);
  });
});
