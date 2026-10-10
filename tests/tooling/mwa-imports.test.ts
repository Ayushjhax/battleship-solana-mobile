/**
 * The Mobile Wallet Adapter package loads its native module the moment it is
 * imported (`TurboModuleRegistry.getEnforcing("SolanaMobileWalletAdapter")`),
 * and that module exists only on Android. A static import anywhere iOS loads
 * would crash the app at startup — Google and email sign-in included. So the
 * package may only be imported from an Android-only file (`*.android.ts(x)`,
 * which Metro never bundles for iOS); `import type` is erased and is fine.
 * Everything else reaches it through src/wallet/mwaTransport, whose
 * non-Android twin refuses politely.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createMwaService } from '../../src/wallet/mwaCore';
import { mwaPlatformSupported, transact } from '../../src/wallet/mwaTransport';

const ROOT = join(__dirname, '..', '..');
const PACKAGE = /['"]@solana-mobile\/mobile-wallet-adapter-protocol[^'"]*['"]/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (name === 'node_modules' || name === '__tests__') return [];
    if (statSync(full).isDirectory()) return sources(full);
    return /\.(ts|tsx|js|jsx)$/.test(name) ? [full] : [];
  });
}

/** Lines that load the package at runtime: imports, re-exports and requires — not `import type`. */
function runtimeReferences(text: string): string[] {
  return text
    .split('\n')
    .filter((line) => PACKAGE.test(line))
    .filter((line) => !/^\s*import\s+type\b/.test(line) && !/typeof\s+import\(/.test(line) && !/^\s*(\/\/|\*)/.test(line));
}

describe('Mobile Wallet Adapter imports', () => {
  it('load the package only from Android-only files', () => {
    const offenders = ['app', 'src']
      .flatMap((dir) => sources(join(ROOT, dir)))
      .filter((file) => !/\.android\.(ts|tsx|js|jsx)$/.test(file))
      .filter((file) => runtimeReferences(readFileSync(file, 'utf8')).length > 0)
      .map((file) => relative(ROOT, file));
    expect(offenders).toEqual([]);
  });

  it('the Android transport requires the package on first use, not at startup', () => {
    const text = readFileSync(join(ROOT, 'src/wallet/mwaTransport.android.ts'), 'utf8');
    expect(text).not.toMatch(/^import\s+(?!type)[^\n]*mobile-wallet-adapter/m);
    expect(text).toMatch(/require\('@solana-mobile\/mobile-wallet-adapter-protocol-web3js'\)/);
  });
});

describe('on a platform without Mobile Wallet Adapter (iOS)', () => {
  it('the transport says so instead of loading anything', async () => {
    expect(mwaPlatformSupported).toBe(false);
    await expect(transact(async () => 'never')).rejects.toMatchObject({ kind: 'unsupported' });
  });

  it('a wallet sign-in fails with words for the player, and Privy is never asked', async () => {
    const service = createMwaService({
      transact,
      read: async () => null,
      write: async () => undefined,
      remove: async () => undefined,
      now: Date.now,
      isForeground: () => true,
      chain: 'solana:mainnet',
    });
    let asked = false;
    const failure = await service
      .signIn({
        userId: null,
        createMessage: async () => {
          asked = true;
          return '';
        },
        complete: async () => ({ id: 'x' }),
      })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ kind: 'unsupported' });
    expect((failure as Error).message).toMatch(/Android/);
    expect(asked).toBe(false);
    expect(service.isBusy()).toBe(false);
  });
});
