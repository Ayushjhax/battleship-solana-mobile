/**
 * Mobile Wallet Adapter sessions with the player's own Solana wallet app
 * (Phantom, Solflare, Seed Vault on a Seeker, …). Pure: the native `transact`,
 * secure storage, the clock and the app's foreground state come in as deps, so
 * every path is driven by tests/wallet/mwaCore.test.ts. `mwa.ts` binds it.
 *
 * The wallet is only ever asked for two things, each approved by the player in
 * the wallet app: a signature over Privy's Sign In With Solana message (login
 * and linking — never a payment), and one transfer the player confirmed on the
 * points desk. Nothing here holds a key, and nothing signs on its own.
 *
 *   - One session at a time. A second tap while the wallet is open is refused
 *     rather than queued behind it, and the lock is held until the native
 *     session really ends — a request that timed out on this side may still be
 *     open in the wallet.
 *   - The wallet's `auth_token` is cached in secure storage for one Privy user,
 *     one address and one chain, so a payment can skip the connect prompt. A
 *     token the wallet refuses is discarded (MWA spec) and authorization asked
 *     for again, once. Sign-out and a change of user clear it. Disconnect also
 *     asks the wallet to revoke it.
 *   - The transfer is sent by the wallet (`signAndSendTransactions`, mandatory
 *     in MWA 2.0; `signTransactions` is deprecated and optional). Whether a
 *     failure could have sent it decides whether a purchase is dropped or kept
 *     for the server to look for: only a wallet that declined, or a failure
 *     before the request reached it, is "nothing sent".
 */
import { ed25519 } from '@noble/curves/ed25519';
import { PublicKey, type Transaction } from '@solana/web3.js';
import type { Web3MobileWallet } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import { Buffer } from 'buffer';

import type { SolanaClusterName } from './solana';

export type MwaChain = 'solana:mainnet' | 'solana:devnet' | 'solana:testnet';

export function mwaChainFor(cluster: SolanaClusterName): MwaChain {
  return cluster === 'mainnet-beta' ? 'solana:mainnet' : cluster === 'testnet' ? 'solana:testnet' : 'solana:devnet';
}

/** The site the wallet shows the request as coming from, and the SIWS domain Privy must allow. */
export const APP_DOMAIN = 'empireofbits.xyz';
export const APP_URI = `https://${APP_DOMAIN}`;
/** `icon` is relative to `uri` (MWA spec): https://empireofbits.xyz/favicon.ico. */
export const MWA_IDENTITY = { name: 'Empire of Bits', uri: APP_URI, icon: 'favicon.ico' } as const;
/** Privy's own example value for a mobile wallet connection (docs: SIWS login on React Native). */
export const MWA_CONNECTOR_TYPE = 'mobile_wallet_protocol';
/** A cached authorization is kept this long at most; the wallet may end it sooner. */
export const AUTHORIZATION_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
/**
 * A backstop only. The native module already gives up on an unanswered request
 * after 90 s and on a wallet that never connects after 10 s; this catches a
 * session that never settles at all.
 */
export const SESSION_BACKSTOP_MS = 4 * 60_000;
const SIGNATURE_BYTES = 64;

export type MwaErrorKind =
  | 'unsupported'
  | 'busy'
  | 'background'
  | 'no_wallet'
  | 'cancelled'
  | 'declined'
  | 'authorization_failed'
  | 'account_mismatch'
  | 'chain_unsupported'
  | 'invalid_response'
  | 'expired'
  | 'timeout'
  | 'session_changed'
  | 'failed';

/**
 * A wallet request that did not complete. `nothingSent` is true only when no
 * transaction can have reached the network: the request failed before the
 * wallet was asked to send, or the wallet declined to sign it.
 */
export class MwaError extends Error {
  readonly mayHaveSent: boolean;

  constructor(
    readonly kind: MwaErrorKind,
    message: string,
    readonly nothingSent = true,
    /** The wallet's or the native module's own code and words, for the screen and the log. */
    readonly detail: string | null = null,
  ) {
    super(message);
    this.name = 'MwaError';
    this.mayHaveSent = !nothingSent;
  }
}

/** "code: message", short: what the wallet itself said went wrong. */
function errorDetail(code: number | string | null, message: string): string | null {
  const text = [code === null ? '' : String(code), message].filter(Boolean).join(': ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 120) : null;
}

/** The protocol error code, from either shape the React Native module produces. */
export function mwaErrorCode(error: unknown): number | string | null {
  const value = error as { code?: unknown; userInfo?: { jsonRpcErrorCode?: unknown } } | null;
  // Inside `transact` a wallet's JSON-RPC error is still the raw native one;
  // `transact` converts it to a SolanaMobileWalletAdapterProtocolError on the way out.
  if (value?.code === 'JSON_RPC_ERROR' && typeof value.userInfo?.jsonRpcErrorCode === 'number') {
    return value.userInfo.jsonRpcErrorCode;
  }
  return typeof value?.code === 'number' || typeof value?.code === 'string' ? value.code : null;
}

const ERROR_AUTHORIZATION_FAILED = -1;
const ERROR_INVALID_PAYLOADS = -2;
const ERROR_NOT_SIGNED = -3;
const ERROR_TOO_MANY_PAYLOADS = -5;

/**
 * Turns whatever the native module threw into an MwaError with words for the
 * player. `sending`: the wallet had been asked to send a transaction.
 */
export function toMwaError(error: unknown, sending: boolean): MwaError {
  if (error instanceof MwaError) return error;
  const code = mwaErrorCode(error);
  const message = error instanceof Error ? error.message : String(error ?? '');
  const detail = errorDetail(code, message);
  if (code === 'ERROR_WALLET_NOT_FOUND') {
    return new MwaError(
      'no_wallet',
      'No Solana wallet app that supports Mobile Wallet Adapter was found on this phone. Install one, then try again.',
      true,
      detail,
    );
  }
  // The native module reports a closed association as the code "Session not
  // established: Local association cancelled by user"; on the web it is
  // ERROR_ASSOCIATION_CANCELLED. Both are before any request reached the wallet.
  if (isAssociationCancel(code)) {
    return new MwaError('cancelled', 'The wallet was closed before connecting.', true, detail);
  }
  if (code === ERROR_NOT_SIGNED) return new MwaError('declined', 'The request was declined in the wallet.', true, detail);
  if (code === ERROR_AUTHORIZATION_FAILED) {
    return new MwaError('authorization_failed', 'The wallet did not authorize this app. Connect again to continue.', true, detail);
  }
  if (code === ERROR_INVALID_PAYLOADS || code === ERROR_TOO_MANY_PAYLOADS) {
    return new MwaError('invalid_response', 'The wallet could not accept this request.', true, detail);
  }
  if (code === 'ERROR_SESSION_TIMEOUT' || /timed out/i.test(message) || (typeof code === 'string' && /timed out/i.test(code))) {
    return new MwaError('timeout', 'The wallet did not answer in time.', !sending, detail);
  }
  return new MwaError('failed', 'The wallet request did not complete.', !sending, detail);
}

function isAssociationCancel(code: number | string | null): boolean {
  return code === 'ERROR_ASSOCIATION_CANCELLED' || (typeof code === 'string' && /association cancelled/i.test(code));
}

/**
 * The session never got going: the wallet app did not connect back within the
 * native module's fixed 10 s (a wallet still starting up, or waiting at its
 * own unlock screen), or the launch came straight back as "cancelled" before a
 * person could have cancelled it. Nothing reached the wallet, so one retry is
 * safe — by then the wallet app is running and connects at once.
 */
function associationFailed(error: unknown, elapsedMs: number): boolean {
  const code = mwaErrorCode(error);
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (typeof code === 'string' && /local association to be ready/i.test(code)) return true;
  if (/local association to be ready/i.test(message)) return true;
  return isAssociationCancel(code) && elapsedMs < EARLY_CANCEL_MS;
}

/** A "cancel" faster than this came from the launch itself, not from a person. */
export const EARLY_CANCEL_MS = 1500;

/** A 32-byte Solana address, base64 as MWA carries it, as base58. */
export function base58FromMwaAddress(address: string): string {
  const bytes = Buffer.from(address, 'base64');
  if (bytes.length !== 32) throw new MwaError('invalid_response', 'The wallet returned an address that is not a Solana address.');
  return new PublicKey(bytes).toBase58();
}

export function mwaAddressFromBase58(address: string): string {
  return Buffer.from(new PublicKey(address).toBytes()).toString('base64');
}

/**
 * The detached Ed25519 signature over `message`, checked against `address`.
 * MWA returns each signed payload as the message with the signature appended
 * (spec: sign_messages); some wallets return the 64-byte signature alone. Both
 * reduce to the 64 bytes Sign In With Solana verifies — anything else, or a
 * signature that does not verify, is refused here rather than sent to Privy.
 */
export function detachedSignature(payload: Uint8Array, message: Uint8Array, address: string): Uint8Array {
  const key = new PublicKey(address).toBytes();
  const candidates: Uint8Array[] = [];
  if (payload.length === SIGNATURE_BYTES) candidates.push(payload);
  if (payload.length === message.length + SIGNATURE_BYTES) {
    const bytes = Buffer.from(message);
    // message || signature (the spec) — or signature || message, which some wallets send.
    if (Buffer.from(payload.subarray(0, message.length)).equals(bytes)) candidates.push(payload.subarray(message.length));
    if (Buffer.from(payload.subarray(SIGNATURE_BYTES)).equals(bytes)) candidates.push(payload.subarray(0, SIGNATURE_BYTES));
  }
  const signature = candidates.find((candidate) => ed25519.verify(candidate, message, key));
  if (!signature) {
    throw new MwaError(
      'invalid_response',
      'The wallet returned a signature that does not match. Sign-in was not completed.',
      true,
      `signed payload of ${payload.length} bytes for a ${message.length}-byte message`,
    );
  }
  return Uint8Array.from(signature);
}

/**
 * The names wallets use for Solana's clusters in an account's `chains`. MWA 2.0
 * says `solana:mainnet`, but wallets differ: Phantom's own APIs number them
 * (`solana:101`), WalletConnect-style wallets use CAIP-2 (`solana:` + the first
 * 32 characters of the genesis hash), and MWA 1.x used cluster names.
 */
const CHAIN_ALIASES: Readonly<Record<MwaChain, readonly string[]>> = {
  'solana:mainnet': [
    'solana:mainnet',
    'solana:mainnet-beta',
    'mainnet-beta',
    'mainnet',
    'solana:101',
    'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  ],
  'solana:devnet': ['solana:devnet', 'devnet', 'solana:103', 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'],
  'solana:testnet': ['solana:testnet', 'testnet', 'solana:102', 'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z'],
};

/**
 * Whether an account's `chains` positively rule out `wanted`: every chain it
 * lists is a known name for another cluster. Missing, empty or unrecognised
 * lists do not — the match server checks the network of every payment anyway.
 */
export function chainsRuleOut(chains: readonly string[] | undefined, wanted: MwaChain): boolean {
  if (!chains || chains.length === 0) return false;
  const known = (chain: string) => Object.values(CHAIN_ALIASES).some((aliases) => aliases.includes(chain));
  const isWanted = (chain: string) => CHAIN_ALIASES[wanted].includes(chain);
  return !chains.some(isWanted) && chains.every(known);
}

/**
 * Privy's `walletClientType` (its docs' example: 'phantom'), from the wallet's
 * own endpoint URI: phantom.app → 'phantom'. Never 'privy', which the match
 * server reads as Privy's embedded wallet.
 */
export function walletClientTypeOf(walletUriBase: string | null | undefined): string {
  if (!walletUriBase) return 'unknown';
  try {
    const labels = new URL(walletUriBase).hostname.toLowerCase().split('.').filter(Boolean);
    const name = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
    if (name && name !== 'privy' && /^[a-z0-9-]{1,40}$/.test(name)) return name;
  } catch {
    // Not a URL: no name to take from it.
  }
  return 'unknown';
}

export interface StoredAuthorization {
  readonly userId: string;
  readonly address: string;
  readonly chain: MwaChain;
  readonly authToken: string;
  readonly walletUriBase: string | null;
  readonly label: string | null;
  readonly savedAt: number;
}

/** What the screens may show about the connected wallet. Never the token. */
export interface MwaAccount {
  readonly address: string;
  /** The account's name as the wallet gave it, when it gave one. */
  readonly label: string | null;
  /** From the wallet's endpoint URI ('phantom', 'solflare', …), or 'unknown'. */
  readonly walletClientType: string;
}

export interface SignInProof {
  readonly message: string;
  /** The detached Ed25519 signature, base64 (Privy's SIWS format). */
  readonly signature: string;
  readonly wallet: { readonly walletClientType: string; readonly connectorType: string };
}

export type MwaTransact = <T>(run: (wallet: Web3MobileWallet) => Promise<T>, baseUri?: string) => Promise<T>;

export interface MwaDeps {
  readonly transact: MwaTransact;
  readonly read: () => Promise<string | null>;
  readonly write: (value: string) => Promise<void>;
  readonly remove: () => Promise<void>;
  readonly now: () => number;
  /** MWA launches the wallet from the app's activity, so the app must be in front. */
  readonly isForeground: () => boolean;
  readonly chain: MwaChain;
  readonly backstopMs?: number;
}

interface Authorized {
  readonly address: string;
  readonly addressBase64: string;
  readonly authToken: string;
  readonly walletUriBase: string | null;
  readonly label: string | null;
}

interface SessionContext {
  /** Throws once the session was cleared (sign-out, user change) while the wallet was open. */
  readonly checkCurrent: () => void;
  /** Marks the point after which a failure may have sent a transaction. */
  readonly markSending: () => void;
}

function parseStored(raw: string | null): StoredAuthorization | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredAuthorization>;
    if (
      typeof value.userId !== 'string' ||
      !value.userId ||
      typeof value.address !== 'string' ||
      typeof value.chain !== 'string' ||
      typeof value.authToken !== 'string' ||
      !value.authToken ||
      typeof value.savedAt !== 'number'
    ) {
      return null;
    }
    new PublicKey(value.address);
    return {
      userId: value.userId,
      address: value.address,
      chain: value.chain as MwaChain,
      authToken: value.authToken,
      walletUriBase: typeof value.walletUriBase === 'string' ? value.walletUriBase : null,
      label: typeof value.label === 'string' ? value.label : null,
      savedAt: value.savedAt,
    };
  } catch {
    return null;
  }
}

/** Failures from a session that never got going, which session() retries once. */
const retryableAssociation = new WeakSet<MwaError>();

/** Every wallet failure reaches the device log (adb logcat, tag ReactNativeJS) with the wallet's own words. */
function logFailure(error: MwaError): void {
  console.warn(`[mwa] ${error.kind}${error.detail ? ` — ${error.detail}` : ''}`);
}

export function createMwaService(deps: MwaDeps) {
  let active = false;
  /** Bumped by clear(): a session opened before it may not save or use anything after. */
  let generation = 0;
  let writes: Promise<void> = Promise.resolve();

  function queueWrite(task: () => Promise<void>): Promise<void> {
    writes = writes.then(task, task).catch(() => {
      // Storage failures never block the wallet flow; the cache is a convenience.
    });
    return writes;
  }

  async function readStored(): Promise<StoredAuthorization | null> {
    await writes;
    try {
      return parseStored(await deps.read());
    } catch {
      return null;
    }
  }

  /** The cached authorization for this user on this chain, if it is still fresh. */
  async function cachedFor(userId: string, address?: string): Promise<StoredAuthorization | null> {
    const stored = await readStored();
    if (!stored) return null;
    const stale = deps.now() - stored.savedAt > AUTHORIZATION_MAX_AGE_MS || stored.savedAt > deps.now() + 60_000;
    if (stored.userId !== userId || stored.chain !== deps.chain || stale) {
      // Another user's, another network's, or too old: never used, so not kept.
      await queueWrite(deps.remove);
      return null;
    }
    return !address || stored.address === address ? stored : null;
  }

  async function save(userId: string, authorized: Authorized): Promise<void> {
    const value: StoredAuthorization = {
      userId,
      address: authorized.address,
      chain: deps.chain,
      authToken: authorized.authToken,
      walletUriBase: authorized.walletUriBase,
      label: authorized.label,
      savedAt: deps.now(),
    };
    await queueWrite(() => deps.write(JSON.stringify(value)));
  }

  /**
   * One wallet session, retried once when it never got going (see
   * associationFailed): the wallet app had not connected back, so nothing was
   * asked of it. The retry drops a cached `baseUri`, in case that link is what
   * failed to open the wallet.
   */
  async function session<T>(
    body: (wallet: Web3MobileWallet, context: SessionContext) => Promise<T>,
    baseUri?: string | null,
  ): Promise<T> {
    try {
      return await sessionOnce(body, baseUri);
    } catch (error) {
      if (!(error instanceof MwaError) || !retryableAssociation.has(error)) throw error;
      // The failed session's lock is released as it settles; let that land.
      if (active) await new Promise((resolve) => setTimeout(resolve, 0));
      return sessionOnce(body, null);
    }
  }

  async function sessionOnce<T>(
    body: (wallet: Web3MobileWallet, context: SessionContext) => Promise<T>,
    baseUri?: string | null,
  ): Promise<T> {
    if (active) throw new MwaError('busy', 'Your wallet is already open with a request. Finish it there first.');
    if (!deps.isForeground()) throw new MwaError('background', 'Return to the game before opening your wallet.');
    active = true;
    const opened = generation;
    const started = deps.now();
    let entered = false;
    let sending = false;
    let timedOut = false;
    const context: SessionContext = {
      checkCurrent: () => {
        if (opened !== generation) {
          throw new MwaError('session_changed', 'You signed out while the wallet was open. Nothing more was asked of it.', !sending);
        }
        if (timedOut) throw new MwaError('timeout', 'The wallet did not answer in time.', !sending);
      },
      markSending: () => {
        sending = true;
      },
    };
    let operation: Promise<T>;
    try {
      operation = deps.transact((wallet) => {
        entered = true;
        return body(wallet, context);
      }, baseUri ?? undefined);
    } catch (error) {
      active = false;
      throw toMwaError(error, false);
    }
    // Released only when the native session has ended, never on the timer below.
    operation.then(
      () => {
        active = false;
      },
      () => {
        active = false;
      },
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const backstop = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new MwaError('timeout', 'The wallet did not answer in time.', !sending));
      }, deps.backstopMs ?? SESSION_BACKSTOP_MS);
    });
    try {
      return await Promise.race([operation, backstop]);
    } catch (error) {
      const failure = toMwaError(error, sending);
      if (!entered && !timedOut && associationFailed(error, deps.now() - started)) retryableAssociation.add(failure);
      logFailure(failure);
      throw failure;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Authorizes this app with the wallet. With `cached`, the wallet can approve
   * silently; a token it refuses is discarded and a fresh authorization asked
   * for once. `expected` must be among the accounts it authorizes.
   */
  async function authorize(
    wallet: Web3MobileWallet,
    context: SessionContext,
    cached: StoredAuthorization | null,
    expected?: string,
  ): Promise<Authorized> {
    // Sign-in never touches a cluster; only a payment needs the wallet on ours.
    const request = { chain: deps.chain, identity: MWA_IDENTITY };
    let result: Awaited<ReturnType<Web3MobileWallet['authorize']>>;
    try {
      result = await wallet.authorize(cached ? { ...request, auth_token: cached.authToken } : request);
    } catch (error) {
      if (!cached || mwaErrorCode(error) !== ERROR_AUTHORIZATION_FAILED) throw error;
      await queueWrite(deps.remove);
      context.checkCurrent();
      result = await wallet.authorize(request);
    }
    context.checkCurrent();
    const accounts = result.accounts.map((account) => ({
      account,
      address: base58FromMwaAddress(String(account.address)),
    }));
    const picked = expected ? accounts.find((entry) => entry.address === expected) : accounts[0];
    if (!picked) {
      if (cached) await queueWrite(deps.remove);
      throw new MwaError(
        'account_mismatch',
        expected
          ? `The wallet connected a different account, not ${shortAddress(expected)}. Select that account in your wallet and try again. Nothing was sent.`
          : 'The wallet did not share an account.',
      );
    }
    const chains = 'chains' in picked.account ? picked.account.chains : undefined;
    if (expected && chainsRuleOut(Array.isArray(chains) ? chains.map(String) : undefined, deps.chain)) {
      throw new MwaError(
        'chain_unsupported',
        `That wallet account is set to another Solana network, not ${deps.chain}. Switch it to mainnet in the wallet. Nothing was sent.`,
        true,
        `account chains: ${(chains ?? []).join(', ')}`,
      );
    }
    const label = 'label' in picked.account && typeof picked.account.label === 'string' ? picked.account.label : null;
    return {
      address: picked.address,
      addressBase64: String(picked.account.address),
      authToken: result.auth_token,
      walletUriBase: result.wallet_uri_base || null,
      label,
    };
  }

  function account(authorized: Pick<Authorized, 'address' | 'label' | 'walletUriBase'>): MwaAccount {
    return {
      address: authorized.address,
      label: authorized.label,
      walletClientType: walletClientTypeOf(authorized.walletUriBase),
    };
  }

  return {
    isBusy: () => active,

    /** The wallet connected on this device for this user, if any. */
    async restore(userId: string): Promise<MwaAccount | null> {
      const stored = await cachedFor(userId);
      return stored ? account(stored) : null;
    },

    /**
     * Sign In With Solana through the wallet: login (`userId` null) or linking
     * to the signed-in user. Always a fresh authorization, so the player picks
     * the wallet. `createMessage` is Privy's challenge for the address;
     * `complete` hands Privy the proof and returns the user it signed in or
     * linked to. Privy is called after the wallet session has closed.
     */
    async signIn(options: {
      readonly userId: string | null;
      readonly createMessage: (address: string) => Promise<string>;
      readonly complete: (proof: SignInProof) => Promise<{ readonly id: string }>;
    }): Promise<MwaAccount> {
      const opened = generation;
      const signed = await session(async (wallet, context) => {
        const authorized = await authorize(wallet, context, null);
        const message = await options.createMessage(authorized.address);
        context.checkCurrent();
        const bytes = new TextEncoder().encode(message);
        const [payload] = await wallet.signMessages({ addresses: [authorized.addressBase64], payloads: [bytes] });
        context.checkCurrent();
        if (!payload) throw new MwaError('invalid_response', 'The wallet returned no signature.');
        const signature = detachedSignature(payload, bytes, authorized.address);
        return { authorized, message, signature: Buffer.from(signature).toString('base64') };
      });
      const connected = account(signed.authorized);
      const user = await options.complete({
        message: signed.message,
        signature: signed.signature,
        wallet: { walletClientType: connected.walletClientType, connectorType: MWA_CONNECTOR_TYPE },
      });
      if (options.userId && user.id !== options.userId) {
        throw new MwaError('session_changed', 'The wallet was linked to a different account than the one signed in. Nothing was changed here.');
      }
      if (opened === generation) await save(user.id, signed.authorized);
      return connected;
    },

    /**
     * Has the wallet sign and send one transaction from `payer`. `prepare`
     * runs once the wallet has authorized `payer` — the place to fetch a
     * blockhash and make the last checks — and returns the unsigned
     * transaction. Resolves with the wallet's signature (base58).
     */
    async signAndSend(options: {
      readonly userId: string;
      readonly payer: string;
      readonly prepare: () => Promise<{ readonly transaction: Transaction; readonly minContextSlot?: number }>;
    }): Promise<string> {
      const cached = await cachedFor(options.userId, options.payer);
      return session(async (wallet, context) => {
        const authorized = await authorize(wallet, context, cached, options.payer);
        await save(options.userId, authorized);
        const { transaction, minContextSlot } = await options.prepare();
        context.checkCurrent();
        if (!transaction.feePayer?.equals(new PublicKey(options.payer))) {
          throw new MwaError('account_mismatch', 'The payment was not set up for this wallet. Nothing was sent.');
        }
        context.markSending();
        const [signature] = await wallet.signAndSendTransactions({
          transactions: [transaction],
          ...(minContextSlot === undefined ? {} : { minContextSlot }),
          commitment: 'confirmed',
        });
        if (!signature) throw new MwaError('invalid_response', 'The wallet returned no transaction signature.', false);
        return signature;
      }, cached?.walletUriBase);
    },

    /** Forgets the wallet on this device. Never opens the wallet; safe during sign-out. */
    async clear(): Promise<void> {
      generation += 1;
      await queueWrite(deps.remove);
    },

    /**
     * Disconnect: forgets the wallet here, then asks the wallet to revoke its
     * authorization (this opens the wallet briefly). The wallet stays linked to
     * the account; a revoke the wallet refuses still leaves it forgotten here.
     */
    async disconnect(userId: string): Promise<{ readonly revoked: boolean }> {
      const stored = await readStored();
      generation += 1;
      await queueWrite(deps.remove);
      if (!stored || stored.userId !== userId) return { revoked: false };
      try {
        await session(async (wallet) => {
          await wallet.deauthorize({ auth_token: stored.authToken });
        }, stored.walletUriBase);
        return { revoked: true };
      } catch {
        return { revoked: false };
      }
    },
  };
}

export type MwaService = ReturnType<typeof createMwaService>;

function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}
