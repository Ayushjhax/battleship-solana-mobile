/**
 * Signing in, or linking, with a Solana wallet app — Privy's Sign In With
 * Solana over Mobile Wallet Adapter. Privy stays the account and session: the
 * wallet only signs Privy's one-time challenge, the signature is checked here
 * before Privy sees it, and Privy decides who the player is. An address alone
 * never signs anyone in, and no payment is involved.
 *
 *   login   no Privy user yet. Privy refuses it while one is signed in.
 *   link    adds the wallet to the signed-in Google/email account. Privy
 *           refuses it when nobody is signed in, and refuses a wallet another
 *           Privy account already holds — nothing is merged and no balance
 *           moves. Afterwards the match server re-reads the account's wallets
 *           from Privy, and reports a wallet it already records for another
 *           account as a conflict.
 *
 * Pure (tests/auth/walletAuth.test.ts): Privy, the wallet and the sync come in
 * as deps; `useWalletAuth.ts` wires them.
 */
import { APP_DOMAIN, APP_URI, MwaError, type MwaAccount, type SignInProof } from '@/wallet/mwaCore';

export type WalletAuthMode = 'login' | 'link';

export interface WalletAuthDeps {
  /** The signed-in Privy user's id, or null. */
  readonly userId: string | null;
  readonly signIn: (options: {
    readonly userId: string | null;
    readonly createMessage: (address: string) => Promise<string>;
    readonly complete: (proof: SignInProof) => Promise<{ readonly id: string }>;
  }) => Promise<MwaAccount>;
  readonly generateMessage: (
    mode: WalletAuthMode,
    args: { wallet: { address: string }; from: { domain: string; uri: string } },
  ) => Promise<{ message: string }>;
  readonly login: (proof: SignInProof) => Promise<{ readonly id: string }>;
  readonly link: (proof: SignInProof) => Promise<{ readonly id: string }>;
  /** Re-reads the Privy user, so the new linked wallet is visible. */
  readonly refreshUser: () => Promise<unknown>;
  /** Re-runs /auth/privy/sync, which records the wallet as verified on the server. */
  readonly resync: () => void;
}

/** A refusal with words for the player, and whether trying again could help. */
export class WalletAuthError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly code: string,
  ) {
    super(message);
    this.name = 'WalletAuthError';
  }
}

const PRIVY_COPY: Record<string, { message: string; retryable: boolean }> = {
  linked_to_another_user: {
    message:
      'That wallet already belongs to another Empire of Bits account. Sign in with it there, or link a different wallet. Nothing was changed.',
    retryable: false,
  },
  attempted_login_with_siws_while_already_logged_in: {
    message: 'You are already signed in. Link the wallet from your profile instead.',
    retryable: false,
  },
  attempted_link_siws_before_logged_in: {
    message: 'Sign in before linking a wallet.',
    retryable: false,
  },
  disallowed_login_method: {
    message: 'Wallet sign-in is not switched on for this game yet. Use Google or email for now.',
    retryable: false,
  },
  allowlist_rejected: {
    message: 'This wallet is not allowed to sign in to this game.',
    retryable: false,
  },
  invalid_credentials: {
    message: 'The wallet signature was not accepted. Try again.',
    retryable: true,
  },
};

const MWA_COPY: Partial<Record<MwaError['kind'], string>> = {
  cancelled: 'The wallet was closed before connecting.',
  declined: 'The request was declined in your wallet.',
  authorization_failed: 'Your wallet did not approve the connection.',
};

/** Kinds that are the player's own choice or the app's own state: no wallet detail to add. */
const NO_DETAIL: readonly MwaError['kind'][] = ['declined', 'busy', 'background', 'unsupported', 'no_wallet'];

/** "(…)" with what the wallet or Privy itself reported, so a failure on any phone says why. */
function withDetail(message: string, detail: string | null | undefined): string {
  return detail ? `${message} (${detail.slice(0, 70)})` : message;
}

/** Words for any failure of the flow. */
export function walletAuthError(error: unknown): WalletAuthError {
  if (error instanceof WalletAuthError) return error;
  if (error instanceof MwaError) {
    const base = MWA_COPY[error.kind] ?? error.message;
    return new WalletAuthError(
      NO_DETAIL.includes(error.kind) ? base : withDetail(base, error.detail),
      !['unsupported', 'no_wallet'].includes(error.kind),
      `mwa_${error.kind}`,
    );
  }
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && PRIVY_COPY[code]) {
    const copy = PRIVY_COPY[code];
    return new WalletAuthError(copy.message, copy.retryable, code);
  }
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/network|fetch|timeout|offline/i.test(message)) {
    return new WalletAuthError('Check your connection and try again.', true, 'network');
  }
  if (/domain|origin/i.test(message)) {
    // Privy checks the SIWS domain against the app's allowed domains.
    return new WalletAuthError(`Wallet sign-in is not set up for ${APP_DOMAIN} yet. Use Google or email for now.`, false, 'domain');
  }
  return new WalletAuthError(
    // Privy's own error code helps; a raw internal message does not belong on screen.
    withDetail('The wallet sign-in could not be completed. Try again.', typeof code === 'string' ? code : null),
    true,
    'unknown',
  );
}

/** Runs one login or link. Resolves with the wallet account Privy accepted. */
export async function connectWallet(mode: WalletAuthMode, deps: WalletAuthDeps): Promise<MwaAccount> {
  if (mode === 'link' && !deps.userId) throw new WalletAuthError('Sign in before linking a wallet.', false, 'not_signed_in');
  if (mode === 'login' && deps.userId) {
    throw new WalletAuthError('You are already signed in. Link the wallet from your profile instead.', false, 'signed_in');
  }
  let connected: MwaAccount;
  try {
    connected = await deps.signIn({
      userId: mode === 'link' ? deps.userId : null,
      createMessage: async (address) =>
        (await deps.generateMessage(mode, { wallet: { address }, from: { domain: APP_DOMAIN, uri: APP_URI } })).message,
      complete: (proof) => (mode === 'link' ? deps.link(proof) : deps.login(proof)),
    });
  } catch (error) {
    const failure = walletAuthError(error);
    // The device log (adb logcat, tag ReactNativeJS) keeps the full story.
    console.warn(`[wallet-auth] ${mode} failed: ${failure.code} — ${failure.message}`);
    throw failure;
  }
  if (mode === 'link') {
    // Login needs neither: Privy's new session mounts the app, whose
    // PrivyProfileSync runs the first sync itself.
    try {
      await deps.refreshUser();
    } catch {
      // The sync below reads Privy server-side; a stale local user only delays the label.
    }
    deps.resync();
  }
  return connected;
}
