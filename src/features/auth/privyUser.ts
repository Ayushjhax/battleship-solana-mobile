import type { User } from '@privy-io/expo';

export function privyEmail(user: User | null): string | null {
  if (!user) return null;
  const google = user.linked_accounts.find((account) => account.type === 'google_oauth');
  if (google?.email) return google.email;
  const email = user.linked_accounts.find((account) => account.type === 'email');
  return email?.address ?? null;
}

export function privyDisplayName(user: User | null): string | null {
  if (!user) return null;
  const google = user.linked_accounts.find((account) => account.type === 'google_oauth');
  return google?.name ?? null;
}

export function privyLoginMethods(user: User | null): string[] {
  if (!user) return [];
  const methods: string[] = [];
  for (const account of user.linked_accounts) {
    if (account.type === 'google_oauth') methods.push('Google');
    else if (account.type === 'email') methods.push('Email OTP');
  }
  return Array.from(new Set(methods));
}
