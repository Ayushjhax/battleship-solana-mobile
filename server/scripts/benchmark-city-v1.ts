/** Release-readiness benchmark for the lazy v1 city migration. */
import { emptyCityFor, migrateToV1, type CityWorld } from '@engine/city';

const ROWS = Number(process.env.CITY_MIGRATION_ROWS ?? 100_000);
const NOW = 1_795_000_000_000;
const DAY = new Date(NOW).toISOString().slice(0, 10);

interface ShapedProfile {
  readonly rankPoints: number;
  readonly world: CityWorld;
}

const profiles: ShapedProfile[] = Array.from({ length: ROWS }, (_, i) => ({
  // Covers the complete shipped ladder plus the common low-rank majority.
  rankPoints: i % 10 < 7 ? (i * 37) % 1_000 : (i * 137) % 10_001,
  world: {
    city: emptyCityFor(NOW - (i % 365) * 86_400_000, DAY),
    wallet: {
      coins: (i * 7919) % 250_000,
      steel: 0,
      gems: 10 + (i % 500),
    },
  },
}));

function pass(rows: readonly ShapedProfile[]): {
  readonly rows: ShapedProfile[];
  readonly elapsedMs: number;
  readonly migrated: number;
  readonly ledgerRows: number;
} {
  const started = performance.now();
  let migrated = 0;
  let ledgerRows = 0;
  const next = rows.map((profile) => {
    const result = migrateToV1(profile.world, profile.rankPoints, NOW);
    if (result.migrated) migrated += 1;
    ledgerRows += result.ledger.length;
    return { ...profile, world: result.world };
  });
  return { rows: next, elapsedMs: performance.now() - started, migrated, ledgerRows };
}

const first = pass(profiles);
const second = pass(first.rows);
const totals = first.rows.reduce(
  (sum, profile) => ({
    steel: sum.steel + profile.world.wallet.steel,
    gems: sum.gems + profile.world.wallet.gems,
  }),
  { steel: 0, gems: 0 },
);

console.log(
  JSON.stringify(
    {
      productionShapedRows: ROWS,
      firstPass: {
        elapsedMs: Number(first.elapsedMs.toFixed(2)),
        migrated: first.migrated,
        ledgerRows: first.ledgerRows,
      },
      secondPass: {
        elapsedMs: Number(second.elapsedMs.toFixed(2)),
        migrated: second.migrated,
        ledgerRows: second.ledgerRows,
      },
      balancesAfterFirst: totals,
      secondPassByteIdentical: JSON.stringify(first.rows) === JSON.stringify(second.rows),
    },
    null,
    2,
  ),
);
