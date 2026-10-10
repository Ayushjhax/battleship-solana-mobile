#!/bin/bash
# Payment locking under real concurrency, against a real PostgreSQL server.
#
# supabase/verify-offline.mjs runs every migration in PGlite, which has one
# connection, so it can never put two transactions in flight at once. This
# script starts a throwaway PostgreSQL cluster (a temp directory, listening only
# on a Unix socket in it: no network port, never a real project), applies
# every migration, and then races two sessions against each other. Session A
# holds its transaction open after its call; session B arrives while A still
# holds its locks, exactly as a second server request would.
#
# Opt-in, not part of `npm test`: it needs PostgreSQL server binaries.
#   bash supabase/verify-concurrency.sh               # finds Homebrew postgresql@*
#   PG_BIN=/path/to/postgres/bin bash supabase/verify-concurrency.sh
#
# PostgreSQL 14 lacks `security_invoker` on views (15+); on a 14 server the
# option is stripped from the two leaderboard views, which nothing here touches.
set -euo pipefail
cd "$(dirname "$0")/.."

PG_BIN=${PG_BIN:-$(ls -d /opt/homebrew/opt/postgresql@*/bin 2>/dev/null | sort -V | tail -1)}
if [[ -z "$PG_BIN" || ! -x "$PG_BIN/postgres" ]]; then
  echo "needs PostgreSQL server binaries: set PG_BIN" >&2
  exit 2
fi
VERSION=$("$PG_BIN/postgres" --version | sed -E 's/[^0-9]*([0-9]+).*/\1/')
TMP=$(mktemp -d)
SOCK="$TMP/sock"
mkdir -p "$SOCK"
PORT=54329
cleanup() {
  "$PG_BIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

"$PG_BIN/initdb" -D "$TMP/data" -U postgres --auth=trust >/dev/null
"$PG_BIN/pg_ctl" -D "$TMP/data" -l "$TMP/server.log" -w \
  -o "-c listen_addresses='' -c unix_socket_directories='$SOCK' -p $PORT" start >/dev/null

PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$SOCK" -p "$PORT" -U postgres -d postgres)
q() { "${PSQL[@]}" -At -c "$1"; }

FAILS=0
check() { # check <expected> <actual> <message>
  if [[ "$1" == "$2" ]]; then echo "ok   $3"; else echo "FAIL $3 (expected '$1', got '$2')"; FAILS=$((FAILS + 1)); fi
}
# expect_b <extended regex> <message>: what the session that arrived second was told.
expect_b() {
  if grep -Eq "$1" "$TMP/b.out"; then
    echo "ok   $2"
  else
    echo "FAIL $2 — session B said: $(tr '\n' ' ' <"$TMP/b.out")"
    FAILS=$((FAILS + 1))
  fi
}

# The parts of Supabase the migrations touch (the same stand-ins verify-offline.mjs uses).
"${PSQL[@]}" <<'SQL'
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth;
create table auth.users (
  id uuid primary key, instance_id uuid, aud text, role text, email text,
  is_anonymous boolean not null default false,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub', '')::uuid $$;
create schema realtime;
create table realtime.messages (id bigserial primary key, topic text not null, extension text not null, payload jsonb, inserted_at timestamptz default now());
alter table realtime.messages enable row level security;
create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic', true) $$;
grant usage on schema public, auth, realtime to anon, authenticated, service_role;
grant select, insert on realtime.messages to authenticated;
grant usage, select on all sequences in schema realtime to authenticated;
SQL

for migration in supabase/migrations/*.sql; do
  if ((VERSION < 15)); then
    sed -E 's/with \(security_invoker = true\)//' "$migration" | "${PSQL[@]}" >/dev/null
  else
    "${PSQL[@]}" -f "$migration" >/dev/null
  fi
done
echo "ok   every migration applied to PostgreSQL $VERSION"

# Two identities, each with 100 welcome (locked) points and 100 bought (sellable).
SELLER=66666666-6666-4666-8666-666666666601
OTHER=66666666-6666-4666-8666-666666666602
for pair in "$SELLER:did:privy:seller:WalletSeller1111111111111111111111111111" "$OTHER:did:privy:other:WalletOther11111111111111111111111111111"; do
  id=${pair%%:*}; rest=${pair#*:}; did=${rest%:*}; wallet=${rest##*:}
  q "insert into auth.users (id, email) values ('$id', null)" >/dev/null
  q "select public.sync_privy_account('$id', '$did', null, null, 'solana_wallet', null, null, '[]'::jsonb, now())" >/dev/null
  q "select * from public.ensure_point_account('$id', '$did')" >/dev/null
  q "select * from public.sync_verified_wallets('$id', '$did', '[{\"address\":\"$wallet\",\"kind\":\"external\"}]'::jsonb)" >/dev/null
done
SIG_SEED=$(printf '5%.0s' {1..88})
q "select public.create_point_buy_order('$SELLER', '77777777-7777-4777-8777-777777777700', 'WalletSeller1111111111111111111111111111', now() + interval '10 minutes')" >/dev/null
q "select public.credit_point_buy_order('$SELLER', '77777777-7777-4777-8777-777777777700', '$SIG_SEED', 'WalletSeller1111111111111111111111111111')" >/dev/null
check "200|100|100" "$(q "select balance || '|' || locked || '|' || sellable from public.get_point_balances('$SELLER')")" 'fixture: the seller holds 100 sellable points'

# race <sql for A, held open> <sql for B>: B starts while A still holds its locks.
# Each statement is its own -c, run in order on one connection, so psql prints
# every result (one -c holding several statements shows only the last).
race() {
  ( "${PSQL[@]}" -At -c "begin" -c "$1" -c "select pg_sleep(1.5)" -c "commit" >"$TMP/a.out" 2>&1
    echo "exit=$?" >>"$TMP/a.out" ) &
  local holder=$!
  sleep 0.4
  local started
  started=$(python3 -c 'import time; print(int(time.time() * 1000))')
  ( "${PSQL[@]}" -At -c "begin" -c "$2" -c "commit" >"$TMP/b.out" 2>&1; echo "exit=$?" >>"$TMP/b.out" ) || true
  echo $(( $(python3 -c 'import time; print(int(time.time() * 1000))') - started )) >"$TMP/b.ms"
  wait "$holder" || true
}

# B must have arrived while A was still open and waited for it: otherwise the
# race proved nothing about locks.
waited() {
  local ms
  ms=$(cat "$TMP/b.ms")
  if ((ms >= 700)); then echo "ok   $1 (B waited ${ms} ms on A's locks)"; else echo "FAIL $1 (B finished in ${ms} ms: it never waited on A)"; FAILS=$((FAILS + 1)); fi
}

# 1. Two sales race for the same last 100 sellable points.
race "select ok, reason from public.begin_point_sell_to('$SELLER', '88888888-8888-4888-8888-888888888801', 100, 1000000, 'WalletSeller1111111111111111111111111111')" \
     "select ok, reason from public.begin_point_sell_to('$SELLER', '88888888-8888-4888-8888-888888888802', 100, 1000000, 'WalletSeller1111111111111111111111111111')"
waited 'concurrent sales overlapped'
check "1" "$(q "select count(*) from public.point_trades where kind = 'sell' and privy_user_id = 'did:privy:seller'")" 'concurrent sales: only one reserves the last sellable points'
check "100" "$(q "select balance from public.point_accounts where privy_user_id = 'did:privy:seller'")" 'concurrent sales: the balance moved exactly once'
expect_b 'insufficient_points|locked_points' 'concurrent sales: the second is refused for want of points, after waiting for the first'

# 2. The same sale request twice at once (a double tap reaching two servers).
q "select public.create_point_buy_order('$OTHER', '77777777-7777-4777-8777-777777777710', 'WalletOther11111111111111111111111111111', now() + interval '10 minutes')" >/dev/null
q "select public.credit_point_buy_order('$OTHER', '77777777-7777-4777-8777-777777777710', '$(printf '6%.0s' {1..88})', 'WalletOther11111111111111111111111111111')" >/dev/null
race "select ok from public.begin_point_sell_to('$OTHER', '88888888-8888-4888-8888-888888888810', 100, 1000000, 'WalletOther11111111111111111111111111111')" \
     "select ok from public.begin_point_sell_to('$OTHER', '88888888-8888-4888-8888-888888888810', 100, 1000000, 'WalletOther11111111111111111111111111111')"
waited 'the double-tapped sale overlapped'
check "100" "$(q "select balance from public.point_accounts where privy_user_id = 'did:privy:other'")" 'the same sale request twice at once reserves its points once'
check "1" "$(q "select count(*) from public.point_trades where request_id = '88888888-8888-4888-8888-888888888810'")" '…and makes one trade'

# 3. One payment raced against two different orders.
for order in 20 21; do
  q "select public.create_point_buy_order('$OTHER', '77777777-7777-4777-8777-7777777777$order', 'WalletOther11111111111111111111111111111', now() + interval '10 minutes')" >/dev/null
done
PAYMENT=$(printf '7%.0s' {1..88})
race "select public.credit_point_buy_order('$OTHER', '77777777-7777-4777-8777-777777777720', '$PAYMENT', 'WalletOther11111111111111111111111111111')" \
     "select public.credit_point_buy_order('$OTHER', '77777777-7777-4777-8777-777777777721', '$PAYMENT', 'WalletOther11111111111111111111111111111')"
waited 'the payment race overlapped'
check "1" "$(q "select count(*) from public.point_trades where signature = '$PAYMENT'")" 'one payment raced against two orders credits only one'
check "200" "$(q "select balance from public.point_accounts where privy_user_id = 'did:privy:other'")" '…and adds its 100 points once'

# 4. One order raced against two different payments.
q "select public.create_point_buy_order('$OTHER', '77777777-7777-4777-8777-777777777730', 'WalletOther11111111111111111111111111111', now() + interval '10 minutes')" >/dev/null
race "select public.credit_point_buy_order('$OTHER', '77777777-7777-4777-8777-777777777730', '$(printf '8%.0s' {1..88})', 'WalletOther11111111111111111111111111111')" \
     "select public.credit_point_buy_order('$OTHER', '77777777-7777-4777-8777-777777777730', '$(printf '9%.0s' {1..88})', 'WalletOther11111111111111111111111111111')"
waited 'the order race overlapped'
check "300" "$(q "select balance from public.point_accounts where privy_user_id = 'did:privy:other'")" 'one order raced against two payments is credited once'
expect_b 'already paid' '…and the second payment is refused as already paid'

# 5. Two accounts claim the same new wallet at once.
race "select wallet_status from public.sync_verified_wallets('$SELLER', 'did:privy:seller', '[{\"address\":\"ContestedWallet111111111111111111111111\",\"kind\":\"external\"}]'::jsonb)" \
     "select wallet_status from public.sync_verified_wallets('$OTHER', 'did:privy:other', '[{\"address\":\"ContestedWallet111111111111111111111111\",\"kind\":\"external\"}]'::jsonb)"
waited 'the wallet claim race overlapped'
check "did:privy:seller" "$(q "select privy_user_id from public.verified_wallets where address = 'ContestedWallet111111111111111111111111'")" 'a wallet claimed by two accounts at once has one owner'
expect_b 'conflict' '…and the second account is told it is a conflict'

if ((FAILS > 0)); then
  echo
  echo "$FAILS FAILED"
  exit 1
fi
echo
echo "all concurrency checks passed"
