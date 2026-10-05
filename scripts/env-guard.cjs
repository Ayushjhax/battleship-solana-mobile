/**
 * Refuses to bundle the app when a public variable it reads carries a
 * server-only secret.
 *
 * Expo inlines the value of every EXPO_PUBLIC_* variable the source references
 * straight into the JS bundle, so a server key in one of them ships in every
 * APK. That is exactly what happened to the treasury's private Solana RPC URL,
 * API key included (BUG-009). metro.config.js calls this on every bundle — dev
 * server, `expo export` and the release Gradle build alike — and
 * scripts/check-bundle-secrets.mjs still scans the finished bundle as a
 * second line of defence.
 *
 * CommonJS because metro.config.js is.
 */
const fs = require('node:fs');
const path = require('node:path');

/** Server-only names: the same rule scripts/check-bundle-secrets.mjs applies to the bundle. */
const SERVER_ONLY = /SECRET|SERVICE_ROLE|PASSWORD|TOKEN|PRIVATE_KEY|SOLANA_RPC_URL/i;
const SOURCE_DIRS = ['app', 'src'];

function sourceFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '__tests__' || entry.name === 'node_modules') return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [full] : [];
  });
}

/** Every EXPO_PUBLIC_* name the app's source mentions: the ones Expo inlines. */
function referencedPublicVars(root) {
  const names = new Set();
  for (const dir of SOURCE_DIRS) {
    for (const file of sourceFiles(path.join(root, dir))) {
      for (const match of fs.readFileSync(file, 'utf8').matchAll(/EXPO_PUBLIC_[A-Z0-9_]+/g)) {
        names.add(match[0]);
      }
    }
  }
  return names;
}

/** "<public> carries the value of <secret>" for every leak; empty when clean. */
function publicEnvLeaks(env, referenced) {
  const secrets = Object.entries(env).filter(
    ([name, value]) =>
      !name.startsWith('EXPO_PUBLIC_') &&
      SERVER_ONLY.test(name) &&
      typeof value === 'string' &&
      value.trim().length >= 8,
  );
  const leaks = [];
  for (const name of referenced) {
    const value = env[name];
    if (typeof value !== 'string' || value.trim() === '') continue;
    for (const [secretName, secret] of secrets) {
      if (value.includes(secret.trim())) leaks.push(`${name} carries the value of ${secretName}`);
    }
  }
  return leaks;
}

function assertNoServerSecretsInPublicEnv(root = path.join(__dirname, '..'), env = process.env) {
  const leaks = publicEnvLeaks(env, referencedPublicVars(root));
  if (leaks.length > 0) {
    throw new Error(
      `Refusing to bundle: ${leaks.join('; ')}. Public (EXPO_PUBLIC_*) values are compiled ` +
        'into the app. Give the app its own restricted key instead — for Solana, set ' +
        'EXPO_PUBLIC_SOLANA_APP_RPC_URL to a separate key, never the server SOLANA_RPC_URL.',
    );
  }
}

module.exports = { SERVER_ONLY, referencedPublicVars, publicEnvLeaks, assertNoServerSecretsInPublicEnv };
