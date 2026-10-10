/**
 * Every platform but Android (Metro picks mwaTransport.android.ts there): no
 * Mobile Wallet Adapter. Solana Mobile's wallets connect only on Android, so
 * this never touches the native package — iOS starts and signs in with Google
 * and email exactly as before.
 */
import { MwaError, type MwaTransact } from './mwaCore';

export const mwaPlatformSupported = false;

export const transact: MwaTransact = async () => {
  throw new MwaError('unsupported', 'Connecting a Solana wallet app needs the Android version of the game. Google and email sign-in work here.');
};
