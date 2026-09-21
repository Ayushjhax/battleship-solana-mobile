/**
 * bootstrapPrivySession is the step that actually failed in production: Privy
 * had already verified the player, and everything after that point is the
 * server's own Supabase work. Each failure branch must carry a code that says
 * so, because the route can no longer infer it from the message text.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TrustedPrivyAccount } from '../../src/privy';
import { makeFakeSupabase, type FakeSupabaseOptions } from '../helpers/fakeSupabase';

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  upsertPrivyAccount: vi.fn(),
}));

vi.mock('../../src/db', () => ({
  db: mocks.db,
  upsertPrivyAccount: mocks.upsertPrivyAccount,
}));

const ACCOUNT: TrustedPrivyAccount = {
  privyUserId: 'did:privy:captain',
  email: 'captain@example.test',
  displayName: 'Captain',
  authProvider: 'google',
  solanaWalletAddress: null,
  solanaWalletId: null,
  linkedAccounts: [],
  privyCreatedAt: '2026-01-01T00:00:00.000Z',
};

async function bootstrapWith(options: FakeSupabaseOptions) {
  const fake = makeFakeSupabase(options);
  mocks.db.mockReturnValue(fake.client);
  const { bootstrapPrivySession } = await import('../../src/privySession');
  const { AuthFailure } = await import('../../src/errors');
  return { fake, bootstrapPrivySession, AuthFailure };
}

/** The deterministic profile id this Privy DID always maps to. */
async function expectedProfileId() {
  const { profileIdForPrivyUser } = await import('../../src/privySession');
  return profileIdForPrivyUser(ACCOUNT.privyUserId);
}

beforeEach(() => {
  vi.resetModules();
  mocks.db.mockReset();
  mocks.upsertPrivyAccount.mockReset();
  mocks.upsertPrivyAccount.mockResolvedValue({ pointBalance: 100, welcomeAwarded: true });
});

describe('bootstrapPrivySession — happy path', () => {
  it('creates the auth user and returns a magiclink handoff', async () => {
    const profileId = await expectedProfileId();
    const { fake, bootstrapPrivySession } = await bootstrapWith({
      generateLinkUserId: profileId,
    });

    const result = await bootstrapPrivySession(ACCOUNT);

    expect(result.profileId).toBe(profileId);
    expect(result.handoff).toEqual({ tokenHash: 'h'.repeat(48), type: 'magiclink' });
    expect(fake.calls.createUser).toBe(1);
  });

  it('reuses an existing mapped profile instead of deriving a new one', async () => {
    const mapped = '22222222-2222-4222-8222-222222222222';
    const { bootstrapPrivySession } = await bootstrapWith({
      mappedProfileId: mapped,
      authUsers: { [mapped]: { id: mapped, email: 'x@users.invalid' } },
      generateLinkUserId: mapped,
    });

    const result = await bootstrapPrivySession(ACCOUNT);

    expect(result.profileId).toBe(mapped);
  });

  it('does not recreate an auth user that already exists', async () => {
    const profileId = await expectedProfileId();
    const { authEmailForPrivyUser } = await import('../../src/privySession');
    const { fake, bootstrapPrivySession } = await bootstrapWith({
      authUsers: {
        [profileId]: {
          id: profileId,
          email: authEmailForPrivyUser(ACCOUNT.privyUserId),
          app_metadata: { privy_user_id: ACCOUNT.privyUserId },
        },
      },
      generateLinkUserId: profileId,
    });

    await bootstrapPrivySession(ACCOUNT);

    expect(fake.calls.createUser).toBe(0);
    expect(fake.calls.updateUser).toBe(0);
  });
});

describe('bootstrapPrivySession — failures are never blamed on the token', () => {
  it('codes a missing hashed_token as session_handoff_failed', async () => {
    // This is the literal production bug: the old message read
    // "... handoff failed: no token" and the route saw the word "token".
    const { bootstrapPrivySession, AuthFailure } = await bootstrapWith({ hashedToken: null });

    const error = await bootstrapPrivySession(ACCOUNT).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AuthFailure);
    expect((error as InstanceType<typeof AuthFailure>).code).toBe('session_handoff_failed');
    expect((error as InstanceType<typeof AuthFailure>).status).toBe(503);
    expect((error as InstanceType<typeof AuthFailure>).publicMessage).not.toMatch(/Privy/);
  });

  it('codes a generateLink error as session_handoff_failed', async () => {
    const { bootstrapPrivySession, AuthFailure } = await bootstrapWith({
      generateLinkError: { message: 'Signups not allowed for this instance' },
    });

    const error = await bootstrapPrivySession(ACCOUNT).catch((caught: unknown) => caught);

    expect((error as InstanceType<typeof AuthFailure>).code).toBe('session_handoff_failed');
    expect((error as Error).message).toContain('Signups not allowed');
  });

  it('codes a thrown generateLink as session_handoff_failed rather than crashing', async () => {
    const { bootstrapPrivySession, AuthFailure } = await bootstrapWith({
      generateLinkThrows: new Error('socket hang up'),
    });

    const error = await bootstrapPrivySession(ACCOUNT).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AuthFailure);
    expect((error as InstanceType<typeof AuthFailure>).code).toBe('session_handoff_failed');
    expect((error as Error).message).toContain('socket hang up');
  });

  it('codes a link resolving to the wrong profile as session_handoff_failed', async () => {
    const { bootstrapPrivySession, AuthFailure } = await bootstrapWith({
      generateLinkUserId: '99999999-9999-4999-8999-999999999999',
    });

    const error = await bootstrapPrivySession(ACCOUNT).catch((caught: unknown) => caught);

    expect((error as InstanceType<typeof AuthFailure>).code).toBe('session_handoff_failed');
  });

  it('codes a refused createUser as supabase_admin_failed', async () => {
    // What a key without service-role rights returns.
    const { bootstrapPrivySession, AuthFailure } = await bootstrapWith({
      createUserError: { message: 'User not allowed' },
    });

    const error = await bootstrapPrivySession(ACCOUNT).catch((caught: unknown) => caught);

    expect((error as InstanceType<typeof AuthFailure>).code).toBe('supabase_admin_failed');
    expect((error as InstanceType<typeof AuthFailure>).status).toBe(503);
  });

  it('codes a failing auth lookup as supabase_admin_failed', async () => {
    const { bootstrapPrivySession, AuthFailure } = await bootstrapWith({
      getUserByIdError: { message: 'invalid authentication token', status: 401 },
    });

    const error = await bootstrapPrivySession(ACCOUNT).catch((caught: unknown) => caught);

    // Contains "authentication" and "token" — the old regex called this a bad
    // player credential and answered 401.
    expect((error as InstanceType<typeof AuthFailure>).code).toBe('supabase_admin_failed');
    expect((error as InstanceType<typeof AuthFailure>).status).not.toBe(401);
  });

  it('codes a failing privy_accounts lookup as database_unavailable', async () => {
    const { bootstrapPrivySession, AuthFailure } = await bootstrapWith({
      mappedProfileError: { message: 'JWT expired' },
    });

    const error = await bootstrapPrivySession(ACCOUNT).catch((caught: unknown) => caught);

    expect((error as InstanceType<typeof AuthFailure>).code).toBe('database_unavailable');
  });

  it('codes a profile owned by another Privy identity as profile_conflict (409)', async () => {
    const profileId = await expectedProfileId();
    const { bootstrapPrivySession, AuthFailure } = await bootstrapWith({
      authUsers: {
        [profileId]: {
          id: profileId,
          email: 'someone@users.invalid',
          app_metadata: { privy_user_id: 'did:privy:someone-else' },
        },
      },
    });

    const error = await bootstrapPrivySession(ACCOUNT).catch((caught: unknown) => caught);

    expect((error as InstanceType<typeof AuthFailure>).code).toBe('profile_conflict');
    expect((error as InstanceType<typeof AuthFailure>).status).toBe(409);
  });

  it('tolerates a racing create by reusing the winner', async () => {
    const profileId = await expectedProfileId();
    const fake = makeFakeSupabase({ generateLinkUserId: profileId });
    // First getUserById: absent. createUser: refused. Second lookup: present.
    let lookups = 0;
    const client = fake.client as {
      auth: { admin: Record<string, (...args: never[]) => unknown> };
    };
    client.auth.admin.getUserById = async () => {
      lookups += 1;
      return lookups === 1
        ? { data: { user: null }, error: { message: 'User not found', status: 404 } }
        : {
            data: { user: { id: profileId, email: 'x@users.invalid' } },
            error: null,
          };
    };
    client.auth.admin.createUser = async () => ({
      data: { user: null },
      error: { message: 'duplicate key value violates unique constraint' },
    });
    mocks.db.mockReturnValue(fake.client);
    const { bootstrapPrivySession } = await import('../../src/privySession');

    await expect(bootstrapPrivySession(ACCOUNT)).resolves.toMatchObject({ profileId });
  });
});
