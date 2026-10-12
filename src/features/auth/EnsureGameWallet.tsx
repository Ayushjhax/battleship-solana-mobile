/**
 * Every signed-in player has a game wallet (the Privy embedded Solana wallet)
 * without asking for one. Privy creates it at sign-in (`createOnLogin:
 * 'all-users'` in app/_layout.tsx) — for Google, email and Solana wallet
 * sign-ins alike; before, a wallet sign-in already counted as "has a wallet"
 * and got none, so the player had to find a Create button. This covers the
 * accounts that signed in that way before the change, and any sign-in whose
 * creation did not happen: once Privy settles on 'not-created', it creates
 * the wallet. Privy's `create()` never makes a second one (no
 * `createAdditional`), so a race with Privy's own creation is harmless.
 */
import { useEmbeddedSolanaWallet, usePrivy } from '@privy-io/expo';
import { useEffect, useRef } from 'react';

/** Privy's own creation at sign-in usually lands first; give it this long. */
const SETTLE_MS = 1500;
const MAX_ATTEMPTS = 3;

export function EnsureGameWallet() {
  const { user } = usePrivy();
  const walletState = useEmbeddedSolanaWallet();
  const attempts = useRef<{ userId: string; count: number } | null>(null);
  const userId = user?.id ?? null;
  const status = walletState.status;
  const create = walletState.status === 'not-created' ? walletState.create : undefined;

  useEffect(() => {
    if (!userId || status !== 'not-created' || !create) return;
    if (attempts.current?.userId !== userId) attempts.current = { userId, count: 0 };
    const tried = attempts.current;
    if (tried.count >= MAX_ATTEMPTS) return;
    const timer = setTimeout(() => {
      tried.count += 1;
      create().catch((error: unknown) => {
        // Status goes to 'error' and back; the next 'not-created' tries again.
        console.warn('[wallet] game wallet creation failed:', error instanceof Error ? error.message : error);
      });
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [create, status, userId]);

  return null;
}
