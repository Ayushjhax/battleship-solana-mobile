import { getAccessToken } from '@/net/api';
import { apiBaseOrNull } from '@/net/apiBase';
import type { PublicBossBoard } from '@engine/worldBoss';

export interface BossSnapshot { readonly board: PublicBossBoard; readonly serverNow: number }

async function request(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const base = apiBaseOrNull();
  if (!base) throw new Error('offline');
  const token = await getAccessToken();
  if (!token.ok) throw new Error('unauthenticated');
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token.value}`, 'content-type': 'application/json' },
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.code === 'string' ? body.code : 'world-boss-error');
  return body;
}

export async function getWorldBoss(): Promise<BossSnapshot> {
  return (await request('/world-boss')) as unknown as BossSnapshot;
}

export async function fireWorldBoss(row: number, col: number, requestId: string): Promise<BossSnapshot> {
  return (await request('/world-boss/shot', { method: 'POST', body: JSON.stringify({ row, col, requestId }) })) as unknown as BossSnapshot;
}

