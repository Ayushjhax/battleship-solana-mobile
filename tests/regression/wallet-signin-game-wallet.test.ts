/**
 * Signing in with a Solana wallet (Seeker / Mobile Wallet Adapter) left the
 * player without a game wallet: Privy's `createOnLogin: 'users-without-wallets'`
 * counted the external wallet as "has a wallet", so the player had to open the
 * wallet screen and press Create before playing. Every sign-in now gets one —
 * Privy creates it ('all-users') and EnsureGameWallet covers older sessions —
 * and the screen has no Create button.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');

describe('the game wallet after a wallet sign-in', () => {
  it('is created by Privy for every sign-in, not only those without a wallet', () => {
    const layout = read('app/_layout.tsx');
    expect(layout).toMatch(/createOnLogin:\s*'all-users'/);
    expect(layout).not.toMatch(/users-without-wallets'\s*}/);
  });

  it('is created for accounts that signed in before, without a second wallet', () => {
    expect(read('app/_layout.tsx')).toMatch(/<EnsureGameWallet \/>/);
    const ensure = read('src/features/auth/EnsureGameWallet.tsx');
    expect(ensure).toMatch(/status !== 'not-created'/);
    expect(ensure).not.toMatch(/createAdditional:\s*true/);
  });

  it('never asks the player to press Create', () => {
    expect(read('app/wallet.tsx')).not.toMatch(/label="Create wallet"/);
  });
});
