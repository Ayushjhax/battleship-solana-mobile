/**
 * The image registry. Source art is dropped into assets/images/ (docs/assets.md
 * section 3); `npm run assets` turns every line-art PNG into a pure-black alpha
 * mask under assets/ink/, which is what the app requires here so that
 * <AssetSlot>'s tintColor renders it as ink on paper. Metro needs every
 * `require` target to exist at bundle time, so an asset that has not landed yet
 * stays `null` and the slot draws a labelled placeholder at the declared size.
 */
import type { ImageSource } from 'expo-image';

export type Asset = ImageSource | number | null;

export const BRAND = {
  logo: require('../../assets/ink/brand/logo.png') as Asset,
  appIcon: require('../../assets/ink/brand/icon.png') as Asset,
} as const;

export const BOARD_ART = {
  /** The only photo in the game — not tinted, drawn under the sheet. */
  deskWood: require('../../assets/images/board/desk-wood.jpg') as Asset,
  watermarkKraken: require('../../assets/ink/board/watermark-kraken.png') as Asset,
  watermarkTiger: require('../../assets/ink/board/watermark-tiger.png') as Asset,
  watermarkAnchor: require('../../assets/ink/board/watermark-anchor.png') as Asset,
} as const;

/** All four face left, horizontal; ShipSprite rotates for vertical placement. */
export const SHIPS = {
  battleship: require('../../assets/ink/ships/ship-battleship.png') as Asset,
  cruiser: require('../../assets/ink/ships/ship-cruiser.png') as Asset,
  destroyer: require('../../assets/ink/ships/ship-destroyer.png') as Asset,
  boat: require('../../assets/ink/ships/ship-boat.png') as Asset,
} as const;

export const ARSENAL = {
  aaGun: require('../../assets/ink/arsenal/arsenal-aa-gun.png') as Asset,
  radar: require('../../assets/ink/arsenal/arsenal-radar.png') as Asset,
  mine: require('../../assets/ink/arsenal/arsenal-mine.png') as Asset,
  submarine: require('../../assets/ink/arsenal/arsenal-submarine.png') as Asset,
  bomber: require('../../assets/ink/arsenal/arsenal-bomber.png') as Asset,
  torpedoBomber: require('../../assets/ink/arsenal/arsenal-torpedo-bomber.png') as Asset,
  doubleTorpedoBomber: require('../../assets/ink/arsenal/arsenal-double-torpedo-bomber.png') as Asset,
  atomicBomber: require('../../assets/ink/arsenal/arsenal-atomic-bomber.png') as Asset,
} as const;

/** Flight sprites face right; FxLayer rotates 180deg for right-to-left runs. */
export const FX = {
  planeBomber: require('../../assets/ink/fx/plane-bomber.png') as Asset,
  planeTorpedo: require('../../assets/ink/fx/plane-torpedo.png') as Asset,
  planeAtomic: require('../../assets/ink/fx/plane-atomic.png') as Asset,
  planeDowned: require('../../assets/ink/fx/plane-downed.png') as Asset,
  explosionSheet: null as Asset, // require('../../assets/ink/fx/explosion-sheet.png')
  splashSheet: null as Asset, // require('../../assets/ink/fx/splash-sheet.png')
  // The dropped smoke-puff.png is a speed-streak glyph, not a cloud; the drawn
  // puff over a wreck reads better until a real one lands.
  smokePuff: null as Asset, // require('../../assets/ink/fx/smoke-puff.png')
} as const;

export const AVATARS = {
  1: require('../../assets/ink/avatars/avatar-1.png') as Asset,
  2: require('../../assets/ink/avatars/avatar-2.png') as Asset,
  3: require('../../assets/ink/avatars/avatar-3.png') as Asset,
  4: require('../../assets/ink/avatars/avatar-4.png') as Asset,
  captain: require('../../assets/ink/avatars/captain.png') as Asset,
} as const;

export const UI_ART = {
  handPointer: require('../../assets/ink/ui/hand-pointer.png') as Asset,
  cityPort: require('../../assets/ink/city/city-port.png') as Asset,
} as const;

/** Eight ink stickers: thumbs-up, laughing, angry, crying, salute, skull, question, fire. */
export const EMOTES: readonly { id: number; label: string; source: Asset }[] = [
  { id: 1, label: 'thumbs-up', source: require('../../assets/ink/ui/emote-01.png') },
  { id: 2, label: 'laughing', source: require('../../assets/ink/ui/emote-02.png') },
  { id: 3, label: 'angry', source: require('../../assets/ink/ui/emote-03.png') },
  { id: 4, label: 'crying', source: require('../../assets/ink/ui/emote-04.png') },
  { id: 5, label: 'salute', source: require('../../assets/ink/ui/emote-05.png') },
  { id: 6, label: 'skull', source: require('../../assets/ink/ui/emote-06.png') },
  { id: 7, label: 'question', source: require('../../assets/ink/ui/emote-07.png') },
  { id: 8, label: 'fire', source: require('../../assets/ink/ui/emote-08.png') },
];
