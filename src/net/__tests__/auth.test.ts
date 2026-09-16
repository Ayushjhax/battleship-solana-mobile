import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getSessionUserId: vi.fn() }));

vi.mock('../api', () => ({ getSessionUserId: mocks.getSessionUserId }));
vi.mock('../supabase', () => ({ isSupabaseConfigured: true }));

describe('ensureSession', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getSessionUserId.mockReset();
    mocks.getSessionUserId.mockResolvedValue({ ok: true, value: null });
  });

  it('does not create an anonymous account before Privy bootstrap', async () => {
    const { ensureSession } = await import('../auth');

    await expect(ensureSession()).resolves.toBeNull();
    expect(mocks.getSessionUserId).toHaveBeenCalledTimes(1);
  });

  it('reuses the Privy-backed gameplay session after bootstrap', async () => {
    mocks.getSessionUserId.mockResolvedValue({ ok: true, value: 'profile-1' });
    const { ensureSession } = await import('../auth');

    await expect(ensureSession()).resolves.toBe('profile-1');
  });
});

describe('boot budgets', () => {
  it('gives the account handoff more room than the Supabase read', async () => {
    // These two used to be the same value, nested — so the cloud read's timer
    // always fired first and boot decided the route before the handoff had
    // installed the session, sending a returning captain through onboarding.
    const { BOOT_NETWORK_TIMEOUT_MS, PRIVY_HANDOFF_TIMEOUT_MS } = await import('../auth');

    expect(PRIVY_HANDOFF_TIMEOUT_MS).toBeGreaterThan(BOOT_NETWORK_TIMEOUT_MS);
  });
});
