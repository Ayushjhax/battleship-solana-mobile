import { describe, expect, it } from 'vitest';
import { bossCoordKey, generateBossLayout } from '@engine/worldBoss';
import { SerializedWorldBoss } from '../worldBoss/service';

const DAY = '2026-09-24';

describe('11B serialized writer — concurrency is the feature', () => {
  it('resolves two shots in the same millisecond once and refunds the loser', async () => {
    const boss = new SerializedWorldBoss(11);
    const coord = { row: 0, col: 0 };
    const [a, b] = await Promise.all([
      boss.shoot({ requestId: 'a', playerId: 'a', coord, day: DAY }),
      boss.shoot({ requestId: 'b', playerId: 'b', coord, day: DAY }),
    ]);
    expect([a, b].filter((x) => x.ok && x.charged)).toHaveLength(1);
    expect([a, b].filter((x) => x.ok && x.refunded)).toHaveLength(1);
    expect(Object.keys(boss.snapshot().marks)).toEqual(['0:0']);
  });

  it('refunds every loser in a 100-call collision and charges once', async () => {
    const boss = new SerializedWorldBoss(12);
    const outcomes = await Promise.all(Array.from({ length: 100 }, (_, i) => boss.shoot({ requestId: `r${i}`, playerId: `p${i}`, coord: { row: 4, col: 4 }, day: DAY })));
    expect(outcomes.filter((x) => x.ok && x.charged)).toHaveLength(1);
    expect(outcomes.filter((x) => x.ok && x.refunded)).toHaveLength(99);
  });

  it('replays a request without charging it twice', async () => {
    const boss = new SerializedWorldBoss(13);
    const request = { requestId: 'same', playerId: 'p', coord: { row: 2, col: 2 }, day: DAY };
    expect(await boss.shoot(request)).toEqual(await boss.shoot(request));
  });

  it('refuses a sixth base shot', async () => {
    const boss = new SerializedWorldBoss(14);
    for (let i = 0; i < 5; i++) expect((await boss.shoot({ requestId: `${i}`, playerId: 'p', coord: { row: 29, col: i }, day: DAY })).ok).toBe(true);
    expect(await boss.shoot({ requestId: 'six', playerId: 'p', coord: { row: 28, col: 29 }, day: DAY })).toEqual({ ok: false, error: 'no-shots-left' });
  });

  it('rolls a wave over atomically while a second shot waits', async () => {
    const boss = new SerializedWorldBoss(15);
    const layout = generateBossLayout(15);
    let i = 0;
    for (const ship of layout.ships) for (const coord of ship.cells.slice(0, ship.id === layout.ships.at(-1)?.id ? -1 : undefined)) {
      await boss.shoot({ requestId: `prime-${i++}`, playerId: `prime-${i}`, coord, day: DAY, fleetWarRaids: 100 });
    }
    // Prime the remaining cells with separate players so the per-player cap is irrelevant.
    const all = layout.ships.flatMap((ship) => ship.cells);
    const unresolved = all.filter((coord) => boss.snapshot().marks[bossCoordKey(coord)] === undefined);
    for (let n = 0; n < unresolved.length - 1; n++) await boss.shoot({ requestId: `u${n}`, playerId: `u${n}`, coord: unresolved[n]!, day: DAY });
    const last = unresolved.at(-1)!;
    const [finisher, follower] = await Promise.all([
      boss.shoot({ requestId: 'finish', playerId: 'finisher', coord: last, day: DAY }),
      boss.shoot({ requestId: 'next', playerId: 'follower', coord: last, day: DAY }),
    ]);
    expect(finisher.ok && finisher.nextWave).toBe(2);
    expect(follower.ok && follower.wave).toBe(2);
    expect(boss.snapshot().wave).toBe(2);
  });

  it('reward ledger keys remain unique under retries', async () => {
    const boss = new SerializedWorldBoss(16);
    const layout = generateBossLayout(16);
    const hits = layout.ships.flatMap((ship) => ship.cells).slice(0, 30);
    await Promise.all(hits.map((coord, i) => boss.shoot({ requestId: `h${i}`, playerId: `p${i}`, coord, day: DAY })));
    const keys = boss.rewardKeys();
    expect(new Set(keys).size).toBe(keys.length);
  });
});
