/**
 * The Mobile Wallet Adapter service (src/wallet/mwaCore.ts) against a fake
 * wallet that signs with a real Ed25519 key and fails the way the React Native
 * module does: a wallet's JSON-RPC error is the raw native `JSON_RPC_ERROR`
 * inside the session and a numeric protocol code once `transact` returns.
 */
import { ed25519 } from '@noble/curves/ed25519';
import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { describe, expect, it, vi } from 'vitest';

import {
  AUTHORIZATION_MAX_AGE_MS,
  chainsRuleOut,
  createMwaService,
  detachedSignature,
  MwaError,
  mwaChainFor,
  toMwaError,
  walletClientTypeOf,
  type MwaDeps,
  type SignInProof,
} from '../../src/wallet/mwaCore';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const TREASURY = Keypair.generate().publicKey.toBase58();

function walletKey() {
  const secret = ed25519.utils.randomPrivateKey();
  const publicKey = ed25519.getPublicKey(secret);
  return {
    secret,
    address: new PublicKey(publicKey).toBase58(),
    base64: Buffer.from(publicKey).toString('base64'),
  };
}

/** The native module's error inside a session. */
function nativeRpcError(code: number): Error {
  return Object.assign(new Error(`JSON-RPC error ${code}`), { code: 'JSON_RPC_ERROR', userInfo: { jsonRpcErrorCode: code } });
}

interface FakeWalletOptions {
  accounts?: { base64: string; chains?: string[]; label?: string }[];
  /** 'appended' (spec: message || signature) or 'detached' (64 bytes alone). */
  signedFormat?: 'appended' | 'detached';
  tamper?: boolean;
  authorize?: (params: { auth_token?: string }) => void;
  signMessages?: () => void;
  signAndSend?: () => string;
  walletUriBase?: string;
}

function fakeWallet(key: ReturnType<typeof walletKey>, options: FakeWalletOptions = {}) {
  const calls = {
    authorize: [] as { chain?: string; auth_token?: string; identity?: unknown }[],
    signMessages: 0,
    signAndSend: [] as { minContextSlot?: number; commitment?: string; transactions: Transaction[] }[],
    deauthorize: [] as string[],
  };
  let tokens = 0;
  const wallet = {
    authorize: vi.fn(async (params: { chain?: string; auth_token?: string; identity?: unknown }) => {
      calls.authorize.push(params);
      options.authorize?.(params);
      tokens += 1;
      return {
        accounts: (options.accounts ?? [{ base64: key.base64, chains: ['solana:mainnet'], label: 'Main' }]).map((account) => ({
          address: account.base64,
          chains: account.chains,
          label: account.label,
        })),
        auth_token: `token-${tokens}`,
        wallet_uri_base: options.walletUriBase ?? 'https://phantom.app/ul/v1',
      };
    }),
    signMessages: vi.fn(async ({ payloads }: { addresses: string[]; payloads: Uint8Array[] }) => {
      calls.signMessages += 1;
      options.signMessages?.();
      return payloads.map((payload) => {
        const signed = options.tamper ? new TextEncoder().encode('something else') : payload;
        const signature = ed25519.sign(signed, key.secret);
        return options.signedFormat === 'detached' ? signature : Uint8Array.from([...payload, ...signature]);
      });
    }),
    signAndSendTransactions: vi.fn(async (params: { minContextSlot?: number; commitment?: string; transactions: Transaction[] }) => {
      calls.signAndSend.push(params);
      return [options.signAndSend ? options.signAndSend() : 'wallet-signature-1'];
    }),
    deauthorize: vi.fn(async ({ auth_token }: { auth_token: string }) => {
      calls.deauthorize.push(auth_token);
      return {};
    }),
  };
  return { wallet, calls };
}

function harness(wallet: ReturnType<typeof fakeWallet>['wallet'], overrides: Partial<MwaDeps> = {}) {
  let stored: string | null = null;
  const sessions: (string | undefined)[] = [];
  const deps: MwaDeps = {
    transact: (async (run: (w: unknown) => Promise<unknown>, baseUri?: string) => {
      sessions.push(baseUri);
      try {
        return await run(wallet);
      } catch (error) {
        // What `transact` does on the way out of the session.
        const raw = error as { code?: unknown; userInfo?: { jsonRpcErrorCode?: number } };
        if (raw.code === 'JSON_RPC_ERROR') {
          throw Object.assign(new Error((error as Error).message), { code: raw.userInfo?.jsonRpcErrorCode });
        }
        throw error;
      }
    }) as MwaDeps['transact'],
    read: vi.fn(async () => stored),
    write: vi.fn(async (value: string) => {
      stored = value;
    }),
    remove: vi.fn(async () => {
      stored = null;
    }),
    now: () => NOW,
    isForeground: () => true,
    chain: 'solana:mainnet',
    ...overrides,
  };
  return { service: createMwaService(deps), deps, sessions, stored: () => (stored ? JSON.parse(stored) : null) };
}

function privy(userId = 'privy-user-1') {
  const messages: string[] = [];
  const proofs: SignInProof[] = [];
  return {
    messages,
    proofs,
    createMessage: vi.fn(async (address: string) => {
      const message = `empireofbits.xyz wants you to sign in with your Solana account:\n${address}\n\nNonce: abc123`;
      messages.push(message);
      return message;
    }),
    complete: vi.fn(async (proof: SignInProof) => {
      proofs.push(proof);
      return { id: userId };
    }),
  };
}

function transferFrom(payer: string): Transaction {
  return new Transaction({
    feePayer: new PublicKey(payer),
    blockhash: Keypair.generate().publicKey.toBase58(),
    lastValidBlockHeight: 100,
  }).add(SystemProgram.transfer({ fromPubkey: new PublicKey(payer), toPubkey: new PublicKey(TREASURY), lamports: 1_000_000 }));
}

describe('the detached signature Privy is given', () => {
  const key = walletKey();
  const message = new TextEncoder().encode('Sign in to Empire of Bits');
  const signature = ed25519.sign(message, key.secret);

  it('is taken from message || signature, the MWA spec format', () => {
    expect(detachedSignature(Uint8Array.from([...message, ...signature]), message, key.address)).toEqual(signature);
  });

  it('accepts a wallet that returns the 64-byte signature alone', () => {
    expect(detachedSignature(signature, message, key.address)).toEqual(signature);
  });

  it.each([
    ['a signature over a different message', Uint8Array.from([...message, ...ed25519.sign(new TextEncoder().encode('other'), key.secret)])],
    ['another key’s signature', Uint8Array.from([...message, ...ed25519.sign(message, walletKey().secret)])],
    ['a payload whose message part was changed', Uint8Array.from([...new TextEncoder().encode('Sign in to Empire of Bitz'), ...signature])],
    ['a truncated signature', signature.subarray(0, 63)],
  ])('refuses %s', (_name, payload) => {
    expect(() => detachedSignature(payload, message, key.address)).toThrow(MwaError);
  });
});

describe('wallet errors', () => {
  it.each([
    [{ code: 'ERROR_WALLET_NOT_FOUND' }, false, 'no_wallet', true],
    [{ code: 'Session not established: Local association cancelled by user' }, false, 'cancelled', true],
    [{ code: -3 }, true, 'declined', true],
    [nativeRpcError(-3), true, 'declined', true],
    [{ code: -1 }, false, 'authorization_failed', true],
    [{ code: 'Timed out waiting for response', message: 'Timed out waiting for response' }, true, 'timeout', false],
    [{ code: 'ERROR_SESSION_CLOSED' }, true, 'failed', false],
    [{ code: 'ERROR_SESSION_CLOSED' }, false, 'failed', true],
    [{ code: -4 }, true, 'failed', false],
  ])('%o while sending=%s is %s (nothing sent: %s)', (raw, sending, kind, nothingSent) => {
    const error = toMwaError(Object.assign(new Error(String((raw as { message?: string }).message ?? '')), raw), sending);
    expect(error.kind).toBe(kind);
    expect(error.nothingSent).toBe(nothingSent);
    expect(error.mayHaveSent).toBe(!nothingSent);
  });
});

describe('wallet identity', () => {
  it.each([
    ['https://phantom.app/ul/v1', 'phantom'],
    ['https://solflare.com/ul/v1', 'solflare'],
    ['https://wallet.privy.io/x', 'unknown'],
    [null, 'unknown'],
    ['not a url', 'unknown'],
  ])('%s is %s, never “privy”', (uri, name) => {
    expect(walletClientTypeOf(uri)).toBe(name);
  });

  it('mainnet-beta is solana:mainnet', () => {
    expect(mwaChainFor('mainnet-beta')).toBe('solana:mainnet');
  });
});

describe('signing in with a wallet', () => {
  it('signs Privy’s exact message and hands Privy the verified detached signature', async () => {
    const key = walletKey();
    const { wallet, calls } = fakeWallet(key);
    const { service, stored } = harness(wallet);
    const flow = privy();

    const account = await service.signIn({ userId: null, createMessage: flow.createMessage, complete: flow.complete });

    expect(account).toEqual({ address: key.address, label: 'Main', walletClientType: 'phantom' });
    expect(calls.authorize[0]).toMatchObject({ chain: 'solana:mainnet', identity: { name: 'Empire of Bits', uri: 'https://empireofbits.xyz' } });
    expect(calls.authorize[0]?.auth_token).toBeUndefined();
    expect(flow.createMessage).toHaveBeenCalledWith(key.address);
    const proof = flow.proofs[0]!;
    expect(proof.message).toBe(flow.messages[0]);
    const signature = Buffer.from(proof.signature, 'base64');
    expect(signature).toHaveLength(64);
    expect(ed25519.verify(signature, new TextEncoder().encode(proof.message), new PublicKey(key.address).toBytes())).toBe(true);
    expect(proof.wallet).toEqual({ walletClientType: 'phantom', connectorType: 'mobile_wallet_protocol' });
    // Remembered for the user Privy signed in, on this chain only.
    expect(stored()).toMatchObject({ userId: 'privy-user-1', address: key.address, chain: 'solana:mainnet', authToken: 'token-1' });
  });

  it('works with a wallet that returns detached signatures', async () => {
    const key = walletKey();
    const { wallet } = fakeWallet(key, { signedFormat: 'detached' });
    const flow = privy();
    await expect(harness(wallet).service.signIn({ userId: null, ...flow })).resolves.toMatchObject({ address: key.address });
    expect(flow.complete).toHaveBeenCalledOnce();
  });

  it('never reaches Privy when the player declines in the wallet', async () => {
    const key = walletKey();
    const { wallet } = fakeWallet(key, {
      signMessages: () => {
        throw nativeRpcError(-3);
      },
    });
    const { service, stored } = harness(wallet);
    const flow = privy();

    await expect(service.signIn({ userId: null, ...flow })).rejects.toMatchObject({ kind: 'declined' });
    expect(flow.complete).not.toHaveBeenCalled();
    expect(stored()).toBeNull();
  });

  it('never reaches Privy when the connection is cancelled', async () => {
    const key = walletKey();
    const { wallet } = fakeWallet(key, {
      authorize: () => {
        throw Object.assign(new Error('cancelled'), { code: 'Session not established: Local association cancelled by user' });
      },
    });
    const flow = privy();
    await expect(harness(wallet).service.signIn({ userId: null, ...flow })).rejects.toMatchObject({ kind: 'cancelled' });
    expect(flow.createMessage).not.toHaveBeenCalled();
    expect(flow.complete).not.toHaveBeenCalled();
  });

  it('refuses a signature that does not verify, before Privy sees it', async () => {
    const key = walletKey();
    const { wallet } = fakeWallet(key, { tamper: true });
    const flow = privy();
    await expect(harness(wallet).service.signIn({ userId: null, ...flow })).rejects.toMatchObject({ kind: 'invalid_response' });
    expect(flow.complete).not.toHaveBeenCalled();
  });

  it('linking keeps nothing when Privy answers for a different account', async () => {
    const key = walletKey();
    const { wallet } = fakeWallet(key);
    const { service, stored } = harness(wallet);
    const flow = privy('someone-else');

    await expect(service.signIn({ userId: 'privy-user-1', ...flow })).rejects.toMatchObject({ kind: 'session_changed' });
    expect(stored()).toBeNull();
  });

  it('a link always asks the wallet afresh, even with a cached connection', async () => {
    const key = walletKey();
    const { wallet, calls } = fakeWallet(key);
    const { service } = harness(wallet);
    await service.signIn({ userId: null, ...privy() });
    await service.signIn({ userId: 'privy-user-1', ...privy() });
    expect(calls.authorize.map((call) => call.auth_token)).toEqual([undefined, undefined]);
  });

  it('needs the game in the foreground, and opens nothing otherwise', async () => {
    const { wallet, calls } = fakeWallet(walletKey());
    const { service, sessions } = harness(wallet, { isForeground: () => false });
    await expect(service.signIn({ userId: null, ...privy() })).rejects.toMatchObject({ kind: 'background' });
    expect(sessions).toHaveLength(0);
    expect(calls.authorize).toHaveLength(0);
  });

  it('refuses a second tap while the wallet is open, and opens one session', async () => {
    const key = walletKey();
    let release: () => void = () => {};
    const { wallet } = fakeWallet(key, {
      authorize: () => undefined,
      signMessages: () => undefined,
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowWallet = { ...wallet, authorize: vi.fn(async (params: { chain?: string }) => {
      await gate;
      return wallet.authorize(params);
    }) };
    const { service, sessions } = harness(slowWallet as unknown as typeof wallet);

    const first = service.signIn({ userId: null, ...privy() });
    await expect(service.signIn({ userId: null, ...privy() })).rejects.toMatchObject({ kind: 'busy' });
    expect(service.isBusy()).toBe(true);
    release();
    await expect(first).resolves.toMatchObject({ address: key.address });
    expect(sessions).toHaveLength(1);
    expect(service.isBusy()).toBe(false);
  });

  it('stays locked after its own timeout until the wallet session really ends', async () => {
    let finish: () => void = () => {};
    const { wallet } = fakeWallet(walletKey());
    const { service } = harness(wallet, {
      backstopMs: 10,
      transact: (() =>
        new Promise((_, reject) => {
          finish = () => reject(new Error('session ended'));
        })) as MwaDeps['transact'],
    });

    await expect(service.signIn({ userId: null, ...privy() })).rejects.toMatchObject({ kind: 'timeout' });
    expect(service.isBusy()).toBe(true);
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(service.isBusy()).toBe(false);
  });
});

describe('paying from the wallet', () => {
  async function connected(options: FakeWalletOptions = {}, overrides: Partial<MwaDeps> = {}) {
    const key = walletKey();
    const fake = fakeWallet(key, options);
    const h = harness(fake.wallet, overrides);
    await h.service.signIn({ userId: null, ...privy() });
    fake.calls.authorize.length = 0;
    return { key, ...fake, ...h };
  }

  it('re-uses the cached authorization and sends exactly the prepared transfer', async () => {
    const { key, service, calls, sessions } = await connected();
    const transaction = transferFrom(key.address);

    const signature = await service.signAndSend({
      userId: 'privy-user-1',
      payer: key.address,
      prepare: async () => ({ transaction, minContextSlot: 42 }),
    });

    expect(signature).toBe('wallet-signature-1');
    expect(calls.authorize[0]).toMatchObject({ auth_token: 'token-1', chain: 'solana:mainnet' });
    expect(calls.signAndSend[0]).toMatchObject({ minContextSlot: 42, commitment: 'confirmed' });
    expect(calls.signAndSend[0]?.transactions[0]).toBe(transaction);
    expect(sessions.at(-1)).toBe('https://phantom.app/ul/v1');
  });

  it('refuses, sending nothing, when the wallet connects another account than the payer', async () => {
    const { service, calls, stored } = await connected();
    const other = walletKey();
    const prepare = vi.fn(async () => ({ transaction: transferFrom(other.address) }));

    const failure = await service.signAndSend({ userId: 'privy-user-1', payer: other.address, prepare }).catch((error) => error);

    expect(failure).toMatchObject({ kind: 'account_mismatch', nothingSent: true });
    expect(prepare).not.toHaveBeenCalled();
    expect(calls.signAndSend).toHaveLength(0);
    // A fresh authorization was asked for (the cache is per address) and not kept.
    expect(calls.authorize[0]?.auth_token).toBeUndefined();
    expect(stored()?.address).not.toBe(other.address);
  });

  it('refuses a wallet account that is not on the app’s network', async () => {
    const key = walletKey();
    const { wallet, calls } = fakeWallet(key, { accounts: [{ base64: key.base64, chains: ['solana:devnet'] }] });
    const { service } = harness(wallet);
    await expect(
      service.signAndSend({ userId: 'u', payer: key.address, prepare: async () => ({ transaction: transferFrom(key.address) }) }),
    ).rejects.toMatchObject({ kind: 'chain_unsupported', nothingSent: true });
    expect(calls.signAndSend).toHaveLength(0);
  });

  it('discards a token the wallet refuses and asks once more without it', async () => {
    let refused = false;
    const { key, service, calls, stored } = await connected({
      authorize: (params) => {
        if (params.auth_token && !refused) {
          refused = true;
          throw nativeRpcError(-1);
        }
      },
    });

    await service.signAndSend({ userId: 'privy-user-1', payer: key.address, prepare: async () => ({ transaction: transferFrom(key.address) }) });

    expect(calls.authorize.map((call) => call.auth_token)).toEqual(['token-1', undefined]);
    // The refused token-1 is gone; the fresh authorization's token is kept.
    expect(stored()?.authToken).toBe('token-2');
  });

  it('a decline in the wallet sent nothing', async () => {
    const { key, service } = await connected({
      signAndSend: () => {
        throw nativeRpcError(-3);
      },
    });
    await expect(
      service.signAndSend({ userId: 'privy-user-1', payer: key.address, prepare: async () => ({ transaction: transferFrom(key.address) }) }),
    ).rejects.toMatchObject({ kind: 'declined', nothingSent: true });
  });

  it('a session that ends once the transfer was handed over may have sent it', async () => {
    const { key, service } = await connected({
      signAndSend: () => {
        throw Object.assign(new Error('closed'), { code: 'ERROR_SESSION_CLOSED' });
      },
    });
    await expect(
      service.signAndSend({ userId: 'privy-user-1', payer: key.address, prepare: async () => ({ transaction: transferFrom(key.address) }) }),
    ).rejects.toMatchObject({ mayHaveSent: true });
  });

  it('stops before the wallet is asked when the last checks fail', async () => {
    const { key, service, calls } = await connected();
    const failure = await service
      .signAndSend({
        userId: 'privy-user-1',
        payer: key.address,
        prepare: async () => {
          throw new MwaError('expired', 'That order expired.');
        },
      })
      .catch((error) => error);
    expect(failure).toMatchObject({ kind: 'expired', nothingSent: true });
    expect(calls.signAndSend).toHaveLength(0);
  });

  it('never sends a transaction whose fee payer is not the payer', async () => {
    const { key, service, calls } = await connected();
    await expect(
      service.signAndSend({ userId: 'privy-user-1', payer: key.address, prepare: async () => ({ transaction: transferFrom(TREASURY) }) }),
    ).rejects.toMatchObject({ kind: 'account_mismatch', nothingSent: true });
    expect(calls.signAndSend).toHaveLength(0);
  });

  it('sends nothing when the player signed out while the wallet was open', async () => {
    const { key, service, calls, stored } = await connected();
    await expect(
      service.signAndSend({
        userId: 'privy-user-1',
        payer: key.address,
        prepare: async () => {
          await service.clear();
          return { transaction: transferFrom(key.address) };
        },
      }),
    ).rejects.toMatchObject({ kind: 'session_changed', nothingSent: true });
    expect(calls.signAndSend).toHaveLength(0);
    expect(stored()).toBeNull();
  });
});

describe('the cached connection', () => {
  async function saved(overrides: Partial<MwaDeps> = {}) {
    const key = walletKey();
    const { wallet, calls } = fakeWallet(key);
    const h = harness(wallet, overrides);
    await h.service.signIn({ userId: null, ...privy() });
    return { key, calls, ...h };
  }

  it('is restored for its own user only, and dropped for anyone else', async () => {
    const { key, service, stored } = await saved();
    await expect(service.restore('privy-user-1')).resolves.toMatchObject({ address: key.address, label: 'Main' });
    await expect(service.restore('privy-user-2')).resolves.toBeNull();
    expect(stored()).toBeNull();
  });

  it('is not used on another network', async () => {
    const key = walletKey();
    const { wallet } = fakeWallet(key);
    let value: string | null = null;
    const storage = {
      read: async () => value,
      write: async (next: string) => {
        value = next;
      },
      remove: async () => {
        value = null;
      },
    };
    await harness(wallet, storage).service.signIn({ userId: null, ...privy() });
    const devnet = harness(wallet, { ...storage, chain: 'solana:devnet' });
    await expect(devnet.service.restore('privy-user-1')).resolves.toBeNull();
  });

  it('expires after its local lifetime', async () => {
    let now = NOW;
    const { service } = await saved({ now: () => now });
    now += AUTHORIZATION_MAX_AGE_MS + 1;
    await expect(service.restore('privy-user-1')).resolves.toBeNull();
  });

  it('is forgotten on sign-out without opening the wallet', async () => {
    const { service, sessions, stored } = await saved();
    const opened = sessions.length;
    await service.clear();
    expect(stored()).toBeNull();
    expect(sessions).toHaveLength(opened);
  });

  it('disconnect forgets it and asks the wallet to revoke the token', async () => {
    const { service, calls, stored } = await saved();
    await expect(service.disconnect('privy-user-1')).resolves.toEqual({ revoked: true });
    expect(calls.deauthorize).toEqual(['token-1']);
    expect(stored()).toBeNull();
  });

  it('disconnect still forgets it when the wallet cannot be reached', async () => {
    let first = true;
    const key = walletKey();
    const { wallet } = fakeWallet(key);
    const h = harness(wallet);
    await h.service.signIn({ userId: null, ...privy() });
    const failing = {
      ...h.deps,
      transact: (async () => {
        if (first) {
          first = false;
          throw Object.assign(new Error('none'), { code: 'ERROR_WALLET_NOT_FOUND' });
        }
      }) as MwaDeps['transact'],
    };
    const service = createMwaService(failing);
    await expect(service.disconnect('privy-user-1')).resolves.toEqual({ revoked: false });
    expect(h.stored()).toBeNull();
  });
});

/**
 * Phantom and Solflare on ordinary Android phones would not connect while the
 * Seeker's Seed Vault did. Wallets name Solana's clusters differently in an
 * account's `chains` — Seed Vault `solana:mainnet`, Phantom's own APIs
 * `solana:101`, WalletConnect-style wallets CAIP-2 — and sign-in refused any
 * account whose list lacked the exact `solana:mainnet`. Third-party wallets
 * also start slower than Seed Vault, and the native module gives a wallet only
 * 10 s to connect back.
 */
describe('wallets beyond the Seeker', () => {
  const PHANTOM_STYLE = ['solana:101', 'solana:102', 'solana:103'];
  const CAIP2_MAINNET = ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'];

  it.each([
    ['Phantom-style numbered chains', PHANTOM_STYLE],
    ['CAIP-2 chains', CAIP2_MAINNET],
    ['a devnet-only account (sign-in involves no cluster)', ['solana:devnet']],
    ['no chains at all', undefined],
  ])('signs in with %s', async (_name, chains) => {
    const key = walletKey();
    const { wallet } = fakeWallet(key, { accounts: [{ base64: key.base64, chains }] });
    const flow = privy();
    await expect(harness(wallet).service.signIn({ userId: null, ...flow })).resolves.toMatchObject({ address: key.address });
    expect(flow.complete).toHaveBeenCalledOnce();
  });

  it.each([
    ['solana:mainnet', ['solana:mainnet'], false],
    ['Phantom-style', PHANTOM_STYLE, false],
    ['CAIP-2 mainnet', CAIP2_MAINNET, false],
    ['MWA 1.x cluster name', ['mainnet-beta'], false],
    ['an unknown name', ['solana:something-new'], false],
    ['nothing listed', [], false],
    ['devnet only', ['solana:devnet'], true],
    ['devnet and testnet, numbered', ['solana:103', 'solana:102'], true],
  ])('a payment account listing %s is ruled out: %s', (_name, chains, ruledOut) => {
    expect(chainsRuleOut(chains, 'solana:mainnet')).toBe(ruledOut);
  });

  it('pays from a Phantom-style account', async () => {
    const key = walletKey();
    const { wallet, calls } = fakeWallet(key, { accounts: [{ base64: key.base64, chains: PHANTOM_STYLE }] });
    const { service } = harness(wallet);
    await expect(
      service.signAndSend({ userId: 'u', payer: key.address, prepare: async () => ({ transaction: transferFrom(key.address), minContextSlot: 1 }) }),
    ).resolves.toBe('wallet-signature-1');
    expect(calls.signAndSend).toHaveLength(1);
  });

  it('accepts a signature sent before the message', async () => {
    const key = walletKey();
    const message = new TextEncoder().encode('Sign in to Empire of Bits');
    const signature = ed25519.sign(message, key.secret);
    expect(detachedSignature(Uint8Array.from([...signature, ...message]), message, key.address)).toEqual(signature);
  });

  function flakyTransact(first: () => Promise<never>, wallet: ReturnType<typeof fakeWallet>['wallet'], sessions: (string | undefined)[]) {
    let attempt = 0;
    return (async (run: (w: unknown) => Promise<unknown>, baseUri?: string) => {
      attempt += 1;
      sessions.push(baseUri);
      if (attempt === 1) return first();
      return run(wallet);
    }) as MwaDeps['transact'];
  }

  it('tries once more when the wallet app did not connect back in time', async () => {
    const key = walletKey();
    const { wallet } = fakeWallet(key);
    const sessions: (string | undefined)[] = [];
    const timeout = () =>
      Promise.reject(Object.assign(new Error('Timed out waiting for local association to be ready'), { code: 'Timed out waiting for local association to be ready' }));
    const { service } = harness(wallet, { transact: flakyTransact(timeout, wallet, sessions) });
    const flow = privy();
    await expect(service.signIn({ userId: null, ...flow })).resolves.toMatchObject({ address: key.address });
    expect(sessions).toHaveLength(2);
    expect(flow.complete).toHaveBeenCalledOnce();
  });

  it('tries once more when the launch came straight back as cancelled', async () => {
    const key = walletKey();
    const { wallet } = fakeWallet(key);
    const sessions: (string | undefined)[] = [];
    const instantCancel = () =>
      Promise.reject(Object.assign(new Error('cancelled'), { code: 'Session not established: Local association cancelled by user' }));
    const { service } = harness(wallet, { transact: flakyTransact(instantCancel, wallet, sessions) });
    await expect(service.signIn({ userId: null, ...privy() })).resolves.toMatchObject({ address: key.address });
    expect(sessions).toHaveLength(2);
  });

  it('does not reopen the wallet after a person closed it', async () => {
    let now = NOW;
    const key = walletKey();
    const { wallet } = fakeWallet(key);
    const sessions: (string | undefined)[] = [];
    const humanCancel = () => {
      now += 4_000;
      return Promise.reject(Object.assign(new Error('cancelled'), { code: 'Session not established: Local association cancelled by user' }));
    };
    const { service } = harness(wallet, { now: () => now, transact: flakyTransact(humanCancel, wallet, sessions) });
    await expect(service.signIn({ userId: null, ...privy() })).rejects.toMatchObject({ kind: 'cancelled' });
    expect(sessions).toHaveLength(1);
  });

  it('never retries once the wallet was reached', async () => {
    const key = walletKey();
    const { wallet } = fakeWallet(key, {
      authorize: () => {
        throw Object.assign(new Error('Timed out waiting for response'), { code: 'Timed out waiting for response' });
      },
    });
    const { service, sessions } = harness(wallet);
    await expect(service.signIn({ userId: null, ...privy() })).rejects.toMatchObject({ kind: 'timeout' });
    expect(sessions).toHaveLength(1);
  });

  it('keeps the wallet’s own words for the screen and the log', () => {
    const error = toMwaError(Object.assign(new Error('Session closed by wallet'), { code: 'ERROR_SESSION_CLOSED' }), false);
    expect(error.detail).toBe('ERROR_SESSION_CLOSED: Session closed by wallet');
  });
});
