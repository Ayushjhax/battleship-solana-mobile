/**
 * The shared transport for the Port City feature APIs.
 *
 * Lifted verbatim out of `src/city/api.ts` (Part 1) when Part 7 needed the
 * same three rules and copying them would have meant two places to fix:
 *
 *   - every mutation carries a client-generated `requestId` (uuid), so a retry
 *     replays the server's stored response instead of acting twice;
 *   - retries happen on NETWORK failures only, never on a 409. A 409 is the
 *     server saying "no" with a typed code, and asking again cannot change it;
 *   - nothing here computes anything. The response is the truth.
 *
 * It is deliberately generic over the error code, so each feature keeps its
 * own typed error union and its own Error subclass — the city's `feature-off`
 * and the raid's `target-locked` are not the same vocabulary and must not be
 * merged into one.
 */
import { z } from 'zod';

import { getAccessToken } from '@/net/api';
import { apiBaseOrNull } from '@/net/apiBase';
import { hasInternet } from '@/net/connectivity';
import { isForcedOffline } from '@/state/demo';

import { MAX_ATTEMPTS, RETRY_DELAY_MS, TIMEOUT_MS } from './retryPolicy';

// The policy lives in its own import-free module so it can be read without
// loading the transport (and, with it, the whole React Native stack).
export { MAX_ATTEMPTS, RETRY_DELAY_MS, TIMEOUT_MS } from './retryPolicy';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ErrorBody = z.object({ code: z.string().optional(), error: z.string().optional() });

/**
 * The three codes the transport itself can produce. A feature's error union
 * must include all three; everything else comes from the server's `code`.
 */
export type TransportErrorCode = 'offline' | 'unauthenticated' | 'internal';

export interface FeatureErrorShape<Code extends string> {
  readonly code: Code;
  readonly detail?: string;
}

export interface TransportOptions<Code extends string> {
  /** Builds the feature's own Error from a code. */
  readonly makeError: (code: Code, detail?: string) => Error & FeatureErrorShape<Code>;
  /** Narrows an unknown server `code` string to the feature's union. */
  readonly asCode: (raw: string) => Code;
}

export interface SendInit {
  readonly method: 'GET' | 'POST';
  readonly body?: unknown;
  /** false for unauthenticated endpoints such as /config. */
  readonly auth?: boolean;
}

function endpoint<Code extends string>(path: string, options: TransportOptions<Code>): string {
  const base = apiBaseOrNull();
  if (!base) throw options.makeError(options.asCode('offline'), 'no API base configured');
  return `${base}${path}`;
}

async function authHeaders<Code extends string>(
  options: TransportOptions<Code>,
): Promise<Record<string, string>> {
  const token = await getAccessToken();
  if (!token.ok) throw options.makeError(options.asCode('unauthenticated'), 'no gameplay session');
  return { authorization: `Bearer ${token.value}`, 'content-type': 'application/json' };
}

/**
 * One request. `retryable` is true only for a transport failure, so the retry
 * loop can tell "the server said no" from "the server never answered".
 */
export async function sendOnce<Code extends string>(
  path: string,
  init: SendInit,
  options: TransportOptions<Code>,
): Promise<
  | { ok: true; data: unknown }
  | { ok: false; error: Error & FeatureErrorShape<Code>; retryable: boolean }
> {
  if (isForcedOffline() || !(await hasInternet())) {
    return { ok: false, error: options.makeError(options.asCode('offline')), retryable: false };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers =
      init.auth === false ? { 'content-type': 'application/json' } : await authHeaders(options);
    const response = await fetch(endpoint(path, options), {
      method: init.method,
      headers,
      signal: controller.signal,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });

    if (response.ok) return { ok: true, data: await response.json() };

    // 5xx is the server failing to answer, which a retry can fix. 4xx is an
    // answer — including every typed 409 — and must not be retried. 503 is
    // the canonical "try again" status; excluding it made a transient server
    // fault terminal (hardening H1).
    const retryable = response.status >= 500;
    let code = options.asCode('internal');
    try {
      const parsed = ErrorBody.safeParse(await response.json());
      if (parsed.success && parsed.data.code) code = options.asCode(parsed.data.code);
    } catch {
      /* a body that is not JSON stays 'internal' */
    }
    if (response.status === 401) code = options.asCode('unauthenticated');
    return { ok: false, error: options.makeError(code), retryable };
  } catch (error) {
    if (isFeatureError<Code>(error)) return { ok: false, error, retryable: false };
    return {
      ok: false,
      error: options.makeError(options.asCode('offline'), String(error)),
      retryable: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

function isFeatureError<Code extends string>(
  error: unknown,
): error is Error & FeatureErrorShape<Code> {
  return error instanceof Error && typeof (error as { code?: unknown }).code === 'string';
}

/** The retry loop. Throws the feature's own Error. */
export async function requestWithRetry<Code extends string>(
  path: string,
  init: SendInit,
  options: TransportOptions<Code>,
): Promise<unknown> {
  let last: Error & FeatureErrorShape<Code> = options.makeError(options.asCode('internal'));
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const result = await sendOnce(path, init, options);
    if (result.ok) return result.data;
    last = result.error;
    if (!result.retryable) break;
    if (attempt < MAX_ATTEMPTS - 1) await sleep(RETRY_DELAY_MS * (attempt + 1));
  }
  throw last;
}
