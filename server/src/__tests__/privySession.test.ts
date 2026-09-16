import { describe, expect, it } from 'vitest';

import { authEmailForPrivyUser, profileIdForPrivyUser } from '../privySession';

describe('Privy gameplay identity', () => {
  it('derives a stable, valid Supabase auth identity from the Privy DID', () => {
    const first = profileIdForPrivyUser('did:privy:captain');
    const second = profileIdForPrivyUser('did:privy:captain');

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(authEmailForPrivyUser('did:privy:captain')).toMatch(
      /^privy-[0-9a-f]{40}@users\.invalid$/,
    );
  });

  it('keeps different Privy identities separate', () => {
    expect(profileIdForPrivyUser('did:privy:one')).not.toBe(
      profileIdForPrivyUser('did:privy:two'),
    );
  });
});
