/**
 * The twenty countries a captain can sail under, in the picker's order. The
 * profile keeps the ISO 3166 code (profiles.country_code); a code outside
 * this list still shows: RU (the practice admiral's) has a badge of its
 * own, anything else its letters on a blank badge.
 */
export interface Country {
  readonly code: string;
  readonly name: string;
}

export const COUNTRIES: readonly Country[] = [
  { code: 'BR', name: 'Brazil' },
  { code: 'CA', name: 'Canada' },
  { code: 'CN', name: 'China' },
  { code: 'CO', name: 'Colombia' },
  { code: 'DE', name: 'Germany' },
  { code: 'IN', name: 'India' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'IR', name: 'Iran' },
  { code: 'IT', name: 'Italy' },
  { code: 'JP', name: 'Japan' },
  { code: 'MX', name: 'Mexico' },
  { code: 'PH', name: 'Philippines' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'KR', name: 'South Korea' },
  { code: 'ES', name: 'Spain' },
  { code: 'TH', name: 'Thailand' },
  { code: 'TR', name: 'Turkey' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
  { code: 'VN', name: 'Vietnam' },
];

/** Flags that show but aren't offered: the practice admiral and the seeded bots are RU. */
const OTHER_NAMES: Readonly<Record<string, string>> = { RU: 'Russia' };

export function countryName(code: string | null | undefined): string {
  const upper = (code ?? '').toUpperCase();
  return (
    COUNTRIES.find((c) => c.code === upper)?.name ??
    OTHER_NAMES[upper] ??
    (upper || 'Unknown waters')
  );
}
