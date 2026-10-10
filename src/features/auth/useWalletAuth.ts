/**
 * React wiring for src/features/auth/walletAuth.ts: Privy's SIWS hooks and the
 * app's MWA service. One flow at a time per screen (the service also refuses a
 * second wallet session app-wide).
 */
import { useLinkWithSiws, useLoginWithSiws, usePrivy } from '@privy-io/expo';
import { useCallback, useRef, useState } from 'react';

import { usePrivySync } from '@/state/privySync';
import { mwa } from '@/wallet/mwa';
import type { MwaAccount } from '@/wallet/mwaCore';

import { connectWallet, WalletAuthError, type WalletAuthMode } from './walletAuth';

export function useWalletAuth() {
  const { user, refreshUser } = usePrivy();
  const loginFlow = useLoginWithSiws();
  const linkFlow = useLinkWithSiws();
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);

  const connect = useCallback(
    async (mode: WalletAuthMode): Promise<MwaAccount> => {
      if (locked.current) throw new WalletAuthError('Your wallet is already open with a request.', false, 'busy');
      locked.current = true;
      setBusy(true);
      try {
        return await connectWallet(mode, {
          userId: user?.id ?? null,
          signIn: mwa.signIn,
          generateMessage: (flow, args) => (flow === 'link' ? linkFlow.generateMessage(args) : loginFlow.generateMessage(args)),
          login: (proof) => loginFlow.login(proof),
          link: (proof) => linkFlow.link(proof),
          refreshUser,
          resync: () => usePrivySync.getState().retry(),
        });
      } finally {
        locked.current = false;
        setBusy(false);
      }
    },
    [linkFlow, loginFlow, refreshUser, user?.id],
  );

  return { connect, busy };
}
