/**
 * Who may unlink a wallet (src/features/auth/privyUser.ts): never the last way
 * to sign in — Privy alone would allow it while the embedded wallet remains,
 * but that wallet signs nobody in — and never the wallet that pays.
 */
import type { User } from '@privy-io/expo';
import { describe, expect, it } from 'vitest';

import { externalSolanaWallets, privyLoginMethods, unlinkRefusal } from '../../src/features/auth/privyUser';

const EXTERNAL = 'Ext1111111111111111111111111111111111111111';
const OTHER = 'Ext2222222222222222222222222222222222222222';
const EMBEDDED = 'Emb1111111111111111111111111111111111111111';

function user(accounts: object[]): User {
  return { id: 'privy-user', created_at: 0, linked_accounts: accounts } as unknown as User;
}

const google = { type: 'google_oauth', email: 'captain@example.com', name: 'Captain' };
const email = { type: 'email', address: 'captain@example.com' };
const embedded = { type: 'wallet', chain_type: 'solana', address: EMBEDDED, connector_type: 'embedded', wallet_client_type: 'privy' };
const external = (address: string) => ({ type: 'wallet', chain_type: 'solana', address, connector_type: 'mobile_wallet_protocol', wallet_client_type: 'phantom' });

describe('external wallets', () => {
  it('lists the player’s own Solana wallets, never the embedded one', () => {
    expect(externalSolanaWallets(user([google, embedded, external(EXTERNAL)]))).toEqual([
      { address: EXTERNAL, walletClientType: 'phantom' },
    ]);
  });

  it('counts a Solana wallet as a way to sign in', () => {
    expect(privyLoginMethods(user([google, embedded, external(EXTERNAL)]))).toEqual(['Google', 'Solana wallet']);
    expect(privyLoginMethods(user([email, embedded]))).toEqual(['Email OTP']);
  });
});

describe('unlinking', () => {
  it('is allowed for a linked wallet while Google still signs in', () => {
    expect(unlinkRefusal(user([google, embedded, external(EXTERNAL)]), EXTERNAL, EMBEDDED)).toBeNull();
  });

  it('is refused for the only way to sign in, even with an embedded wallet', () => {
    expect(unlinkRefusal(user([external(EXTERNAL), embedded]), EXTERNAL, EMBEDDED)).toMatch(/only way to sign in/);
  });

  it('is allowed when another wallet still signs in', () => {
    expect(unlinkRefusal(user([external(EXTERNAL), external(OTHER)]), EXTERNAL, OTHER)).toBeNull();
  });

  it('is refused for the wallet that pays', () => {
    expect(unlinkRefusal(user([email, external(EXTERNAL)]), EXTERNAL, EXTERNAL)).toMatch(/pays for your points/);
  });

  it('is refused for the embedded wallet', () => {
    expect(unlinkRefusal(user([email, embedded]), EMBEDDED, null)).toMatch(/connected yourself/);
  });
});
