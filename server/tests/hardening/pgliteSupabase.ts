/**
 * A PostgREST-shaped shim over PGlite, for hardening tests that drive the
 * REAL route -> service -> repo stack through `fastify.inject`.
 *
 * The product repos (`src/{city,raid,daily,fleet,bounties,cosmetics}`) talk to
 * Supabase through exactly two surfaces: `client.rpc(fn, args)` and the fluent
 * `client.from(table).select/insert/update/delete` builder. This module
 * implements those two surfaces against the in-process Postgres the other
 * integration suites already use (`tests/helpers/pgliteDb.ts`), so no product
 * code is faked and no repo seam has to be re-implemented per test.
 *
 * It is deliberately narrow:
 *   - `.from()` supports the operators the repos actually use
 *     (eq / is / not('x','is',null) / gte / order / limit / maybeSingle).
 *   - `rpc()` introspects `pg_proc.proretset` so set-returning functions come
 *     back as arrays and scalars/composites as values, like PostgREST.
 *   - Parameters are sent untyped so Postgres infers uuid/text/date/bigint
 *     from the function signature; JS objects become JSON and arrays of
 *     primitives become Postgres array literals (arrays of objects are JSON,
 *     which is what the jsonb parameters like `p_drain` expect).
 *
 * Unknown SQL failures are returned as `{ data: null, error }`, exactly as
 * Supabase reports them, so the product code's own error handling runs.
 */
import type { TestDb } from '../helpers/pgliteDb';

type Row = Record<string, unknown>;
export interface SupabaseResult {
  data: unknown;
  error: { message: string } | null;
}

interface Filter {
  column: string;
  op: 'eq' | 'is' | 'not' | 'gte';
  value: unknown;
}

const SAFE_COLUMNS = /^[a-z0-9_*]+(,\s*[a-z0-9_*]+)*$/i;

function pgArray(values: readonly unknown[]): string {
  const inner = values
    .map((value) => {
      if (value === null || value === undefined) return 'null';
      if (typeof value === 'string') return `"${value.replace(/"/g, '\\"')}"`;
      return String(value);
    })
    .join(',');
  return `{${inner}}`;
}

function encode(value: unknown, typeName?: string): unknown {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) {
    const isJsonType = typeName === 'json' || typeName === 'jsonb';
    const elementIsObject = value.some((entry) => entry !== null && typeof entry === 'object');
    // `p_drain`/`p_ledger`/`p_rows` are jsonb arrays; `p_unlocks`/`p_pages`
    // are Postgres arrays. The function's declared argument type decides.
    if (isJsonType || elementIsObject || typeName === undefined) return JSON.stringify(value);
    return pgArray(value);
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

class TableBuilder implements PromiseLike<SupabaseResult> {
  private action: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private columns = '*';
  private payload: Row | Row[] | null = null;
  private filters: Filter[] = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitN: number | null = null;

  constructor(
    private readonly t: TestDb,
    private readonly table: string,
  ) {}

  select(columns = '*'): this {
    this.action = 'select';
    this.columns = columns;
    return this;
  }

  insert(values: Row | Row[]): this {
    this.action = 'insert';
    this.payload = values;
    return this;
  }

  update(values: Row): this {
    this.action = 'update';
    this.payload = values;
    return this;
  }

  delete(): this {
    this.action = 'delete';
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ column, op: 'eq', value });
    return this;
  }

  is(column: string, value: unknown): this {
    this.filters.push({ column, op: 'is', value });
    return this;
  }

  not(column: string, _op: string, _value: unknown): this {
    // The only use in the repos is `.not('col', 'is', null)`.
    this.filters.push({ column, op: 'not', value: null });
    return this;
  }

  gte(column: string, value: unknown): this {
    this.filters.push({ column, op: 'gte', value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orderBy = { column, ascending: options?.ascending !== false };
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  maybeSingle(): Promise<SupabaseResult> {
    return this.run(true);
  }

  single(): Promise<SupabaseResult> {
    return this.run(true);
  }

  then<TResult1 = SupabaseResult, TResult2 = never>(
    onfulfilled?: ((value: SupabaseResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.run(false).then(onfulfilled, onrejected);
  }

  private whereSql(startAt: number): { sql: string; values: unknown[] } {
    const parts: string[] = [];
    const values: unknown[] = [];
    for (const filter of this.filters) {
      if (filter.op === 'is') {
        parts.push(`${filter.column} is ${filter.value === null ? 'null' : 'not null'}`);
        continue;
      }
      if (filter.op === 'not') {
        parts.push(`${filter.column} is not null`);
        continue;
      }
      values.push(encode(filter.value));
      parts.push(`${filter.column} ${filter.op === 'eq' ? '=' : '>='} $${startAt + values.length}`);
    }
    return { sql: parts.length > 0 ? ` where ${parts.join(' and ')}` : '', values };
  }

  private async run(single: boolean): Promise<SupabaseResult> {
    try {
      const columns = this.columns.trim();
      if (this.action === 'select' && !SAFE_COLUMNS.test(columns)) {
        return { data: null, error: { message: `unsafe column list: ${columns}` } };
      }

      if (this.action === 'select') {
        const { sql, values } = this.whereSql(0);
        let query = `select ${columns} from public.${this.table}${sql}`;
        if (this.orderBy) {
          query += ` order by ${this.orderBy.column} ${this.orderBy.ascending ? 'asc' : 'desc'}`;
        }
        if (this.limitN !== null) query += ` limit ${this.limitN}`;
        const rows = await this.t.query<Row>(query, values);
        return { data: single ? (rows[0] ?? null) : rows, error: null };
      }

      if (this.action === 'insert') {
        const rows = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
        const first = rows[0] ?? {};
        const keys = Object.keys(first);
        const values: unknown[] = [];
        for (const row of rows) {
          for (const key of keys) values.push(encode(row[key]));
        }
        const tuples = rows
          .map((_, rowIndex) => `(${keys.map((__, i) => `$${rowIndex * keys.length + i + 1}`).join(', ')})`)
          .join(', ');
        await this.t.query(
          `insert into public.${this.table} (${keys.join(', ')}) values ${tuples}`,
          values,
        );
        return { data: null, error: null };
      }

      if (this.action === 'update') {
        const payload = this.payload as Row;
        const keys = Object.keys(payload);
        const values = keys.map((key) => encode(payload[key]));
        const { sql, values: filterValues } = this.whereSql(values.length);
        const sets = keys.map((key, i) => `${key} = $${i + 1}`).join(', ');
        await this.t.query(`update public.${this.table} set ${sets}${sql}`, [...values, ...filterValues]);
        return { data: null, error: null };
      }

      const { sql, values } = this.whereSql(0);
      await this.t.query(`delete from public.${this.table}${sql}`, values);
      return { data: null, error: null };
    } catch (error) {
      return { data: null, error: { message: error instanceof Error ? error.message : String(error) } };
    }
  }
}

export interface PgliteSupabase {
  rpc(fn: string, args?: Record<string, unknown>): Promise<SupabaseResult>;
  from(table: string): TableBuilder;
}

export function pgliteSupabase(t: TestDb): PgliteSupabase {
  return {
    async rpc(fn, args = {}) {
      try {
        // `proretset` decides array vs single; the declared argument types
        // decide jsonb-vs-Postgres-array encoding. `select * from f(...)`
        // (rather than `select f(...)`) is what expands a `returns table` /
        // composite result into named columns — PostgREST does the same.
        const meta = await t.query<{ set: boolean; args: Record<string, string> }>(
          `select p.proretset as set,
                  coalesce((
                    select json_object_agg(n.name, ty.typname)
                      from unnest(p.proargnames, p.proargtypes::oid[]) as n(name, type_oid)
                      join pg_type ty on ty.oid = n.type_oid
                  ), '{}'::json) as args
             from pg_proc p
             join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'public' and p.proname = $1
            order by p.oid desc
            limit 1`,
          [fn],
        );
        const info = meta[0];
        if (!info) return { data: null, error: { message: `function public.${fn} does not exist` } };

        const types = (info.args ?? {}) as Record<string, string>;
        const keys = Object.keys(args);
        const values = keys.map((key) => encode(args[key], types[key]));
        const named = keys.map((key, i) => `${key} => $${i + 1}`).join(', ');
        const rows = await t.query<Row>(`select * from public.${fn}(${named})`, values);

        if (info.set === true) return { data: rows, error: null };
        const row = rows[0];
        if (!row) return { data: null, error: null };
        const fields = Object.values(row);
        return { data: fields.length === 1 ? fields[0] : row, error: null };
      } catch (error) {
        return { data: null, error: { message: error instanceof Error ? error.message : String(error) } };
      }
    },

    from(table: string) {
      return new TableBuilder(t, table);
    },
  };
}
