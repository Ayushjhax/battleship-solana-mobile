/**
 * Regression: the Solana dApp Store rejected 1.0.0 (PER-001, "permissions do
 * not align with app function") for SYSTEM_ALERT_WINDOW, READ/WRITE_EXTERNAL_STORAGE,
 * USE_BIOMETRIC and USE_FINGERPRINT.
 *
 * None is used. The first three are Expo's default Android template; the last
 * two ride in with androidx.biometric, which expo-secure-store links for its
 * optional `requireAuthentication` — and nothing here, Privy included, ever
 * sets that. `blockedPermissions` makes prebuild write each as
 * `tools:node="remove"`, which the manifest merger honours even for a
 * library's declaration, so they stay out however they arrive.
 *
 * Adding a permission back is a product decision that the store reviews: take
 * it out of BLOCKED here, and say why in the submission.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const app = JSON.parse(readFileSync(join(__dirname, '..', '..', 'app.json'), 'utf8')) as {
  expo: { android: { permissions?: string[]; blockedPermissions?: string[]; versionCode: number } };
};
const android = app.expo.android;

const BLOCKED = [
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.USE_BIOMETRIC',
  'android.permission.USE_FINGERPRINT',
];

describe('Android permissions stay within what the game uses', () => {
  it.each(BLOCKED)('%s is blocked from the final manifest', (permission) => {
    expect(android.blockedPermissions ?? []).toContain(permission);
  });

  it('none of them is also requested', () => {
    for (const permission of BLOCKED) expect(android.permissions ?? []).not.toContain(permission);
  });

  it('the store resubmission carries a higher version code than the rejected 1', () => {
    expect(android.versionCode).toBeGreaterThan(1);
  });
});
