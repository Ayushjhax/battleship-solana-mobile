/**
 * Which currency explanation is open. A module store rather than screen
 * state: the same chip opens the same sheet from the menu, the city HUD and
 * anywhere else, and the sheet is mounted once at the root so it can never be
 * clipped by the chip's own layout.
 */
import { create } from 'zustand';

import type { CurrencyId } from '../data/currencies';

interface CurrencyInfoState {
  open: CurrencyId | null;
  openCurrency: (id: CurrencyId) => void;
  closeCurrency: () => void;
}

export const useCurrencyInfo = create<CurrencyInfoState>((set) => ({
  open: null,
  openCurrency: (id) => set({ open: id }),
  closeCurrency: () => set({ open: null }),
}));
