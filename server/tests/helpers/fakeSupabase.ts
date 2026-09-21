/**
 * A hand-rolled stand-in for the Supabase client, covering only the surface the
 * server actually touches. Real `@supabase/supabase-js` would need a live
 * project; the point of these tests is the failure branches, which a live
 * project will not reproduce on demand.
 *
 * Supabase reports errors in the result object rather than by throwing, so
 * every seam here takes `{ data, error }` exactly as the SDK returns it.
 */

export interface SupabaseError {
  message: string;
  status?: number;
  code?: string;
}

export interface SupabaseResult<T> {
  data: T;
  error: SupabaseError | null;
}

export function ok<T>(data: T): SupabaseResult<T> {
  return { data, error: null };
}

export function err<T>(message: string, extra: Partial<SupabaseError> = {}): SupabaseResult<T> {
  return { data: null as T, error: { message, ...extra } };
}

export interface AuthUser {
  id: string;
  email: string | null;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}

export interface FakeSupabaseOptions {
  /** Rows behind `.from('privy_accounts').select('profile_id')`. */
  mappedProfileId?: string | null;
  mappedProfileError?: SupabaseError | null;
  /** Users already present in Supabase Auth, keyed by id. */
  authUsers?: Record<string, AuthUser>;
  getUserByIdError?: SupabaseError | null;
  createUserError?: SupabaseError | null;
  updateUserError?: SupabaseError | null;
  listUsersError?: SupabaseError | null;
  /** generateLink outcomes. */
  hashedToken?: string | null;
  generateLinkError?: SupabaseError | null;
  generateLinkThrows?: Error | null;
  /** Overrides the id generateLink claims the link belongs to. */
  generateLinkUserId?: string;
}

export interface FakeSupabase {
  client: unknown;
  calls: {
    createUser: number;
    updateUser: number;
    getUserById: number;
    generateLink: number;
    listUsers: number;
  };
}

export function makeFakeSupabase(options: FakeSupabaseOptions = {}): FakeSupabase {
  const {
    mappedProfileId = null,
    mappedProfileError = null,
    authUsers = {},
    getUserByIdError = null,
    createUserError = null,
    updateUserError = null,
    listUsersError = null,
    hashedToken = 'h'.repeat(48),
    generateLinkError = null,
    generateLinkThrows = null,
    generateLinkUserId,
  } = options;

  const users: Record<string, AuthUser> = { ...authUsers };
  const calls = {
    createUser: 0,
    updateUser: 0,
    getUserById: 0,
    generateLink: 0,
    listUsers: 0,
  };

  // `.from(...).select(...).eq(...).order(...).limit(...).maybeSingle()` is a
  // fluent chain; each step returns the same thenable builder.
  const selectBuilder = {
    select: () => selectBuilder,
    eq: () => selectBuilder,
    order: () => selectBuilder,
    limit: () => selectBuilder,
    maybeSingle: async () =>
      mappedProfileError
        ? { data: null, error: mappedProfileError }
        : { data: mappedProfileId ? { profile_id: mappedProfileId } : null, error: null },
  };

  const client = {
    from: () => selectBuilder,
    auth: {
      admin: {
        getUserById: async (id: string) => {
          calls.getUserById += 1;
          if (getUserByIdError) return { data: { user: null }, error: getUserByIdError };
          const user = users[id];
          return user
            ? { data: { user }, error: null }
            : { data: { user: null }, error: { message: 'User not found', status: 404 } };
        },
        createUser: async (attrs: { id: string; email: string }) => {
          calls.createUser += 1;
          if (createUserError) return { data: { user: null }, error: createUserError };
          const user: AuthUser = { id: attrs.id, email: attrs.email };
          users[attrs.id] = user;
          return { data: { user }, error: null };
        },
        updateUserById: async (id: string, attrs: { email?: string }) => {
          calls.updateUser += 1;
          if (updateUserError) return { data: { user: null }, error: updateUserError };
          const existing = users[id];
          if (existing && attrs.email) existing.email = attrs.email;
          return { data: { user: existing ?? null }, error: null };
        },
        listUsers: async () => {
          calls.listUsers += 1;
          if (listUsersError) return { data: { users: [] }, error: listUsersError };
          return { data: { users: Object.values(users) }, error: null };
        },
        generateLink: async ({ email }: { type: string; email: string }) => {
          calls.generateLink += 1;
          if (generateLinkThrows) throw generateLinkThrows;
          if (generateLinkError) {
            return { data: { properties: {}, user: null }, error: generateLinkError };
          }
          const owner =
            generateLinkUserId ??
            Object.values(users).find((user) => user.email === email)?.id ??
            'unknown-user';
          return {
            data: {
              properties: hashedToken ? { hashed_token: hashedToken } : {},
              user: { id: owner },
            },
            error: null,
          };
        },
      },
    },
  };

  return { client, calls };
}
