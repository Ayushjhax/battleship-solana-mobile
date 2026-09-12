/**
 * Device connectivity gate. Checking this never opens a socket or HTTP
 * request. The demo menu's hard offline toggle (src/state/demo.ts) overrides
 * the answer to "no" and reports "offline" to subscribers.
 */
import * as Network from 'expo-network';

import { isForcedOffline, useDemo } from '@/state/demo';

export function isReachable(state: Network.NetworkState): boolean {
  return state.isConnected === true && state.isInternetReachable !== false;
}

export async function hasInternet(): Promise<boolean> {
  if (isForcedOffline()) return false;
  try {
    return isReachable(await Network.getNetworkStateAsync());
  } catch {
    return false;
  }
}

export function subscribeConnectivity(listener: (online: boolean) => void): () => void {
  const subscription = Network.addNetworkStateListener((state) =>
    listener(!isForcedOffline() && isReachable(state)),
  );
  const demo = useDemo.subscribe((next, prev) => {
    if (next.forceOffline !== prev.forceOffline) {
      if (next.forceOffline) listener(false);
      else void hasInternet().then(listener);
    }
  });
  return () => {
    subscription.remove();
    demo();
  };
}
