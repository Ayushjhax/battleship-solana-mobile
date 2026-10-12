/**
 * BUG-009: the app's RPC URL was the server's private one, API key included.
 * Expo inlines every EXPO_PUBLIC_* value the source reads, so the key shipped
 * in every APK — and eas.json had it committed for the release profiles.
 * scripts/env-guard.cjs makes Metro refuse to bundle when a public variable
 * the app reads carries a server-only secret.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const require = createRequire(import.meta.url);

interface EnvGuard {
  referencedPublicVars(root: string): Set<string>;
  publicEnvLeaks(env: Record<string, string | undefined>, referenced: Iterable<string>): string[];
  assertNoServerSecretsInPublicEnv(root: string, env: Record<string, string | undefined>): void;
}

function guard(): EnvGuard {
  return require(join(ROOT, 'scripts', 'env-guard.cjs')) as EnvGuard;
}

const SERVER_RPC = 'https://mainnet.rpc.example.test/?api-key=server-only-0000';

describe('the public env guard', () => {
  it('catches a public variable the app reads that carries the server RPC key', () => {
    const leaks = guard().publicEnvLeaks(
      { SOLANA_RPC_URL: SERVER_RPC, EXPO_PUBLIC_SOLANA_APP_RPC_URL: SERVER_RPC },
      ['EXPO_PUBLIC_SOLANA_APP_RPC_URL'],
    );
    expect(leaks).toEqual(['EXPO_PUBLIC_SOLANA_APP_RPC_URL carries the value of SOLANA_RPC_URL']);
  });

  it('catches any server secret, not just the RPC key', () => {
    const leaks = guard().publicEnvLeaks(
      { SUPABASE_SECRET_KEY: 'sb_secret_abcdefghijklmnop', EXPO_PUBLIC_API_URL: 'https://x?k=sb_secret_abcdefghijklmnop' },
      ['EXPO_PUBLIC_API_URL'],
    );
    expect(leaks).toHaveLength(1);
  });

  it('passes a separate app key, and ignores variables the app never reads', () => {
    const leaks = guard().publicEnvLeaks(
      {
        SOLANA_RPC_URL: SERVER_RPC,
        EXPO_PUBLIC_SOLANA_APP_RPC_URL: 'https://mainnet.rpc.example.test/?api-key=app-restricted',
        EXPO_PUBLIC_SOLANA_RPC_URL: SERVER_RPC,
      },
      ['EXPO_PUBLIC_SOLANA_APP_RPC_URL'],
    );
    expect(leaks).toEqual([]);
  });

  it('knows which public variables the app reads', () => {
    const referenced = guard().referencedPublicVars(ROOT);
    expect(referenced.has('EXPO_PUBLIC_SOLANA_APP_RPC_URL')).toBe(true);
    expect(referenced.has('EXPO_PUBLIC_SUPABASE_URL')).toBe(true);
    expect(referenced.has('EXPO_PUBLIC_SOLANA_RPC_URL')).toBe(false);
  });

  it('runs whenever Metro bundles', () => {
    const metro = readFileSync(join(ROOT, 'metro.config.js'), 'utf8');
    expect(metro).toMatch(/assertNoServerSecretsInPublicEnv\(/);
  });

  it('eas.json bakes no key-bearing RPC URL into a build', () => {
    const eas = JSON.parse(readFileSync(join(ROOT, 'eas.json'), 'utf8')) as {
      build: Record<string, { env?: Record<string, string> }>;
    };
    const offenders = Object.entries(eas.build).flatMap(([profile, config]) =>
      Object.entries(config.env ?? {})
        .filter(([key, value]) => key.startsWith('EXPO_PUBLIC_') && /api[-_]?key=|SOLANA_RPC_URL/i.test(`${key}=${value}`))
        .map(([key]) => `${profile}.${key}`),
    );
    expect(offenders).toEqual([]);
  });

  /**
   * The server's key lives in server/.env, which Expo never loads — so the
   * guard above could not see an app .env.local that repeated it, and the
   * server's Helius key shipped in the 2026-10-06 and -10 APKs.
   */
  describe('against the match server’s own env file', () => {
    function project(serverEnv: string | null): string {
      const root = mkdtempSync(join(tmpdir(), 'eob-env-guard-'));
      mkdirSync(join(root, 'src'));
      writeFileSync(join(root, 'src', 'rpc.ts'), 'export const url = process.env.EXPO_PUBLIC_SOLANA_APP_RPC_URL;\n');
      if (serverEnv !== null) {
        mkdirSync(join(root, 'server'));
        writeFileSync(join(root, 'server', '.env'), serverEnv);
      }
      return root;
    }

    it('refuses to bundle an app RPC URL that is the server’s', () => {
      const root = project(`PORT=8080\nSOLANA_RPC_URL="${SERVER_RPC}"\n`);
      try {
        expect(() => guard().assertNoServerSecretsInPublicEnv(root, { EXPO_PUBLIC_SOLANA_APP_RPC_URL: SERVER_RPC })).toThrow(
          /EXPO_PUBLIC_SOLANA_APP_RPC_URL carries the value of server\/\.env SOLANA_RPC_URL/,
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('bundles an app key of its own', () => {
      const root = project(`SOLANA_RPC_URL=${SERVER_RPC}\n`);
      try {
        expect(() =>
          guard().assertNoServerSecretsInPublicEnv(root, {
            EXPO_PUBLIC_SOLANA_APP_RPC_URL: 'https://mainnet.rpc.example.test/?api-key=app-restricted',
          }),
        ).not.toThrow();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('bundles where there is no server checkout (EAS)', () => {
      const root = project(null);
      try {
        expect(() => guard().assertNoServerSecretsInPublicEnv(root, { EXPO_PUBLIC_SOLANA_APP_RPC_URL: SERVER_RPC })).not.toThrow();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  });
});
