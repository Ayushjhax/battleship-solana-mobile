/**
 * The typed city client — part-01 §5.
 *
 * Rules this file exists to enforce:
 *   - every mutation carries a client-generated `requestId` (uuid), so a retry
 *     replays the server's stored response instead of acting twice;
 *   - retries happen on NETWORK failures only, never on a 409. A 409 is the
 *     server saying "no" with a typed code, and asking again cannot change it;
 *   - nothing here computes a balance. The response is the truth.
 */
import { z } from 'zod';

import { isForcedOffline } from '@/state/demo';
import { getAccessToken } from '@/net/api';
import { apiBaseOrNull } from '@/net/apiBase';
import { hasInternet } from '@/net/connectivity';
import { randomUuid } from '@/util/uuid';
import { CityApiError, type CityApiErrorCode, type CityResponse, type FeatureConfig } from './types';

/** Network-error retries only. A 409 is never retried. */
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 600;
const TIMEOUT_MS = 12_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ErrorBody = z.object({ code: z.string().optional(), error: z.string().optional() });

function endpoint(path: string): string {
  const base = apiBaseOrNull();
  if (!base) throw new CityApiError('offline', 'no API base configured');
  return `${base}${path}`;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  if (!token.ok) throw new CityApiError('unauthenticated', 'no gameplay session');
  return { authorization: `Bearer ${token.value}`, 'content-type': 'application/json' };
}

/**
 * One request. Throws CityApiError; the caller decides whether to surface it.
 * `retryable` is true only for a transport failure, so the retry loop above
 * can tell "the server said no" from "the server never answered".
 */
async function send(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; auth?: boolean },
): Promise<{ ok: true; data: unknown } | { ok: false; error: CityApiError; retryable: boolean }> {
  if (isForcedOffline() || !(await hasInternet())) {
    return { ok: false, error: new CityApiError('offline'), retryable: false };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = init.auth === false ? { 'content-type': 'application/json' } : await authHeaders();
    const response = await fetch(endpoint(path), {
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
    let code: CityApiErrorCode = 'internal';
    try {
      const parsed = ErrorBody.safeParse(await response.json());
      if (parsed.success && parsed.data.code) code = parsed.data.code as CityApiErrorCode;
    } catch {
      /* a body that is not JSON stays 'internal' */
    }
    if (response.status === 401) code = 'unauthenticated';
    return { ok: false, error: new CityApiError(code), retryable };
  } catch (error) {
    if (error instanceof CityApiError) return { ok: false, error, retryable: false };
    return { ok: false, error: new CityApiError('offline', String(error)), retryable: true };
  } finally {
    clearTimeout(timer);
  }
}

async function request(path: string, init: Parameters<typeof send>[1]): Promise<unknown> {
  let last: CityApiError = new CityApiError('internal');
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const result = await send(path, init);
    if (result.ok) return result.data;
    last = result.error;
    if (!result.retryable) break;
    if (attempt < MAX_ATTEMPTS - 1) await sleep(RETRY_DELAY_MS * (attempt + 1));
  }
  throw last;
}

// ---------------------------------------------------------------------------
// The endpoints
// ---------------------------------------------------------------------------

export async function fetchConfig(): Promise<FeatureConfig> {
  return (await request('/config', { method: 'GET', auth: false })) as FeatureConfig;
}

export async function getCity(): Promise<CityResponse> {
  return (await request('/city', { method: 'GET' })) as CityResponse;
}

function mutate(path: string, body: Record<string, unknown>): Promise<CityResponse> {
  return request(path, { method: 'POST', body }) as Promise<CityResponse>;
}

export function buildBuilding(buildingId: string, requestId = randomUuid()): Promise<CityResponse> {
  return mutate('/city/build', { buildingId, requestId });
}

export function speedUpBuilding(buildingId: string, requestId = randomUuid()): Promise<CityResponse> {
  return mutate('/city/speedup', { buildingId, requestId });
}

export function cancelBuilding(buildingId: string, requestId = randomUuid()): Promise<CityResponse> {
  return mutate('/city/cancel', { buildingId, requestId });
}

export function collectBuilding(buildingId: string, requestId = randomUuid()): Promise<CityResponse> {
  return mutate('/city/collect', { buildingId, requestId });
}

export function collectAllBuildings(requestId = randomUuid()): Promise<CityResponse> {
  return mutate('/city/collect-all', { requestId });
}

export function buyDockWorker(requestId = randomUuid()): Promise<CityResponse> {
  return mutate('/city/workers/buy', { requestId });
}
