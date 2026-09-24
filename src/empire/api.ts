import { getAccessToken } from '@/net/api';
import { apiBaseOrNull } from '@/net/apiBase';
export interface EmpireView { readonly conquered: readonly string[]; readonly stars: Readonly<Record<string, number>>; readonly progress: number; readonly tribute: { readonly coins: number; readonly steel: number }; readonly serverNow: number }
async function request(path: string, init?: RequestInit): Promise<EmpireView> { const base = apiBaseOrNull(); if (!base) throw new Error('offline'); const token = await getAccessToken(); if (!token.ok) throw new Error('unauthenticated'); const response = await fetch(`${base}${path}`, { ...init, headers: { authorization: `Bearer ${token.value}`, 'content-type': 'application/json' } }); const body = await response.json(); if (!response.ok) throw new Error(body.code ?? 'empire-error'); return body as EmpireView; }
export const getEmpire = () => request('/empire');
export const collectTribute = (requestId: string) => request('/empire/tribute', { method: 'POST', body: JSON.stringify({ requestId }) });
export const completeEmpireBattle = (portId: string, shots: readonly { row: number; col: number }[]) => request('/empire/complete', { method: 'POST', body: JSON.stringify({ portId, shots }) });
