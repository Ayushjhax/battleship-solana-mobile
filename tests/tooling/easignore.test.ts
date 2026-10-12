/**
 * When .easignore exists, EAS CLI uses it INSTEAD of .gitignore (Expo docs:
 * "include all files and directories from your .gitignore file"). Ours listed
 * only .git, node_modules, android and server, so the September `eas build`
 * uploads carried .env.backup.local — the treasury's private key and the
 * Supabase, Privy and server RPC secrets — to Expo's build servers.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');

function patterns(file: string): string[] {
  return readFileSync(join(ROOT, file), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

describe('.easignore', () => {
  const easignore = patterns('.easignore');

  it('keeps out everything .gitignore keeps out', () => {
    const missing = patterns('.gitignore').filter(
      // `.env*` already covers every env-file pattern.
      (pattern) => !easignore.includes(pattern) && !(/^\.env/.test(pattern) && easignore.includes('.env*')),
    );
    expect(missing).toEqual([]);
  });

  it('never uploads an env file, a keystore or the server', () => {
    expect(easignore).toEqual(expect.arrayContaining(['.env*', 'server/.env', 'server/', '*.jks', '*.keystore']));
  });
});
