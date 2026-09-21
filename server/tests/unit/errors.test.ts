import { describe, expect, it } from 'vitest';

import { AuthFailure, detailOf, isAuthFailure, type AuthFailureCode } from '../../src/errors';

const ALL_CODES: AuthFailureCode[] = [
  'privy_token_invalid',
  'privy_not_configured',
  'identity_provider_unavailable',
  'profile_conflict',
  'supabase_admin_failed',
  'session_handoff_failed',
  'database_unavailable',
];

describe('AuthFailure', () => {
  it('maps only a genuinely bad credential to 401', () => {
    const unauthorized = ALL_CODES.filter((code) => new AuthFailure(code).status === 401);

    expect(unauthorized).toEqual(['privy_token_invalid']);
  });

  it('reports server-side breakage as 5xx so the player is not blamed', () => {
    for (const code of ALL_CODES) {
      const failure = new AuthFailure(code);
      if (code === 'privy_token_invalid') continue;
      if (code === 'profile_conflict') {
        expect(failure.status).toBe(409);
        continue;
      }
      expect(failure.status).toBeGreaterThanOrEqual(500);
    }
  });

  it('gives every code a distinct, non-empty public message', () => {
    const messages = ALL_CODES.map((code) => new AuthFailure(code).publicMessage);

    expect(new Set(messages).size).toBe(ALL_CODES.length);
    expect(messages.every((message) => message.trim().length > 0)).toBe(true);
  });

  it('never leaks the internal detail into the public message', () => {
    const failure = new AuthFailure('session_handoff_failed', 'secret-key-abc123 was rejected');

    expect(failure.message).toContain('secret-key-abc123');
    expect(failure.publicMessage).not.toContain('secret-key-abc123');
  });

  it('preserves the cause for logging', () => {
    const cause = new Error('underlying');
    const failure = new AuthFailure('supabase_admin_failed', 'wrapped', { cause });

    expect(failure.cause).toBe(cause);
  });

  it('is recognisable through isAuthFailure and instanceof', () => {
    const failure = new AuthFailure('database_unavailable');

    expect(isAuthFailure(failure)).toBe(true);
    expect(failure instanceof Error).toBe(true);
    expect(isAuthFailure(new Error('plain'))).toBe(false);
    expect(isAuthFailure(null)).toBe(false);
    expect(isAuthFailure('privy_token_invalid')).toBe(false);
  });
});

describe('detailOf', () => {
  it('reads Error messages, passes strings through, and names the unknown', () => {
    expect(detailOf(new Error('boom'))).toBe('boom');
    expect(detailOf('plain string')).toBe('plain string');
    expect(detailOf({ weird: true })).toBe('unknown error');
    expect(detailOf(undefined)).toBe('unknown error');
  });
});
