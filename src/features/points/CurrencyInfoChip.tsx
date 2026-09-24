/**
 * A balance chip that opens the shared explanation sheet.
 *
 * This is the one place the behaviour lives: the menu, the city HUD and any
 * future header render this instead of CurrencyChip directly, so every
 * displayed balance explains itself the same way. Steel has no verified
 * explanation and falls through to the plain, non-interactive chip.
 */
import { currencyInfoFor } from '@/data/currencies';
import { useCurrencyInfo } from '@/state/currencyInfo';
import { CurrencyChip, type CurrencyChipProps } from '@/ui/CurrencyChip';

export function CurrencyInfoChip(props: CurrencyChipProps) {
  const info = currencyInfoFor(props.kind);
  const openCurrency = useCurrencyInfo((state) => state.openCurrency);
  if (!info) return <CurrencyChip {...props} />;
  return (
    <CurrencyChip
      {...props}
      onPress={() => openCurrency(info.id)}
      accessibilityLabel={`About ${info.name}`}
    />
  );
}
