/**
 * Regression: "In WALLET - Need to refresh sometimes to reflect sol balance
 * after transaction | similar with points too."
 *
 * Both screens did `await confirmTransaction(...)` and then `getBalance(...)`.
 * That looks sequential but is not: a pooled RPC endpoint can route the second
 * call to a replica a few slots behind the one that confirmed, which answers
 * with the pre-transaction figure. The screen then showed a stale number until
 * the player pulled to refresh and happened to hit a caught-up node.
 *
 * `readBalanceAtLeastSlot` pins the read to the confirmation's slot and retries
 * while the figure has not moved.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BALANCE_SYNC_ATTEMPTS,
  readBalanceAtLeastSlot,
  type BalanceReader,
} from '../../src/wallet/solana';

const ADDRESS = { toBase58: () => 'Wa11et1111111111111111111111111111111111111' };

/** Records every config it was asked with, so slot pinning can be asserted. */
function reader(responses: (number | Error)[]): BalanceReader & {
  configs: { commitment: string; minContextSlot?: number }[];
} {
  const configs: { commitment: string; minContextSlot?: number }[] = [];
  let call = 0;
  return {
    configs,
    async getBalance(_address, config) {
      configs.push(config);
      const next = responses[Math.min(call, responses.length - 1)];
      call += 1;
      if (next instanceof Error) throw next;
      return next ?? 0;
    },
  };
}

const noSleep = async () => {};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('pinning the read to the confirmed slot', () => {
  it('passes minContextSlot so a lagging replica cannot answer', async () => {
    const rpc = reader([2_000_000]);

    await readBalanceAtLeastSlot(rpc, ADDRESS, { minContextSlot: 12345, sleep: noSleep });

    expect(rpc.configs[0]).toEqual({ commitment: 'confirmed', minContextSlot: 12345 });
  });

  it('omits minContextSlot for an ordinary refresh', async () => {
    const rpc = reader([2_000_000]);

    await readBalanceAtLeastSlot(rpc, ADDRESS, { sleep: noSleep });

    expect(rpc.configs[0]).toEqual({ commitment: 'confirmed' });
  });

  it('returns the first answer when nothing needs to change', async () => {
    const rpc = reader([2_000_000]);

    await expect(readBalanceAtLeastSlot(rpc, ADDRESS, { sleep: noSleep })).resolves.toBe(2_000_000);
    expect(rpc.configs).toHaveLength(1);
  });
});

describe('retrying while the node is behind', () => {
  it('keeps reading until the balance actually moves', async () => {
    // Two stale answers, then the settled one — the exact live symptom.
    const rpc = reader([5_000_000, 5_000_000, 3_900_000]);

    const balance = await readBalanceAtLeastSlot(rpc, ADDRESS, {
      differentFrom: 5_000_000,
      sleep: noSleep,
    });

    expect(balance).toBe(3_900_000);
    expect(rpc.configs).toHaveLength(3);
  });

  it('stops as soon as the figure changes', async () => {
    const rpc = reader([3_900_000]);

    await readBalanceAtLeastSlot(rpc, ADDRESS, { differentFrom: 5_000_000, sleep: noSleep });

    expect(rpc.configs).toHaveLength(1);
  });

  it('gives up after a bounded number of attempts rather than hanging', async () => {
    const rpc = reader([5_000_000]);

    const balance = await readBalanceAtLeastSlot(rpc, ADDRESS, {
      differentFrom: 5_000_000,
      sleep: noSleep,
    });

    // The stale figure is still better than an error or a spinner forever.
    expect(balance).toBe(5_000_000);
    expect(rpc.configs).toHaveLength(BALANCE_SYNC_ATTEMPTS);
  });

  it('honours a custom attempt count', async () => {
    const rpc = reader([5_000_000]);

    await readBalanceAtLeastSlot(rpc, ADDRESS, {
      differentFrom: 5_000_000,
      attempts: 2,
      sleep: noSleep,
    });

    expect(rpc.configs).toHaveLength(2);
  });

  it('waits between attempts', async () => {
    const sleep = vi.fn(async () => {});
    const rpc = reader([5_000_000]);

    await readBalanceAtLeastSlot(rpc, ADDRESS, {
      differentFrom: 5_000_000,
      attempts: 3,
      delayMs: 250,
      sleep,
    });

    // One wait between each pair of attempts, never after the last.
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });
});

describe('nodes that reject the slot filter', () => {
  it('drops minContextSlot and retries without it', async () => {
    // Some providers answer -32602 for an unknown param rather than ignoring it.
    const rpc = reader([new Error('Invalid param: minContextSlot'), 3_900_000]);

    const balance = await readBalanceAtLeastSlot(rpc, ADDRESS, {
      minContextSlot: 999,
      sleep: noSleep,
    });

    expect(balance).toBe(3_900_000);
    expect(rpc.configs[0]).toMatchObject({ minContextSlot: 999 });
    expect(rpc.configs[1]).toEqual({ commitment: 'confirmed' });
  });

  it('retries a node that is simply too far behind', async () => {
    const rpc = reader([new Error('Minimum context slot has not been reached'), 3_900_000]);

    await expect(
      readBalanceAtLeastSlot(rpc, ADDRESS, { minContextSlot: 999, sleep: noSleep }),
    ).resolves.toBe(3_900_000);
  });

  it('surfaces the error when every attempt fails and nothing was ever read', async () => {
    const rpc = reader([new Error('503 Service Unavailable')]);

    await expect(
      readBalanceAtLeastSlot(rpc, ADDRESS, { attempts: 2, sleep: noSleep }),
    ).rejects.toThrow(/503/);
  });

  it('prefers a figure it did read over a later failure', async () => {
    const rpc = reader([5_000_000, new Error('network blip'), new Error('network blip')]);

    const balance = await readBalanceAtLeastSlot(rpc, ADDRESS, {
      differentFrom: 5_000_000,
      attempts: 3,
      sleep: noSleep,
    });

    expect(balance).toBe(5_000_000);
  });
});

describe('edge cases', () => {
  it('treats a zero balance as a real answer, not a missing one', async () => {
    const rpc = reader([0]);

    await expect(
      readBalanceAtLeastSlot(rpc, ADDRESS, { differentFrom: 1_000, sleep: noSleep }),
    ).resolves.toBe(0);
    expect(rpc.configs).toHaveLength(1);
  });

  it('does not retry forever when the balance legitimately did not change', async () => {
    // Sending 0 SOL to yourself, or a failed-but-confirmed transfer.
    const rpc = reader([7_000_000]);

    await expect(
      readBalanceAtLeastSlot(rpc, ADDRESS, {
        differentFrom: 7_000_000,
        attempts: 3,
        sleep: noSleep,
      }),
    ).resolves.toBe(7_000_000);
  });

  it('always makes at least one attempt', async () => {
    const rpc = reader([1_234]);

    await expect(
      readBalanceAtLeastSlot(rpc, ADDRESS, { attempts: 0, sleep: noSleep }),
    ).resolves.toBe(1_234);
    expect(rpc.configs).toHaveLength(1);
  });
});
