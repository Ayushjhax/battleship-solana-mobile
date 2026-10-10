/**
 * The app's one Mobile Wallet Adapter service (src/wallet/mwaCore.ts), bound to
 * the platform: the transport is Android-only (mwaTransport.android.ts), the
 * wallet's auth token lives in the OS keystore via expo-secure-store, and the
 * chain is the app's cluster — solana:mainnet for mainnet-beta.
 */
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';

import { createMwaService, mwaChainFor } from './mwaCore';
import { mwaPlatformSupported, transact } from './mwaTransport';
import { solanaConfig } from './solana';

export const mwaSupported = mwaPlatformSupported;

const AUTHORIZATION_KEY = 'eob.mwa.authorization.v1';
const STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const mwa = createMwaService({
  transact,
  read: () => SecureStore.getItemAsync(AUTHORIZATION_KEY, STORE_OPTIONS),
  write: (value) => SecureStore.setItemAsync(AUTHORIZATION_KEY, value, STORE_OPTIONS),
  remove: () => SecureStore.deleteItemAsync(AUTHORIZATION_KEY, STORE_OPTIONS),
  now: Date.now,
  isForeground: () => AppState.currentState === 'active',
  chain: mwaChainFor(solanaConfig().cluster),
});
