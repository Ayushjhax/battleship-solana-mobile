/**
 * Android: the Mobile Wallet Adapter's `transact`. The package loads its native
 * module the moment it is imported, so it is required on first use, not at
 * startup — a build without the module (an older development client) still
 * starts, signs in with Google and email, and says why the wallet is missing.
 */
import { MwaError, type MwaTransact } from './mwaCore';

type Web3Transact = typeof import('@solana-mobile/mobile-wallet-adapter-protocol-web3js').transact;

let loaded: Web3Transact | null = null;

function load(): Web3Transact {
  if (loaded) return loaded;
  try {
    loaded = (
      require('@solana-mobile/mobile-wallet-adapter-protocol-web3js') as typeof import('@solana-mobile/mobile-wallet-adapter-protocol-web3js')
    ).transact;
    return loaded;
  } catch {
    throw new MwaError('unsupported', 'This build of the game cannot connect to wallet apps. Update the app to connect your Solana wallet.');
  }
}

export const mwaPlatformSupported = true;

export const transact: MwaTransact = async (run, baseUri) => load()(run, baseUri ? { baseUri } : undefined);
