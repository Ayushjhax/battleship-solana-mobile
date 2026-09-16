-- 0009 - verified Privy identities and their embedded Solana wallets.
--
-- The mobile app cannot read or write this table. The match server verifies a
-- Privy access token and either reuses or provisions the Supabase gameplay
-- user, then writes trusted account data with the service-role client.
-- profile_id remains the one-row-per-game-profile key.

create table if not exists public.privy_accounts (
  profile_id             uuid primary key references public.profiles (id) on delete cascade,
  privy_user_id          text not null,
  email                  text,
  display_name           text,
  auth_provider          text not null,
  solana_wallet_address  text,
  solana_wallet_id       text,
  linked_accounts        jsonb not null default '[]'::jsonb,
  privy_created_at       timestamptz not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists privy_accounts_user_id_idx
  on public.privy_accounts (privy_user_id);

alter table public.privy_accounts enable row level security;
revoke all on public.privy_accounts from anon, authenticated;

comment on table public.privy_accounts is
  'Server-verified Privy identity and embedded Solana wallet mapped to a gameplay profile.';

-- Refuse to silently attach an existing gameplay profile to a different Privy
-- user. This is atomic, unlike a select followed by an upsert in application
-- code, and keeps a second sign-in on the same device from taking over progress.
create or replace function public.sync_privy_account(
  p_profile_id uuid,
  p_privy_user_id text,
  p_email text,
  p_display_name text,
  p_auth_provider text,
  p_solana_wallet_address text,
  p_solana_wallet_id text,
  p_linked_accounts jsonb,
  p_privy_created_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.privy_accounts (
    profile_id, privy_user_id, email, display_name, auth_provider,
    solana_wallet_address, solana_wallet_id, linked_accounts, privy_created_at
  ) values (
    p_profile_id, p_privy_user_id, p_email, p_display_name, p_auth_provider,
    p_solana_wallet_address, p_solana_wallet_id, p_linked_accounts, p_privy_created_at
  )
  on conflict (profile_id) do update set
    email = excluded.email,
    display_name = excluded.display_name,
    auth_provider = excluded.auth_provider,
    solana_wallet_address = excluded.solana_wallet_address,
    solana_wallet_id = excluded.solana_wallet_id,
    linked_accounts = excluded.linked_accounts,
    privy_created_at = excluded.privy_created_at,
    updated_at = now()
  where public.privy_accounts.privy_user_id = excluded.privy_user_id;

  if not found then
    raise exception 'game profile is already linked to another Privy user'
      using errcode = '23505';
  end if;
end;
$$;

revoke all on function public.sync_privy_account(
  uuid, text, text, text, text, text, text, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.sync_privy_account(
  uuid, text, text, text, text, text, text, jsonb, timestamptz
) to service_role;
