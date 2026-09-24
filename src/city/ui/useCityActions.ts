/**
 * The one place the city screen talks to the server.
 *
 * Two rules it exists to hold:
 *   - a double tap must call an endpoint ONCE (§11.4), so every action is
 *     guarded by an in-flight ref keyed on what it acts upon;
 *   - the HUD number after a collect is the SERVER's, never a local sum (§12.1)
 *     — the store is only ever fed a whole response.
 */
import { useCallback, useRef, useState } from 'react';

import { haptic } from '@/audio/haptics';
import { playSfx } from '@/audio/sfx';
import type { BuildingId } from '@engine/city';
import {
  buildBuilding,
  buyDockWorker,
  cancelBuilding,
  collectAllBuildings,
  collectBuilding,
  getCity,
  speedUpBuilding,
} from '../api';
import { useCity } from '../store';
import { CityApiError, type CityApiErrorCode } from '../types';

export interface CityActions {
  readonly busy: boolean;
  readonly lastError: { code: CityApiErrorCode; buildingId?: BuildingId } | null;
  clearError: () => void;
  refresh: () => Promise<void>;
  build: (id: BuildingId) => Promise<boolean>;
  speedUp: (id: BuildingId) => Promise<boolean>;
  cancel: (id: BuildingId) => Promise<boolean>;
  collect: (id: BuildingId) => Promise<boolean>;
  collectAll: () => Promise<boolean>;
  buyWorker: () => Promise<boolean>;
}

export function useCityActions(): CityActions {
  const inFlight = useRef(new Set<string>());
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState<CityActions['lastError']>(null);

  const run = useCallback(
    async (
      key: string,
      call: () => Promise<{ city: unknown; serverNow: number }>,
      buildingId?: BuildingId,
    ): Promise<boolean> => {
      // §11.4 — the second tap of a double tap is dropped here.
      if (inFlight.current.has(key)) return false;
      inFlight.current.add(key);
      setBusy(true);
      try {
        const response = await call();
        useCity.getState().applyResponse(response as never);
        setLastError(null);
        return true;
      } catch (error) {
        const code = error instanceof CityApiError ? error.code : 'internal';
        setLastError({ code, ...(buildingId ? { buildingId } : {}) });
        useCity.getState().setError(code);
        haptic('invalidAction');
        return false;
      } finally {
        inFlight.current.delete(key);
        setBusy(inFlight.current.size > 0);
      }
    },
    [],
  );

  return {
    busy,
    lastError,
    clearError: useCallback(() => setLastError(null), []),
    refresh: useCallback(async () => {
      await run('refresh', getCity);
    }, [run]),
    build: useCallback(
      (id) => {
        haptic('buttonPress');
        playSfx('penScratchShort');
        return run(`build:${id}`, () => buildBuilding(id), id);
      },
      [run],
    ),
    speedUp: useCallback(
      (id) => {
        haptic('buttonPress');
        return run(`speedup:${id}`, () => speedUpBuilding(id), id);
      },
      [run],
    ),
    cancel: useCallback(
      (id) => {
        haptic('buttonPress');
        return run(`cancel:${id}`, () => cancelBuilding(id), id);
      },
      [run],
    ),
    collect: useCallback(
      (id) => {
        haptic('shipPlaced');
        return run(`collect:${id}`, () => collectBuilding(id), id);
      },
      [run],
    ),
    collectAll: useCallback(() => {
      haptic('shipPlaced');
      return run('collect-all', () => collectAllBuildings());
    }, [run]),
    buyWorker: useCallback(() => {
      haptic('buttonPress');
      return run('buy-worker', () => buyDockWorker());
    }, [run]),
  };
}
