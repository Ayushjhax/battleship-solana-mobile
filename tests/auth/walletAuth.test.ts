/**
 * Wallet login and linking (src/features/auth/walletAuth.ts): Privy decides
 * who the player is from a verified signature over its own challenge; linking
 * never signs anyone in or out, and the server re-reads the account afterwards.
 */
import { describe, expect, it, vi } from 'vitest';

import { connectWallet, WalletAuthError, walletAuthError, type WalletAuthDeps } from '../../src/features/auth/walletAuth';
import { MwaError, type SignInProof } from '../../src/wallet/mwaCore';

const ADDRESS = 'Wa11et1111111111111111111111111111111111111';
const PROOF: SignInProof = {
  message: 'challenge',
  signature: 'c2lnbmF0dXJl',
  wallet: { walletClientType: 'phantom', connectorType: 'mobile_wallet_protocol' },
};

function harness(overrides: Partial<WalletAuthDeps> = {}) {
  const deps: WalletAuthDeps = {
    userId: null,
    signIn: vi.fn(async ({ createMessage, complete }) => {
      await createMessage(ADDRESS);
      await complete(PROOF);
      return { address: ADDRESS, label: 'Main', walletClientType: 'phantom' };
    }),
    generateMessage: vi.fn(async () => ({ message: 'challenge' })),
    login: vi.fn(async () => ({ id: 'new-user' })),
    link: vi.fn(async () => ({ id: 'google-user' })),
    refreshUser: vi.fn(async () => undefined),
    resync: vi.fn(),
    ...overrides,
  };
  return deps;
}

describe('wallet login', () => {
  it('asks Privy for the challenge on the app’s domain and logs in with the proof', async () => {
    const deps = harness();
    await expect(connectWallet('login', deps)).resolves.toMatchObject({ address: ADDRESS });
    expect(deps.generateMessage).toHaveBeenCalledWith('login', {
      wallet: { address: ADDRESS },
      from: { domain: 'empireofbits.xyz', uri: 'https://empireofbits.xyz' },
    });
    expect(deps.login).toHaveBeenCalledWith(PROOF);
    expect(deps.link).not.toHaveBeenCalled();
    // The new session's own sync runs; login does not trigger a second one.
    expect(deps.resync).not.toHaveBeenCalled();
    expect(vi.mocked(deps.signIn).mock.calls[0]?.[0].userId).toBeNull();
  });

  it('is refused while someone is signed in, before the wallet opens', async () => {
    const deps = harness({ userId: 'google-user' });
    await expect(connectWallet('login', deps)).rejects.toBeInstanceOf(WalletAuthError);
    expect(deps.signIn).not.toHaveBeenCalled();
  });

  it.each([
    ['cancelled', new MwaError('cancelled', 'x'), 'The wallet was closed before connecting.'],
    ['declined', new MwaError('declined', 'x'), 'The request was declined in your wallet.'],
    ['no wallet app', new MwaError('no_wallet', 'No Solana wallet app'), 'No Solana wallet app'],
  ])('reports a %s wallet without calling Privy', async (_name, error, message) => {
    const deps = harness({
      signIn: vi.fn(async () => {
        throw error;
      }),
    });
    await expect(connectWallet('login', deps)).rejects.toMatchObject({ message });
    expect(deps.login).not.toHaveBeenCalled();
  });

  it('explains Privy refusing the signature', async () => {
    const deps = harness({
      login: vi.fn(async () => {
        throw Object.assign(new Error('Invalid'), { code: 'invalid_credentials' });
      }),
    });
    await expect(connectWallet('login', deps)).rejects.toMatchObject({ code: 'invalid_credentials', retryable: true });
  });
});

describe('linking a wallet to a Google or email account', () => {
  it('links to the signed-in user, then refreshes Privy and re-syncs the server', async () => {
    const deps = harness({ userId: 'google-user' });
    await connectWallet('link', deps);
    expect(vi.mocked(deps.signIn).mock.calls[0]?.[0].userId).toBe('google-user');
    expect(deps.generateMessage).toHaveBeenCalledWith('link', expect.anything());
    expect(deps.link).toHaveBeenCalledWith(PROOF);
    expect(deps.login).not.toHaveBeenCalled();
    expect(deps.refreshUser).toHaveBeenCalledOnce();
    expect(deps.resync).toHaveBeenCalledOnce();
  });

  it('needs a signed-in user', async () => {
    const deps = harness();
    await expect(connectWallet('link', deps)).rejects.toMatchObject({ code: 'not_signed_in' });
    expect(deps.signIn).not.toHaveBeenCalled();
  });

  it('says plainly when the wallet already belongs to another account, and changes nothing', async () => {
    const deps = harness({
      userId: 'google-user',
      link: vi.fn(async () => {
        throw Object.assign(new Error('linked'), { code: 'linked_to_another_user' });
      }),
    });
    const failure = await connectWallet('link', deps).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'linked_to_another_user', retryable: false });
    expect((failure as Error).message).toMatch(/another Empire of Bits account/);
    expect(deps.resync).not.toHaveBeenCalled();
  });

  it('a cancelled link leaves the account as it was', async () => {
    const deps = harness({
      userId: 'google-user',
      signIn: vi.fn(async () => {
        throw new MwaError('cancelled', 'x');
      }),
    });
    await expect(connectWallet('link', deps)).rejects.toMatchObject({ code: 'mwa_cancelled' });
    expect(deps.link).not.toHaveBeenCalled();
    expect(deps.refreshUser).not.toHaveBeenCalled();
    expect(deps.resync).not.toHaveBeenCalled();
  });

  it('still re-syncs when refreshing the local Privy user fails', async () => {
    const deps = harness({
      userId: 'google-user',
      refreshUser: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    await expect(connectWallet('link', deps)).resolves.toMatchObject({ address: ADDRESS });
    expect(deps.resync).toHaveBeenCalledOnce();
  });
});

describe('error words', () => {
  it('names the dashboard setting when Privy has wallet login switched off', () => {
    expect(walletAuthError(Object.assign(new Error('x'), { code: 'disallowed_login_method' })).message).toMatch(/not switched on/);
  });

  it('never shows a raw internal message', () => {
    expect(walletAuthError(new Error('TypeError: undefined is not a function')).message).toBe(
      'The wallet sign-in could not be completed. Try again.',
    );
  });
});
