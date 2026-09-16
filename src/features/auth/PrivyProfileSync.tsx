import { useEmbeddedSolanaWallet, usePrivy } from '@privy-io/expo';
import { useEffect, useRef } from 'react';

import { subscribeConnectivity } from '@/net/connectivity';
import { cloudAsLocal, pullCloudProfile, shouldRestoreCloudProfile } from '@/net/profileSync';
import { syncPrivyAccount } from '@/net/privySync';
import { useCloud } from '@/state/cloud';
import { usePrivySync } from '@/state/privySync';
import { usePoints } from '@/state/points';
import { useProfile } from '@/state/profile';

export function PrivyProfileSync() {
  const { user, getAccessToken } = usePrivy();
  const walletState = useEmbeddedSolanaWallet();
  const retryNonce = usePrivySync((state) => state.retryNonce);
  const lastCompletedKey = useRef('');
  const walletAddress = walletState.wallets?.[0]?.address ?? '';

  useEffect(
    () =>
      subscribeConnectivity((online) => {
        const state = usePrivySync.getState();
        if (online && state.status === 'error') state.retry();
      }),
    [],
  );

  useEffect(() => {
    if (!user) return;
    const key = `${user.id}:${walletAddress}:${retryNonce}`;
    if (lastCompletedKey.current === key) return;
    let cancelled = false;

    void (async () => {
      usePrivySync.getState().start();
      try {
        const token = await getAccessToken();
        if (!token) throw new Error('Privy session expired. Please sign in again.');
        const account = await syncPrivyAccount(token);
        if (cancelled) return;
        // The gameplay session installed above is what makes this row readable,
        // so the pull has to happen here rather than back on the boot screen.
        const cloudProfile = await pullCloudProfile(account.profileId);
        if (cancelled) return;
        lastCompletedKey.current = key;
        useProfile.getState().setUserId(account.profileId);
        useCloud.getState().setProfile(cloudProfile);
        // A returning Privy identity replaces the prior device account's cached
        // captain details; a brand-new one keeps the cleared local profile so
        // onboarding can collect its name and avatar. See the rule's comment.
        if (shouldRestoreCloudProfile(cloudProfile, account.welcomeAwarded)) {
          useProfile.getState().mergeRemote(cloudAsLocal(cloudProfile));
        }
        usePrivySync.getState().succeed(account);
        usePoints.getState().sync(account.pointBalance, account.welcomeAwarded);
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Account sync failed';
          usePrivySync.getState().fail(message);
          usePoints.getState().fail(message);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getAccessToken, retryNonce, user, walletAddress]);

  return null;
}
