/**
 * The defence editor's brain — part-07 §2.
 *
 * `app/(game)/placement.tsx` is 1,654 lines of drag, halo and preview logic
 * that the harbour editor reuses WHOLESALE. What it does not have is a
 * harbour's budget, caps, save call and read-only rule, and putting those
 * inline would have added a fifth concern to a file that already has four.
 *
 * So the screen calls one hook and renders what it returns. Everything the
 * hook decides is either a pure function from `defenceBudget.ts` or a server
 * response — there is no rule in here.
 */
import { useCallback, useEffect, useState } from 'react';

import { harbourFuelFor } from '@engine/raid';
import { unlockedSeasFor, type SeaId } from '@engine/terrain';
import type { ArsenalItem, Ship } from '@engine/types';

import { useCity } from '@/city/store';
import type { CitySnapshot } from '@/city/types';
import { usePlacement } from '@/state/placement';

import { getHarbour, saveHarbour as saveHarbourApi } from '../api';
import { useRaid } from '../store';
import { RaidApiError, type RaidApiErrorCode } from '../types';
import { harbourCapTable, harbourShopKinds } from './defenceBudget';
import { harbourErrorLine, raidErrorLine } from './captainCopy';

export interface HarbourEditor {
  /** §2 — read-only while a raid on you is running. */
  readonly readOnly: boolean;
  readonly saving: boolean;
  /** A Captain line, already translated. Null when there is nothing to say. */
  readonly saveError: string | null;
  readonly saveHarbourLayout: () => void;
  readonly dismissSaveError: () => void;
  /** §1 — the Captain line for a harbour the dockyard laid out. */
  readonly neverEdited: boolean;
}

export interface HarbourLevels {
  readonly coastalCommandLevel: number;
  readonly unlocks: readonly string[];
  /** Part 10B — the Lighthouse level, which gates the harbour's sea. */
  readonly lighthouseLevel: number;
}

/**
 * Levels come from the city store, which Part 1 already keeps in sync. Read
 * defensively: a player who has never opened the city has no snapshot, and
 * the editor must still open — with a zero budget, which is honest, rather
 * than a match's 260, which would be a lie the server then rejects.
 */
export function harbourLevelsFromCity(snapshot: CitySnapshot | null): HarbourLevels {
  const buildings = snapshot?.city?.buildings as
    | Record<string, { level?: number }>
    | undefined;
  void buildings;
  const level = (id: string) => buildings?.[id]?.level ?? 0;
  return {
    coastalCommandLevel: level('coastal_command'),
    // part-05 §5 — the researched items, from the city snapshot. This replaced
    // DECISIONS D23's stand-in ("a built Academy unlocks all three") when the
    // research queue landed; the server reads the same column.
    unlocks: snapshot?.unlocks ?? [],
    // Part 10B — the seas this harbour may defend on.
    lighthouseLevel: level('lighthouse'),
  };
}

export function useHarbourEditor(active: boolean, seed: number): HarbourEditor {
  const [readOnly, setReadOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const harbourEdited = useRaid((state) => state.harbourEdited);

  // ---- open on the harbour the server has, at the harbour's budget --------
  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const levels = harbourLevelsFromCity(useCity.getState().snapshot);

    // Set the budget and the shop BEFORE the fetch, so a slow connection
    // shows an editable board with the right chip rather than a match's 260.
    usePlacement.getState().initialize('harbour', seed, 'advanced', {
      fuelBudget: harbourFuelFor(levels.coastalCommandLevel),
      allowedKinds: harbourShopKinds(),
      kindCaps: harbourCapTable(levels.coastalCommandLevel),
      fuelLabel: 'Harbour fuel',
      // Part 10B — the Lighthouse unlocks the picker; the saved layout's own
      // sea is adopted when it arrives.
      unlockedSeas: [...unlockedSeasFor(levels.lighthouseLevel)],
    });

    void getHarbour()
      .then((response) => {
        if (cancelled) return;
        const ships = response.layout.ships as readonly Ship[];
        const arsenal = response.layout.arsenal as readonly ArsenalItem[];
        usePlacement.getState().loadLayout(ships, arsenal, response.layout.sea as SeaId | undefined);
        useRaid.getState().setHarbour(response.layout, response.serverNow);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // §2 — a harbour we could not read is not an editable one. The board
        // the store already holds stays on screen, read-only, with the reason.
        if (error instanceof RaidApiError && error.code === 'raid-in-progress') {
          setReadOnly(true);
          return;
        }
        setSaveError(raidErrorLine(codeOf(error)));
      });

    return () => {
      cancelled = true;
    };
  }, [active, seed]);

  // ---- save ---------------------------------------------------------------
  const saveHarbourLayout = useCallback(() => {
    if (readOnly || saving) return;
    const state = usePlacement.getState();
    setSaving(true);
    setSaveError(null);

    void saveHarbourApi({ ships: state.ships, arsenal: state.arsenal, sea: state.seaId })
      .then(() => {
        useRaid.getState().setHarbour(
          { ships: state.ships, arsenal: state.arsenal, sea: state.seaId },
          Date.now(),
        );
        useRaid.getState().markHarbourEdited();
      })
      .catch((error: unknown) => {
        // §2.3 — "invalid-layout errors map to Captain lines". The server's
        // `detail` carries the engine's HarbourError, which has its own copy.
        const code = codeOf(error);
        const detail = error instanceof RaidApiError ? error.detail : undefined;
        setSaveError(
          code === 'bad-harbour' && detail ? harbourErrorLine(firstWord(detail)) : raidErrorLine(code),
        );
      })
      .finally(() => setSaving(false));
  }, [readOnly, saving]);

  return {
    readOnly,
    saving,
    saveError,
    saveHarbourLayout,
    dismissSaveError: useCallback(() => setSaveError(null), []),
    neverEdited: !harbourEdited,
  };
}

function codeOf(error: unknown): RaidApiErrorCode {
  return error instanceof RaidApiError ? error.code : 'internal';
}

/** The server's detail reads "over-cap: mine: max 3 ...", so the code is first. */
function firstWord(detail: string): string {
  return detail.split(':')[0]?.trim() ?? detail;
}
