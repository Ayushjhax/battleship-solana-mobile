import type { User } from '@privy-io/node';
import { describe, expect, it } from 'vitest';

import { normalizePrivyUser } from '../privy';

describe('Privy user normalization', () => {
  it('prefers Google identity and selects only the embedded Solana wallet', () => {
    const user = {
      id: 'did:privy:captain',
      created_at: 1_700_000_000,
      has_accepted_terms: true,
      is_guest: false,
      mfa_methods: [],
      linked_accounts: [
        { type: 'email', address: 'otp@example.com', verified_at: 1 },
        {
          type: 'google_oauth',
          email: 'captain@gmail.com',
          name: 'Captain Ada',
          subject: 'google-1',
          verified_at: 1,
        },
        {
          type: 'wallet',
          id: 'wallet-1',
          address: 'SolanaAddress',
          chain_type: 'solana',
          connector_type: 'embedded',
          wallet_client: 'privy',
          verified_at: 1,
        },
        {
          type: 'wallet',
          id: 'wallet-2',
          address: 'EthereumAddress',
          chain_type: 'ethereum',
          connector_type: 'embedded',
          wallet_client: 'privy',
          verified_at: 1,
        },
      ],
    } as unknown as User;

    expect(normalizePrivyUser(user)).toMatchObject({
      privyUserId: 'did:privy:captain',
      email: 'captain@gmail.com',
      displayName: 'Captain Ada',
      authProvider: 'google',
      solanaWalletAddress: 'SolanaAddress',
      solanaWalletId: 'wallet-1',
    });
  });
});
