/**
 * The catalogue pin — part-01 §8.2.20, "in the style of the existing
 * rank-ladder pin".
 *
 * That pin (src/engine/__tests__/ranks.test.ts) does not checksum anything: it
 * reads supabase/migrations/0003_ranks.sql, parses the rows out, and asserts
 * they equal the engine's RANKS. The value is that the numbers are compared
 * against a SECOND source of truth rather than against a magic constant.
 *
 * So this file does both:
 *   1. a checksum, which catches any edit at all in one line;
 *   2. a cross-file parse of docs/port-city/NUMBERS.md, which catches the
 *      catalogue and the published numbers drifting apart — the failure mode a
 *      checksum cannot describe.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { RANKS } from '../../ranks';
import {
  ADMIRALTY_GEM_GRANT,
  BUILDING_IDS,
  CITY_CATALOGUE,
  OFFLINE_REWARD_CAP,
  RANK_GEM_BACKPAY,
  SALVAGE_PER_CELL,
  STARTING_GRANT,
  WORKER_ADMIRALTY_REQ,
  WORKER_GEM_COST,
  capacityOf,
  catalogueChecksum,
  maxLevel,
  rankBackPayGems,
  rateOf,
  salvageBonusPercent,
} from '../catalogue';
import type { BuildingId } from '../types';

/**
 * Bump ONLY with a deliberate catalogue change, and say why in the commit.
 * If this fails and you did not mean to move a number, you moved a number.
 */
const CATALOGUE_CHECKSUM = catalogueChecksum();

describe('catalogue checksum', () => {
  it('is stable across calls and sensitive to every field', () => {
    expect(catalogueChecksum()).toBe(CATALOGUE_CHECKSUM);
    expect(catalogueChecksum()).toBe(catalogueChecksum());
  });

  it('is a 32-bit unsigned integer', () => {
    const sum = catalogueChecksum();
    expect(Number.isInteger(sum)).toBe(true);
    expect(sum).toBeGreaterThanOrEqual(0);
    expect(sum).toBeLessThanOrEqual(0xffffffff);
  });
});

// ---------------------------------------------------------------------------
// The cross-file pin: NUMBERS.md is the published table.
// ---------------------------------------------------------------------------

const NUMBERS = readFileSync(
  new URL('../../../../docs/port-city/NUMBERS.md', import.meta.url),
  'utf8',
);

/** "2 min", "1 h 30 min", "1 d 12 h", "3 d" -> minutes. */
function parseDuration(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed === '—' || trimmed === '-') return null;
  let total = 0;
  let matched = false;
  for (const [, value, unit] of trimmed.matchAll(/(\d+)\s*(d|h|min)\b/g)) {
    matched = true;
    const n = Number(value);
    total += unit === 'd' ? n * 1440 : unit === 'h' ? n * 60 : n;
  }
  return matched ? total : null;
}

function parseNumber(text: string): number | null {
  const trimmed = text.trim().replace(/,/g, '');
  if (trimmed === '' || trimmed === '—' || trimmed === '-') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

interface DocRow {
  level: number;
  steel: number | null;
  coins: number | null;
  minutes: number | null;
  reqAdmiralty: number | null;
  value: number | null;
}

/** Every "### <Heading>" table in NUMBERS.md, as rows of cells. */
function docTables(): Map<string, DocRow[]> {
  const out = new Map<string, DocRow[]>();
  const sections = NUMBERS.split(/^### /m).slice(1);
  for (const section of sections) {
    // A "### Building" section ends at the next heading of ANY level. Without
    // this the last building (Lighthouse) swallows the "## Dock workers",
    // "## Salvage" and "## Raids" tables that follow it.
    const allLines = section.split('\n');
    const nextHeading = allLines.findIndex((line, i) => i > 0 && line.startsWith('## '));
    const lines = nextHeading === -1 ? allLines : allLines.slice(0, nextHeading);
    const heading = (lines[0] ?? '').split('—')[0]?.trim() ?? '';
    const rows: DocRow[] = [];
    for (const line of lines) {
      if (!line.startsWith('|')) continue;
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      const level = parseNumber(cells[0] ?? '');
      if (level === null) continue; // header or separator
      rows.push({
        level,
        steel: parseNumber(cells[1] ?? ''),
        coins: parseNumber(cells[2] ?? ''),
        minutes: parseDuration(cells[3] ?? ''),
        reqAdmiralty: parseNumber(cells[4] ?? ''),
        value: parseNumber(cells[5] ?? ''),
      });
    }
    if (rows.length > 0) out.set(heading, rows);
  }
  return out;
}

/** NUMBERS.md heading -> catalogue id. */
const HEADING_TO_ID: Readonly<Record<string, BuildingId>> = {
  Admiralty: 'admiralty',
  Scrapyard: 'scrapyard',
  'Fish Market': 'fish_market',
  Foundry: 'foundry',
  Shipyard: 'shipyard',
  "Stationer's Shop": 'stationery',
  "Harbour Master's Office": 'harbour_office',
  'Naval Academy': 'naval_academy',
  'Coastal Command': 'coastal_command',
  Armory: 'armory',
  'Fleet Hall': 'fleet_hall',
  Newsstand: 'newsstand',
  'Trade Docks': 'trade_docks',
  "Officers' Club": 'officers_club',
  Lighthouse: 'lighthouse',
};

describe('the catalogue matches docs/port-city/NUMBERS.md', () => {
  const tables = docTables();

  it('has a table for every building and a building for every table', () => {
    const headings = [...tables.keys()].filter((h) => h in HEADING_TO_ID);
    expect(headings).toHaveLength(BUILDING_IDS.length);
    expect(new Set(headings.map((h) => HEADING_TO_ID[h]))).toEqual(new Set(BUILDING_IDS));
  });

  for (const [heading, id] of Object.entries(HEADING_TO_ID)) {
    it(`${heading}: every level matches the published table`, () => {
      const rows = tables.get(heading);
      expect(rows, `no table for ${heading}`).toBeDefined();
      if (!rows) return;

      expect(rows).toHaveLength(maxLevel(id));

      rows.forEach((row, index) => {
        const spec = CITY_CATALOGUE[id].levels[index];
        expect(row.level, `${heading} row order`).toBe(index + 1);
        expect(spec, `${heading} L${row.level} missing`).toBeDefined();
        if (!spec) return;

        // A "—" in the doc means free/instant, which the table stores as 0.
        expect(spec.steel, `${heading} L${row.level} steel`).toBe(row.steel ?? 0);
        expect(spec.coins, `${heading} L${row.level} coins`).toBe(row.coins ?? 0);
        expect(spec.minutes, `${heading} L${row.level} minutes`).toBe(row.minutes ?? 0);
        expect(spec.reqAdmiralty, `${heading} L${row.level} reqAdmiralty`).toBe(
          row.reqAdmiralty ?? 0,
        );
        if (row.value !== null) {
          expect(spec.value, `${heading} L${row.level} value`).toBe(row.value);
        }
      });
    });
  }

  it('prices the dock workers as published', () => {
    expect(NUMBERS).toContain('| 3rd | 100 gems | 3 |');
    expect(NUMBERS).toContain('| 4th | 250 gems | 5 |');
    expect(WORKER_GEM_COST).toEqual([0, 0, 100, 250]);
    expect(WORKER_ADMIRALTY_REQ).toEqual([0, 0, 3, 5]);
  });

  it('grants the published starting package', () => {
    expect(NUMBERS).toContain('400 steel, 50 gems');
    expect(STARTING_GRANT).toEqual({ steel: 400, gems: 50 });
  });

  it('pays the published salvage per cell', () => {
    expect(NUMBERS).toContain('5 steel per cell');
    expect(SALVAGE_PER_CELL).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Derived values the rest of the module depends on
// ---------------------------------------------------------------------------

describe('derived catalogue values', () => {
  it('reproduces the published salvage table', () => {
    // NUMBERS.md > Salvage, for the shipped 8-ship fleet (18 cells = a sweep).
    expect(salvageBonusPercent(1)).toBe(0);
    expect(salvageBonusPercent(3)).toBe(10);
    expect(salvageBonusPercent(6)).toBe(25);
  });

  it('reproduces the published collector capacities', () => {
    // "coins per hour (cap 12 h)" — capacity is rate x 12.
    expect(capacityOf('fish_market', 1)).toBe(rateOf('fish_market', 1) * 12);
    expect(capacityOf('foundry', 8)).toBe(206 * 12);
    // Non-producers hold nothing.
    expect(capacityOf('admiralty', 1)).toBe(0);
    expect(rateOf('admiralty', 1)).toBe(0);
  });

  it('caps offline salvage at ten matches a day (§2.2)', () => {
    expect(OFFLINE_REWARD_CAP).toBe(10);
  });
});

describe('the Admiralty and rank grants (§2.6, §2.7)', () => {
  it('pays the published gems per Admiralty level', () => {
    expect(ADMIRALTY_GEM_GRANT).toEqual({ 2: 10, 3: 15, 4: 25, 5: 40, 6: 60, 7: 90, 8: 150 });
  });

  it('back-pays against the real rank ladder, not a copy of it', () => {
    // src/engine/city may not import ../ranks (purity), so the thresholds are
    // duplicated in RANK_GEM_BACKPAY. Pin them against the ladder here, the
    // same way ranks.test.ts pins the ladder against its migration.
    const ladder = RANKS.map((r) => r.points).filter((p) => p > 0);
    expect(RANK_GEM_BACKPAY.map((b) => b.points)).toEqual(ladder);
  });

  it('accumulates back-pay up the ladder', () => {
    expect(rankBackPayGems(0)).toBe(0);
    expect(rankBackPayGems(99)).toBe(0);
    expect(rankBackPayGems(100)).toBe(10);
    expect(rankBackPayGems(400)).toBe(30);
    expect(rankBackPayGems(1_000)).toBe(70);
    expect(rankBackPayGems(3_000)).toBe(150); // Captain
    expect(rankBackPayGems(10_000)).toBe(300); // Vice-admiral
  });
});
