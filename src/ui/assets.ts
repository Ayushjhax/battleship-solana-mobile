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
  /** The full-colour lockup (cap, ribbon, tagline) — drawn as-is, never tinted. */
  wordmark: require('../../assets/images/background/logo.png') as Asset,
} as const;

/**
 * The commissioned panel skin from the name-screen art set (docs/assets.md) —
 * a torn cream sheet with its own scribbled ink border, for <ImagePanel> in
 * place of InkPanel's Rough.js frame. Used wherever this specific look was
 * asked for, not just on the name screen.
 */
export const PAPER_PANEL = require('../../assets/images/name-screen/paper-panel.png') as Asset;

/**
 * Full-bleed illustrated page backdrops — photos, not line art, so they are
 * drawn as-is instead of going through the ink-mask pipeline.
 * scripts/color-assets.sh builds these JPEGs from assets/images/background/.
 * <Scale> layers them over PaperBackdrop via backgroundImage, which stays the
 * fallback if an asset is ever missing.
 */
export const BACKGROUNDS = {
  splash: require('../../assets/backgrounds/first_page.jpg') as Asset,
  logoReveal: require('../../assets/backgrounds/logo_background.jpg') as Asset,
  menu: require('../../assets/backgrounds/first_page.jpg') as Asset,
  result: require('../../assets/backgrounds/decision.jpg') as Asset,
  identity: require('../../assets/backgrounds/name_background.jpg') as Asset,
  chooseIcon: require('../../assets/backgrounds/choose_icon.jpg') as Asset,
  matchFound: require('../../assets/backgrounds/match_started.jpg') as Asset,
  settings: require('../../assets/backgrounds/settings.jpg') as Asset,
  login: require('../../assets/backgrounds/match_time.jpg') as Asset,
  nameEntry: require('../../assets/backgrounds/logo_background.jpg') as Asset,
  welcome: require('../../assets/backgrounds/name_background.jpg') as Asset,
} as const;

/** A button or field cut into three by scripts/color-assets.sh, for <SlicedImage>. */
export interface Slices {
  left: Asset;
  mid: Asset;
  right: Asset;
}

/** A panel cut into three top to bottom by scripts/color-assets.sh, for <VSlicedImage>. */
export interface VSlices {
  top: Asset;
  mid: Asset;
  bottom: Asset;
}

/**
 * The sign-in screen's art (assets/images/login-assets), drawn as-is. Buttons
 * and fields are the cut versions in assets/login/, which carry no baked label.
 */
export const LOGIN_ART = {
  panel: require('../../assets/images/login-assets/login-panel.png') as Asset,
  logo: require('../../assets/images/login-assets/empire-of-bits-logo.png') as Asset,
  title: require('../../assets/images/login-assets/captains-login-title.png') as Asset,
  chooseTitle: require('../../assets/images/login-assets/choose-sign-in-title.png') as Asset,
  anchorDivider: require('../../assets/images/login-assets/anchor-divider.png') as Asset,
  sailingShip: require('../../assets/images/login-assets/sailing-ship.png') as Asset,
  messageBottle: require('../../assets/images/login-assets/message-bottle.png') as Asset,
  parchmentScroll: require('../../assets/images/login-assets/parchment-scroll.png') as Asset,
  compass: require('../../assets/images/login-assets/compass.png') as Asset,
  crown: require('../../assets/images/login-assets/crown.png') as Asset,
  seagullLarge: require('../../assets/images/login-assets/seagull-large.png') as Asset,
  seagullSmall: require('../../assets/images/login-assets/seagull-small.png') as Asset,
  google: {
    left: require('../../assets/login/google-sign-in-button-l.png'),
    mid: require('../../assets/login/google-sign-in-button-m.png'),
    right: require('../../assets/login/google-sign-in-button-r.png'),
  } as Slices,
  confirm: {
    left: require('../../assets/login/sign-in-button-l.png'),
    mid: require('../../assets/login/sign-in-button-m.png'),
    right: require('../../assets/login/sign-in-button-r.png'),
  } as Slices,
  changeEmail: {
    left: require('../../assets/login/change-email-button-l.png'),
    mid: require('../../assets/login/change-email-button-m.png'),
    right: require('../../assets/login/change-email-button-r.png'),
  } as Slices,
  resend: {
    left: require('../../assets/login/resend-button-l.png'),
    mid: require('../../assets/login/resend-button-m.png'),
    right: require('../../assets/login/resend-button-r.png'),
  } as Slices,
  emailInput: {
    left: require('../../assets/login/email-input-l.png'),
    mid: require('../../assets/login/email-input-m.png'),
    right: require('../../assets/login/email-input-r.png'),
  } as Slices,
  codeInput: {
    left: require('../../assets/login/code-input-l.png'),
    mid: require('../../assets/login/code-input-m.png'),
    right: require('../../assets/login/code-input-r.png'),
  } as Slices,
} as const;

/**
 * The main menu's colour art — drawn as-is, never tinted. The glyphs and the
 * play-card paintings are built into assets/menu/ by scripts/menu-assets.sh;
 * the captain and settings icons keep their own tiles, so they come straight
 * from assets/images/app-icons/.
 */
export const MENU_ART = {
  playOnline: require('../../assets/menu/play-online.jpg') as Asset,
  playOffline: require('../../assets/menu/play-offline.jpg') as Asset,
  captain: require('../../assets/images/app-icons/captain.png') as Asset,
  settings: require('../../assets/images/app-icons/settings.png') as Asset,
  coin: require('../../assets/menu/icons/coin.png') as Asset,
  gem: require('../../assets/menu/icons/gem.png') as Asset,
  star: require('../../assets/menu/icons/star.png') as Asset,
  rank: require('../../assets/menu/icons/rank.png') as Asset,
  play: require('../../assets/menu/icons/play.png') as Asset,
  friends: require('../../assets/menu/icons/friends.png') as Asset,
  rulebook: require('../../assets/menu/icons/rulebook.png') as Asset,
  trophy: require('../../assets/menu/icons/trophy.png') as Asset,
  harbor: require('../../assets/menu/icons/harbor.png') as Asset,
  shop: require('../../assets/menu/icons/shop.png') as Asset,
  coinStacks: require('../../assets/menu/icons/coin-stacks.png') as Asset,
  speaker: require('../../assets/menu/icons/speaker.png') as Asset,
  wallet: require('../../assets/menu/icons/wallet.png') as Asset,
} as const;

/**
 * The welcome reward (assets/images/welcome-reward-assets). The panel ships
 * complete — frame, titles, coins, waves and its Claim button baked in — and is
 * the only file with the rope-and-medallion frame, so it is drawn whole.
 * `claimButton` is the same button exported alone, at the same scale; it sits
 * exactly on the baked one (panel px 287,432) as the press silhouette.
 */
export const WELCOME_ART = {
  panel: require('../../assets/images/welcome-reward-assets/reward-panel-complete.png') as Asset,
  claimButton: require('../../assets/images/welcome-reward-assets/claim-reward-button.png') as Asset,
  seagulls: [
    require('../../assets/images/welcome-reward-assets/seagull-01.png') as Asset,
    require('../../assets/images/welcome-reward-assets/seagull-02.png') as Asset,
    require('../../assets/images/welcome-reward-assets/seagull-03.png') as Asset,
    require('../../assets/images/welcome-reward-assets/seagull-04.png') as Asset,
  ],
} as const;

/** The name screen (assets/images/name-screen); the field is the cut version in assets/name/. */
export const NAME_ART = {
  logo: require('../../assets/images/name-screen/empire-of-bits-logo.png') as Asset,
  tape: require('../../assets/images/name-screen/blue-tape.png') as Asset,
  close: require('../../assets/images/name-screen/close-button.png') as Asset,
  label: require('../../assets/images/name-screen/enter-your-name-label.png') as Asset,
  emphasis: require('../../assets/images/name-screen/red-emphasis.png') as Asset,
  placeholder: require('../../assets/images/name-screen/captain-placeholder.png') as Asset,
  cursor: require('../../assets/images/name-screen/text-cursor.png') as Asset,
  save: require('../../assets/images/name-screen/save-button.png') as Asset,
  greatCaptainQuote: require('../../assets/images/name-screen/great-captain-quote.png') as Asset,
  differentCaptainsQuote: require('../../assets/images/name-screen/different-captains-quote.png') as Asset,
  strategyNote: require('../../assets/images/name-screen/strategy-note.png') as Asset,
  input: {
    left: require('../../assets/name/name-input-l.png'),
    mid: require('../../assets/name/name-input-m.png'),
    right: require('../../assets/name/name-input-r.png'),
  } as Slices,
} as const;

/**
 * The drawn keyboard (assets/images/keyboard). Glyph keys come from
 * assets/keyboard/ with their glyph erased, so the keyboard draws its own
 * (capitals under shift, digits on the 123 layer); icon keys are drawn as-is.
 */
export const KEYBOARD_ART = {
  blank: {
    a: require('../../assets/keyboard/key-a.png') as Asset,
    b: require('../../assets/keyboard/key-b.png') as Asset,
    c: require('../../assets/keyboard/key-c.png') as Asset,
    d: require('../../assets/keyboard/key-d.png') as Asset,
    e: require('../../assets/keyboard/key-e.png') as Asset,
    f: require('../../assets/keyboard/key-f.png') as Asset,
    g: require('../../assets/keyboard/key-g.png') as Asset,
    h: require('../../assets/keyboard/key-h.png') as Asset,
    i: require('../../assets/keyboard/key-i.png') as Asset,
    j: require('../../assets/keyboard/key-j.png') as Asset,
    k: require('../../assets/keyboard/key-k.png') as Asset,
    l: require('../../assets/keyboard/key-l.png') as Asset,
    m: require('../../assets/keyboard/key-m.png') as Asset,
    n: require('../../assets/keyboard/key-n.png') as Asset,
    o: require('../../assets/keyboard/key-o.png') as Asset,
    p: require('../../assets/keyboard/key-p.png') as Asset,
    q: require('../../assets/keyboard/key-q.png') as Asset,
    r: require('../../assets/keyboard/key-r.png') as Asset,
    s: require('../../assets/keyboard/key-s.png') as Asset,
    t: require('../../assets/keyboard/key-t.png') as Asset,
    u: require('../../assets/keyboard/key-u.png') as Asset,
    v: require('../../assets/keyboard/key-v.png') as Asset,
    w: require('../../assets/keyboard/key-w.png') as Asset,
    x: require('../../assets/keyboard/key-x.png') as Asset,
    y: require('../../assets/keyboard/key-y.png') as Asset,
    z: require('../../assets/keyboard/key-z.png') as Asset,
    hyphen: require('../../assets/keyboard/key-hyphen.png') as Asset,
    underscore: require('../../assets/keyboard/key-underscore.png') as Asset,
    plus: require('../../assets/keyboard/key-plus.png') as Asset,
    apostrophe: require('../../assets/keyboard/key-apostrophe.png') as Asset,
    at: require('../../assets/keyboard/key-at.png') as Asset,
    period: require('../../assets/keyboard/key-period.png') as Asset,
    comma: require('../../assets/keyboard/key-comma.png') as Asset,
    numbers: require('../../assets/keyboard/key-numbers.png') as Asset,
  },
  shift: require('../../assets/images/keyboard/key-shift.png') as Asset,
  backspace: require('../../assets/images/keyboard/key-backspace.png') as Asset,
  enter: require('../../assets/images/keyboard/key-enter.png') as Asset,
  language: require('../../assets/images/keyboard/key-language.png') as Asset,
  space: require('../../assets/images/keyboard/key-space.png') as Asset,
} as const;

export type KeyFace = keyof typeof KEYBOARD_ART.blank;

/**
 * The avatar screen (assets/images/avatar-screen). Each portrait comes in every
 * AVATAR_TINTS colour, built by scripts/color-assets.sh: the uniform recoloured,
 * face, insignia and sea untouched. PORTRAITS[id][i] wears AVATAR_TINTS[i].
 */
export const AVATAR_SCREEN_ART = {
  portraits: {
    1: [
      require('../../assets/avatars/avatar-1-0.webp') as Asset,
      require('../../assets/avatars/avatar-1-1.webp') as Asset,
      require('../../assets/avatars/avatar-1-2.webp') as Asset,
      require('../../assets/avatars/avatar-1-3.webp') as Asset,
      require('../../assets/avatars/avatar-1-4.webp') as Asset,
      require('../../assets/avatars/avatar-1-5.webp') as Asset,
      require('../../assets/avatars/avatar-1-6.webp') as Asset,
      require('../../assets/avatars/avatar-1-7.webp') as Asset,
      require('../../assets/avatars/avatar-1-8.webp') as Asset,
      require('../../assets/avatars/avatar-1-9.webp') as Asset,
    ],
    2: [
      require('../../assets/avatars/avatar-2-0.webp') as Asset,
      require('../../assets/avatars/avatar-2-1.webp') as Asset,
      require('../../assets/avatars/avatar-2-2.webp') as Asset,
      require('../../assets/avatars/avatar-2-3.webp') as Asset,
      require('../../assets/avatars/avatar-2-4.webp') as Asset,
      require('../../assets/avatars/avatar-2-5.webp') as Asset,
      require('../../assets/avatars/avatar-2-6.webp') as Asset,
      require('../../assets/avatars/avatar-2-7.webp') as Asset,
      require('../../assets/avatars/avatar-2-8.webp') as Asset,
      require('../../assets/avatars/avatar-2-9.webp') as Asset,
    ],
    3: [
      require('../../assets/avatars/avatar-3-0.webp') as Asset,
      require('../../assets/avatars/avatar-3-1.webp') as Asset,
      require('../../assets/avatars/avatar-3-2.webp') as Asset,
      require('../../assets/avatars/avatar-3-3.webp') as Asset,
      require('../../assets/avatars/avatar-3-4.webp') as Asset,
      require('../../assets/avatars/avatar-3-5.webp') as Asset,
      require('../../assets/avatars/avatar-3-6.webp') as Asset,
      require('../../assets/avatars/avatar-3-7.webp') as Asset,
      require('../../assets/avatars/avatar-3-8.webp') as Asset,
      require('../../assets/avatars/avatar-3-9.webp') as Asset,
    ],
    4: [
      require('../../assets/avatars/avatar-4-0.webp') as Asset,
      require('../../assets/avatars/avatar-4-1.webp') as Asset,
      require('../../assets/avatars/avatar-4-2.webp') as Asset,
      require('../../assets/avatars/avatar-4-3.webp') as Asset,
      require('../../assets/avatars/avatar-4-4.webp') as Asset,
      require('../../assets/avatars/avatar-4-5.webp') as Asset,
      require('../../assets/avatars/avatar-4-6.webp') as Asset,
      require('../../assets/avatars/avatar-4-7.webp') as Asset,
      require('../../assets/avatars/avatar-4-8.webp') as Asset,
      require('../../assets/avatars/avatar-4-9.webp') as Asset,
    ],
  } as Record<1 | 2 | 3 | 4, readonly Asset[]>,
  /** The swatch art, in AVATAR_TINTS' order. */
  swatches: [
    require('../../assets/images/avatar-screen/color-royal-blue.png') as Asset,
    require('../../assets/images/avatar-screen/color-brown.png') as Asset,
    require('../../assets/images/avatar-screen/color-black.png') as Asset,
    require('../../assets/images/avatar-screen/color-teal.png') as Asset,
    require('../../assets/images/avatar-screen/color-orange.png') as Asset,
    require('../../assets/images/avatar-screen/color-red.png') as Asset,
    require('../../assets/images/avatar-screen/color-blue.png') as Asset,
    require('../../assets/images/avatar-screen/color-purple.png') as Asset,
    require('../../assets/images/avatar-screen/color-green.png') as Asset,
    require('../../assets/images/avatar-screen/color-slate.png') as Asset,
  ] as readonly Asset[],
  selection: require('../../assets/images/avatar-screen/red-selection-frame.png') as Asset,
  chooseButton: require('../../assets/images/avatar-screen/choose-button.png') as Asset,
  title: require('../../assets/images/avatar-screen/select-avatar-label.png') as Asset,
  ropeDivider: require('../../assets/images/avatar-screen/rope-anchor-divider.png') as Asset,
  emphasisLeft: require('../../assets/images/avatar-screen/navy-emphasis-left.png') as Asset,
  emphasisRight: require('../../assets/images/avatar-screen/navy-emphasis-right.png') as Asset,
  greenEmphasis: require('../../assets/images/avatar-screen/green-emphasis.png') as Asset,
  panel: {
    top: require('../../assets/avatars/panel-t.png'),
    mid: require('../../assets/avatars/panel-m.png'),
    bottom: require('../../assets/avatars/panel-b.png'),
  } as VSlices,
  card: {
    top: require('../../assets/avatars/card-t.png'),
    mid: require('../../assets/avatars/card-m.png'),
    bottom: require('../../assets/avatars/card-b.png'),
  } as VSlices,
} as const;

/**
 * The match-found reveal (assets/images/match). The banner and the two frames
 * are the processed versions in assets/match/: the banner with its baked arena
 * name erased (the name is live), the frames with their hollow filled.
 */
export const MATCH_ART = {
  banner: require('../../assets/match/arena-banner.png') as Asset,
  playerCard: require('../../assets/match/player-card.png') as Asset,
  countryBadge: require('../../assets/match/country-badge.png') as Asset,
  tagline: require('../../assets/images/match/banner-tagline.png') as Asset,
  versus: require('../../assets/images/match/versus.png') as Asset,
  strategyQuote: require('../../assets/images/match/strategy-quote.png') as Asset,
  oceansQuote: require('../../assets/images/match/oceans-connect-quote.png') as Asset,
  pathsQuote: require('../../assets/images/match/different-paths-quote.png') as Asset,
  buildersQuote: require('../../assets/images/match/more-builders-quote.png') as Asset,
  gullSmall: require('../../assets/images/match/seagull-small.png') as Asset,
  gullTop: require('../../assets/images/match/seagull-top.png') as Asset,
} as const;

/**
 * Settings (assets/images/settings — chosen over settings_copy: sharper
 * buttons, clean-edged steppers, and the only full toggle, with its off state
 * and a separate knob). The toggle's parts and the sliced panel and button are
 * in assets/settings/. The quote comes from settings_copy, the one place it exists.
 */
export const SETTINGS_ART = {
  back: require('../../assets/images/settings/back-button.png') as Asset,
  banner: require('../../assets/images/settings/settings-banner.png') as Asset,
  emphasisLeft: require('../../assets/images/settings/emphasis-left.png') as Asset,
  emphasisRight: require('../../assets/images/settings/emphasis-right.png') as Asset,
  ropeDivider: require('../../assets/images/settings/rope-anchor-divider.png') as Asset,
  dashedDivider: require('../../assets/images/settings/dashed-divider.png') as Asset,
  waveDivider: require('../../assets/images/settings/wave-divider.png') as Asset,
  changeName: require('../../assets/images/settings/change-name.png') as Asset,
  changeAvatar: require('../../assets/images/settings/change-avatar.png') as Asset,
  logo: require('../../assets/images/settings/ocean-warfare-logo.png') as Asset,
  minus: require('../../assets/images/settings/minus-button.png') as Asset,
  plus: require('../../assets/images/settings/plus-button.png') as Asset,
  soundIcon: require('../../assets/images/settings/sound-effects-icon.png') as Asset,
  sfxVolumeIcon: require('../../assets/images/settings/sfx-volume-icon.png') as Asset,
  musicIcon: require('../../assets/images/settings/music-icon.png') as Asset,
  musicVolumeIcon: require('../../assets/images/settings/music-volume-icon.png') as Asset,
  hapticsIcon: require('../../assets/images/settings/haptics-icon.png') as Asset,
  quote: require('../../assets/images/settings_copy/smaller-blocks-quote.png') as Asset,
  trackOn: require('../../assets/settings/track-on.png') as Asset,
  trackOff: require('../../assets/settings/track-off.png') as Asset,
  knob: require('../../assets/settings/knob.png') as Asset,
  dashesLeft: require('../../assets/settings/dashes-l.png') as Asset,
  dashesRight: require('../../assets/settings/dashes-r.png') as Asset,
  panel: {
    top: require('../../assets/settings/panel-t.png'),
    mid: require('../../assets/settings/panel-m.png'),
    bottom: require('../../assets/settings/panel-b.png'),
  } as VSlices,
  creamButton: {
    left: require('../../assets/settings/cream-button-l.png'),
    mid: require('../../assets/settings/cream-button-m.png'),
    right: require('../../assets/settings/cream-button-r.png'),
  } as Slices,
} as const;

/**
 * Captain's profile (assets/images/profile). The panels are cleaned, filled and
 * sliced in assets/profile/, and `ringFrame` is the round avatar's rope ring
 * alone, so the captain the player chose sits inside it.
 */
export const PROFILE_ART = {
  banner: require('../../assets/images/profile/captains-profile-banner.png') as Asset,
  ringFrame: require('../../assets/profile/round-frame.png') as Asset,
  nameUnderline: require('../../assets/images/profile/name-underline.png') as Asset,
  titleUnderline: require('../../assets/images/profile/secure-account-underline.png') as Asset,
  shipWheel: require('../../assets/images/profile/ship-wheel.png') as Asset,
  seagull: require('../../assets/images/profile/seagull.png') as Asset,
  verified: require('../../assets/images/profile/verified-icon.png') as Asset,
  changeName: require('../../assets/images/profile/change-name-button.png') as Asset,
  changeAvatar: require('../../assets/images/profile/change-avatar-button.png') as Asset,
  openWallet: require('../../assets/images/profile/open-wallet-button.png') as Asset,
  signOut: require('../../assets/images/profile/sign-out-button.png') as Asset,
  profilePanel: {
    top: require('../../assets/profile/profile-panel-t.png'),
    mid: require('../../assets/profile/profile-panel-m.png'),
    bottom: require('../../assets/profile/profile-panel-b.png'),
  } as VSlices,
  accountPanel: {
    top: require('../../assets/profile/account-panel-t.png'),
    mid: require('../../assets/profile/account-panel-m.png'),
    bottom: require('../../assets/profile/account-panel-b.png'),
  } as VSlices,
} as const;

/**
 * Blank buttons with the hand hatching intact, built by scripts/color-assets.sh
 * at five aspect ratios (PLATE_ASPECTS) by tiling the strip beside a baked
 * label — stretching it smeared the hatching. <ArtPlate> picks the nearest.
 */
export const PLATE_ASPECTS = [3.5, 4.25, 5, 5.75, 6.5] as const;
export const PLATES = {
  green: [
    require('../../assets/points/plate-green-0.png') as Asset,
    require('../../assets/points/plate-green-1.png') as Asset,
    require('../../assets/points/plate-green-2.png') as Asset,
    require('../../assets/points/plate-green-3.png') as Asset,
    require('../../assets/points/plate-green-4.png') as Asset,
  ],
  cream: [
    require('../../assets/points/plate-cream-0.png') as Asset,
    require('../../assets/points/plate-cream-1.png') as Asset,
    require('../../assets/points/plate-cream-2.png') as Asset,
    require('../../assets/points/plate-cream-3.png') as Asset,
    require('../../assets/points/plate-cream-4.png') as Asset,
  ],
} as const;

/** Cells of a frame for <GridSlicedImage>, row by row. */
export type GridCells = readonly (readonly Asset[])[];

/** Points exchange (assets/images/points-profile, the cleaner of each duplicate). */
export const POINTS_ART = {
  banner: require('../../assets/points/banner.png') as Asset,
  /** 5 x 3: corners and crown fixed; the strips beside the crown and the middle stretch. */
  panel: [
    [require('../../assets/points/panel-00.png'), require('../../assets/points/panel-01.png'), require('../../assets/points/panel-02.png'), require('../../assets/points/panel-03.png'), require('../../assets/points/panel-04.png')],
    [require('../../assets/points/panel-10.png'), require('../../assets/points/panel-11.png'), require('../../assets/points/panel-12.png'), require('../../assets/points/panel-13.png'), require('../../assets/points/panel-14.png')],
    [require('../../assets/points/panel-20.png'), require('../../assets/points/panel-21.png'), require('../../assets/points/panel-22.png'), require('../../assets/points/panel-23.png'), require('../../assets/points/panel-24.png')],
  ] as GridCells,
  coinStack: require('../../assets/points/coin-stack.png') as Asset,
  wallet: require('../../assets/images/points-profile/wallet-icon copy.png') as Asset,
  refresh: require('../../assets/images/points-profile/refresh-icon copy.png') as Asset,
  shieldCheck: require('../../assets/images/points-profile/shield-check copy.png') as Asset,
  waveDivider: require('../../assets/images/points-profile/wave-divider copy.png') as Asset,
  straightDivider: require('../../assets/images/points-profile/straight-divider.png') as Asset,
} as const;

/** Leaderboard (assets/images/leaderboard): the table with its rules erased, rows drawn live. */
export const LEADERBOARD_ART = {
  banner: require('../../assets/leaderboard/banner.png') as Asset,
  table: require('../../assets/leaderboard/table.png') as Asset,
} as const;

/** Two players and finding an opponent (assets/images/matchmaking-captain-assets). */
export const MATCHMAKING_ART = {
  banner: require('../../assets/images/matchmaking-captain-assets/empire-of-bits-banner.png') as Asset,
  back: require('../../assets/images/matchmaking-captain-assets/back-arrow-button.png') as Asset,
  compass: require('../../assets/images/matchmaking-captain-assets/compass.png') as Asset,
  ropePanel: require('../../assets/hotseat/rope-panel.webp') as Asset,
  title: require('../../assets/images/matchmaking-captain-assets/name-both-captains-title.png') as Asset,
  inputActive: {
    left: require('../../assets/hotseat/input-active-l.png'),
    mid: require('../../assets/hotseat/input-active-m.png'),
    right: require('../../assets/hotseat/input-active-r.png'),
  } as Slices,
  inputDefault: {
    left: require('../../assets/hotseat/input-default-l.png'),
    mid: require('../../assets/hotseat/input-default-m.png'),
    right: require('../../assets/hotseat/input-default-r.png'),
  } as Slices,
  anchorGreen: require('../../assets/images/matchmaking-captain-assets/input-anchor-green.png') as Asset,
  anchorBlue: require('../../assets/images/matchmaking-captain-assets/input-anchor-blue.png') as Asset,
  placeFleets: require('../../assets/images/matchmaking-captain-assets/place-fleets-button.png') as Asset,
  greenDashLeft: require('../../assets/images/matchmaking-captain-assets/place-fleets-emphasis-left.png') as Asset,
  greenDashRight: require('../../assets/images/matchmaking-captain-assets/place-fleets-emphasis-right.png') as Asset,
  radarBase: require('../../assets/searching/radar-base.png') as Asset,
  radarSweep: require('../../assets/searching/radar-sweep.png') as Asset,
  radarDashLeft: require('../../assets/images/matchmaking-captain-assets/radar-emphasis-left.png') as Asset,
  radarDashRight: require('../../assets/images/matchmaking-captain-assets/radar-emphasis-right.png') as Asset,
  cancel: require('../../assets/images/matchmaking-captain-assets/cancel-button.png') as Asset,
  navyDashLeft: require('../../assets/images/matchmaking-captain-assets/cancel-emphasis-left.png') as Asset,
  navyDashRight: require('../../assets/images/matchmaking-captain-assets/cancel-emphasis-right.png') as Asset,
  twoCaptainsQuote: require('../../assets/images/matchmaking-captain-assets/two-captains-quote.png') as Asset,
  planPlaceQuote: require('../../assets/images/matchmaking-captain-assets/plan-place-battle-quote.png') as Asset,
  differentCaptainsQuote: require('../../assets/images/matchmaking-captain-assets/different-captains-quote.png') as Asset,
  differentCaptainsSmall: require('../../assets/images/matchmaking-captain-assets/different-captains-small-quote.png') as Asset,
  goodCaptainsQuote: require('../../assets/images/matchmaking-captain-assets/good-captains-quote.png') as Asset,
  gulls: [
    require('../../assets/images/matchmaking-captain-assets/seagull-01.png') as Asset,
    require('../../assets/images/matchmaking-captain-assets/seagull-02.png') as Asset,
    require('../../assets/images/matchmaking-captain-assets/seagull-03.png') as Asset,
    require('../../assets/images/matchmaking-captain-assets/seagull-04.png') as Asset,
    require('../../assets/images/matchmaking-captain-assets/seagull-05.png') as Asset,
    require('../../assets/images/matchmaking-captain-assets/seagull-06.png') as Asset,
  ] as readonly Asset[],
} as const;

/**
 * Victory and defeat (assets/images/victory-defeat-assets — the two folders
 * share every piece but the banner). Frames are filled in assets/result/, and
 * the portrait frame is the rope alone so each captain's own portrait sits in it.
 */
export const RESULT_ART = {
  victoryBanner: require('../../assets/result/victory-banner.png') as Asset,
  defeatBanner: require('../../assets/result/defeat-banner.png') as Asset,
  panel: require('../../assets/result/panel.png') as Asset,
  portraitFrame: require('../../assets/result/portrait-frame.png') as Asset,
  nameRibbon: require('../../assets/result/name-ribbon.png') as Asset,
  countryBadge: require('../../assets/result/country-badge.png') as Asset,
  barFrame: require('../../assets/result/bar-frame.png') as Asset,
  barFill: require('../../assets/result/bar-fill.png') as Asset,
  rankBadge: require('../../assets/images/victory-defeat-assets/winner/rank-badge.png') as Asset,
  playAgain: require('../../assets/images/victory-defeat-assets/winner/play-again-button.png') as Asset,
  menu: require('../../assets/images/victory-defeat-assets/winner/menu-button.png') as Asset,
  coin: require('../../assets/result/coin.png') as Asset,
  wordmark: require('../../assets/images/victory-defeat-assets/winner/empire-of-bits-wordmark.png') as Asset,
  oceansQuote: require('../../assets/images/victory-defeat-assets/winner/oceans-remember-quote.png') as Asset,
  seasQuote: require('../../assets/images/victory-defeat-assets/winner/different-seas-quote.png') as Asset,
  watersQuote: require('../../assets/images/victory-defeat-assets/defeat/same-waters-quote.png') as Asset,
  gulls: [
    require('../../assets/images/victory-defeat-assets/winner/seagull-01.png') as Asset,
    require('../../assets/images/victory-defeat-assets/winner/seagull-02.png') as Asset,
    require('../../assets/images/victory-defeat-assets/winner/seagull-04.png') as Asset,
    require('../../assets/images/victory-defeat-assets/winner/seagull-06.png') as Asset,
  ] as readonly Asset[],
} as const;

/**
 * Fleet placement and the battle (assets/battle-complete-assets, the fleet
 * art and the effect sheets, built by scripts/battle-assets.sh).
 *
 * SKETCH_PLATES are blank buttons in the placement art's own hand — cream
 * with the double navy frame, green hatched — at six aspects; <ArtPlate
 * family="sketch"> picks the nearest and draws the label live.
 */
export const SKETCH_ASPECTS = [2, 2.4, 3, 3.6, 4.4, 5.2] as const;
export const SKETCH_PLATES = {
  green: [
    require('../../assets/battle/plate-green-0.png') as Asset,
    require('../../assets/battle/plate-green-1.png') as Asset,
    require('../../assets/battle/plate-green-2.png') as Asset,
    require('../../assets/battle/plate-green-3.png') as Asset,
    require('../../assets/battle/plate-green-4.png') as Asset,
    require('../../assets/battle/plate-green-5.png') as Asset,
  ],
  cream: [
    require('../../assets/battle/plate-cream-0.png') as Asset,
    require('../../assets/battle/plate-cream-1.png') as Asset,
    require('../../assets/battle/plate-cream-2.png') as Asset,
    require('../../assets/battle/plate-cream-3.png') as Asset,
    require('../../assets/battle/plate-cream-4.png') as Asset,
    require('../../assets/battle/plate-cream-5.png') as Asset,
  ],
} as const;

export const BATTLE_ART = {
  back: require('../../assets/battle/back-button.png') as Asset,
  rotate: require('../../assets/battle/rotate-button.png') as Asset,
  shuffle: require('../../assets/battle/shuffle-button.png') as Asset,
  close: require('../../assets/battle/close-button.png') as Asset,
  closeX: require('../../assets/battle/close-x.png') as Asset,
  modalClose: require('../../assets/battle/modal-close.png') as Asset,
  info: require('../../assets/battle/info-icon.png') as Asset,
  diamond: require('../../assets/battle/diamond-points-icon.png') as Asset,
  maxBadge: require('../../assets/battle/max-badge.png') as Asset,
  fuel: require('../../assets/battle/fuel-icon.png') as Asset,
  compass: require('../../assets/battle/compass.png') as Asset,
  dockAnchor: require('../../assets/battle/dock-anchor.png') as Asset,
  oceanRibbon: require('../../assets/battle/ocean-warfare-ribbon.png') as Asset,
  coins: require('../../assets/battle/coins.png') as Asset,
  arsenalButton: require('../../assets/battle/arsenal-button.png') as Asset,
  logo: require('../../assets/battle/empire-logo.png') as Asset,
  crossedWeapons: require('../../assets/battle/crossed-weapons-badge.png') as Asset,
  starBadge: require('../../assets/battle/star-badge.png') as Asset,
  rankBadge: require('../../assets/battle/rank-badge.png') as Asset,
  rankBadgeAdmiral: require('../../assets/battle/rank-badge-admiral.png') as Asset,
  emoteTab: require('../../assets/battle/emote-menu-tab.png') as Asset,
  seagull: require('../../assets/battle/seagull.png') as Asset,
  waveMark: require('../../assets/battle/wave-mark.png') as Asset,
  oceanUnites: require('../../assets/battle/ocean-unites-us.png') as Asset,
  /** The hatched square of the effect diagrams; the grid is drawn live. */
  diagramCell: require('../../assets/battle/diagram-cell.png') as Asset,
  /** Frames, filled with paper and built at the aspect each is drawn. */
  arsenalPanel: require('../../assets/battle/arsenal-panel.png') as Asset,
  arsenalCard: require('../../assets/battle/arsenal-card.png') as Asset,
  dock: require('../../assets/battle/dock.png') as Asset,
  infoModal: require('../../assets/battle/info-modal.png') as Asset,
  weaponModal: require('../../assets/battle/weapon-modal.png') as Asset,
  weaponRow: require('../../assets/battle/weapon-row.png') as Asset,
  infoFrame: require('../../assets/battle/info-frame.png') as Asset,
  emoteMenu: require('../../assets/battle/emote-menu.png') as Asset,
  emoteTile: require('../../assets/battle/emote-tile.png') as Asset,
  /** Navy strokes only, 622 x 609; the board sits inside x 18..605, y 15..588. */
  boardFrame: require('../../assets/battle/board-frame.png') as Asset,
  /** 168 x 183, open inside x 18..149, y 17..163 for the player's own captain. */
  portraitFrame: require('../../assets/battle/portrait-frame.png') as Asset,
} as const;

/**
 * The fleet, drawn in colour (never tinted): each ship bow left, trimmed with
 * a 4 % margin; `sunk` is the same art burnt, `wreck` the pencil sketch an
 * enemy wreck is found as. Icons are the arsenal's own card art.
 */
export const FLEET_ART = {
  ships: {
    battleship: require('../../assets/fleet/ship-battleship.png') as Asset,
    cruiser: require('../../assets/fleet/ship-cruiser.png') as Asset,
    destroyer: require('../../assets/fleet/ship-destroyer.png') as Asset,
    boat: require('../../assets/fleet/ship-boat.png') as Asset,
  },
  sunk: {
    battleship: require('../../assets/fleet/ship-battleship-sunk.png') as Asset,
    cruiser: require('../../assets/fleet/ship-cruiser-sunk.png') as Asset,
    destroyer: require('../../assets/fleet/ship-destroyer-sunk.png') as Asset,
    boat: require('../../assets/fleet/ship-boat-sunk.png') as Asset,
  },
  wrecks: {
    battleship: require('../../assets/fleet/wreck-battleship.png') as Asset,
    cruiser: require('../../assets/fleet/wreck-cruiser.png') as Asset,
    destroyer: require('../../assets/fleet/wreck-destroyer.png') as Asset,
    boat: require('../../assets/fleet/wreck-boat.png') as Asset,
  },
  aaGun: require('../../assets/fleet/aa-gun.png') as Asset,
  radar: require('../../assets/fleet/radar.png') as Asset,
  mine: require('../../assets/fleet/mine.png') as Asset,
  icons: {
    torpedoBomber: require('../../assets/fleet/icon-torpedo-bomber.png') as Asset,
    doubleTorpedoBomber: require('../../assets/fleet/icon-double-torpedo.png') as Asset,
    bomber: require('../../assets/fleet/icon-bomber.png') as Asset,
    atomicBomber: require('../../assets/fleet/icon-atomic-bomber.png') as Asset,
    aaGun: require('../../assets/fleet/icon-aa-gun.png') as Asset,
    radar: require('../../assets/fleet/icon-radar.png') as Asset,
    mine: require('../../assets/fleet/icon-mine.png') as Asset,
    submarine: require('../../assets/fleet/icon-submarine.png') as Asset,
  },
} as const;

/** An animation: `frames` equal cells side by side, each `aspect` (w / h). */
export interface FxStrip {
  readonly source: Asset;
  readonly frames: number;
  readonly aspect: number;
}
const strip = (source: Asset, w: number, h: number): FxStrip => ({ source, frames: 6, aspect: w / h });

/**
 * The battle's animations, one strip each (cell sizes as the script printed
 * them). The aircraft face up, their propeller tip and wing line fixed from
 * frame to frame; frames 2-6 open the bay and let the load fall away.
 */
export const FX_ART = {
  aircraft: {
    torpedoBomber: strip(require('../../assets/fx/aircraft-1.webp'), 200, 185),
    doubleTorpedoBomber: strip(require('../../assets/fx/aircraft-2.webp'), 200, 177),
    bomber: strip(require('../../assets/fx/aircraft-3.webp'), 200, 200),
    atomicBomber: strip(require('../../assets/fx/aircraft-4.webp'), 200, 173),
  },
  /** Level-flight shadows, 200 wide: single plane, twin- and four-engine. */
  shadows: {
    single: { source: require('../../assets/fx/shadow-1.webp') as Asset, aspect: 200 / 180 },
    twin: { source: require('../../assets/fx/shadow-3.webp') as Asset, aspect: 200 / 180 },
    quad: { source: require('../../assets/fx/shadow-4.webp') as Asset, aspect: 200 / 145 },
  },
  explosionInk: strip(require('../../assets/fx/explosion-ink.webp'), 200, 157),
  explosionFire: strip(require('../../assets/fx/explosion-fire.webp'), 200, 186),
  explosionAtomic: strip(require('../../assets/fx/explosion-atomic.webp'), 256, 256),
  explosionPuff: strip(require('../../assets/fx/explosion-puff.webp'), 200, 147),
  mine: strip(require('../../assets/fx/mine.webp'), 200, 192),
  radar: strip(require('../../assets/fx/radar.webp'), 236, 256),
  smoke: strip(require('../../assets/fx/smoke.webp'), 200, 173),
  smokeAtomic: strip(require('../../assets/fx/smoke-atomic.webp'), 256, 242),
  /** Sitting, then diving: played backwards it surfaces. */
  submarine: strip(require('../../assets/fx/submarine.webp'), 200, 190),
  turret: strip(require('../../assets/fx/turret.webp'), 192, 200),
  splash: strip(require('../../assets/fx/splash.webp'), 200, 144),
  /** Small to large; played backwards it falls away from the eye to the sea. */
  bomb: strip(require('../../assets/fx/bomb.webp'), 75, 160),
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

/**
 * The eight emotes (assets/battle-complete-assets/emotes), in the picker's
 * order. Ids are the wire's (1-8), so both sides show the same sticker.
 */
export const EMOTES: readonly { id: number; label: string; source: Asset }[] = [
  { id: 1, label: 'thumbs-up', source: require('../../assets/battle/emote-thumbs-up.png') },
  { id: 2, label: 'grin', source: require('../../assets/battle/emote-grin.png') },
  { id: 3, label: 'angry', source: require('../../assets/battle/emote-angry-captain.png') },
  { id: 4, label: 'wave', source: require('../../assets/battle/emote-wave.png') },
  { id: 5, label: 'medal', source: require('../../assets/battle/emote-medal.png') },
  { id: 6, label: 'skull', source: require('../../assets/battle/emote-skull.png') },
  { id: 7, label: 'question', source: require('../../assets/battle/emote-question.png') },
  { id: 8, label: 'fire', source: require('../../assets/battle/emote-fire.png') },
];
