/**
 * The image registry. Metro needs every `require` target to exist at bundle
 * time, so an asset that has not landed yet is `null` here and <AssetSlot>
 * draws a labelled placeholder at the declared size. When a file from
 * docs/assets.md section 3 lands, swap its `null` for the require() in the
 * comment — nothing else in the app changes.
 */
import type { ImageSource } from 'expo-image';

export type Asset = ImageSource | number | null;

export const BRAND = {
  logo: null as Asset, // require('../../assets/images/brand/logo.png')
  appIcon: require('../../assets/images/brand/app-icon.png') as Asset,
} as const;

export const BOARD_ART = {
  deskWood: null as Asset, // require('../../assets/images/board/desk-wood.jpg')
  watermarkKraken: null as Asset, // require('../../assets/images/board/watermark-kraken.png')
  watermarkTiger: null as Asset, // require('../../assets/images/board/watermark-tiger.png')
  watermarkAnchor: null as Asset, // require('../../assets/images/board/watermark-anchor.png')
} as const;

/** All four face left, horizontal; ShipSprite rotates for vertical placement. */
export const SHIPS = {
  battleship: null as Asset, // require('../../assets/images/ships/ship-battleship.png')
  cruiser: null as Asset, // require('../../assets/images/ships/ship-cruiser.png')
  destroyer: null as Asset, // require('../../assets/images/ships/ship-destroyer.png')
  boat: null as Asset, // require('../../assets/images/ships/ship-boat.png')
} as const;

export const ARSENAL = {
  aaGun: null as Asset, // require('../../assets/images/arsenal/arsenal-aa-gun.png')
  radar: null as Asset, // require('../../assets/images/arsenal/arsenal-radar.png')
  mine: null as Asset, // require('../../assets/images/arsenal/arsenal-mine.png')
  submarine: null as Asset, // require('../../assets/images/arsenal/arsenal-submarine.png')
  bomber: null as Asset, // require('../../assets/images/arsenal/arsenal-bomber.png')
  torpedoBomber: null as Asset, // require('../../assets/images/arsenal/arsenal-torpedo-bomber.png')
  doubleTorpedoBomber: null as Asset, // require('../../assets/images/arsenal/arsenal-double-torpedo-bomber.png')
  atomicBomber: null as Asset, // require('../../assets/images/arsenal/arsenal-atomic-bomber.png')
} as const;

export const FX = {
  planeBomber: null as Asset, // require('../../assets/images/fx/plane-bomber.png')
  planeTorpedo: null as Asset, // require('../../assets/images/fx/plane-torpedo.png')
  planeAtomic: null as Asset, // require('../../assets/images/fx/plane-atomic.png')
  planeDowned: null as Asset, // require('../../assets/images/fx/plane-downed.png')
  explosionSheet: null as Asset, // require('../../assets/images/fx/explosion-sheet.png')
  splashSheet: null as Asset, // require('../../assets/images/fx/splash-sheet.png')
  smokePuff: null as Asset, // require('../../assets/images/fx/smoke-puff.png')
} as const;

export const AVATARS = {
  1: null as Asset, // require('../../assets/images/avatars/avatar-1.png')
  2: null as Asset, // require('../../assets/images/avatars/avatar-2.png')
  3: null as Asset, // require('../../assets/images/avatars/avatar-3.png')
  4: null as Asset, // require('../../assets/images/avatars/avatar-4.png')
  captain: null as Asset, // require('../../assets/images/avatars/captain.png')
} as const;

export const UI_ART = {
  handPointer: null as Asset, // require('../../assets/images/ui/hand-pointer.png')
  cityPort: null as Asset, // require('../../assets/images/city/city-port.png')
} as const;

/** Eight ink stickers: thumbs-up, laughing, angry, crying, salute, skull, question, fire. */
export const EMOTES: readonly { id: number; label: string; source: Asset }[] = [
  { id: 1, label: 'thumbs-up', source: null }, // require('../../assets/images/ui/emote-01.png')
  { id: 2, label: 'laughing', source: null }, // require('../../assets/images/ui/emote-02.png')
  { id: 3, label: 'angry', source: null }, // require('../../assets/images/ui/emote-03.png')
  { id: 4, label: 'crying', source: null }, // require('../../assets/images/ui/emote-04.png')
  { id: 5, label: 'salute', source: null }, // require('../../assets/images/ui/emote-05.png')
  { id: 6, label: 'skull', source: null }, // require('../../assets/images/ui/emote-06.png')
  { id: 7, label: 'question', source: null }, // require('../../assets/images/ui/emote-07.png')
  { id: 8, label: 'fire', source: null }, // require('../../assets/images/ui/emote-08.png')
];
