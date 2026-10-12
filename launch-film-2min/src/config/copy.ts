/**
 * EVERY on-screen string in the film. Edit here, re-render; nothing else holds copy.
 *
 * Rules (BRIEF §4.1, §4.11): one idea per shot, max six words, short declarative lines
 * with periods, sentence case, positive, no financial promises. Every name and number
 * exists in the game's code (sources noted).
 */

export const COPY = {
  coldOpen: {
    line1: 'Every empire',
    // the final period is not typed: the bit (the glowing pixel) lands there
    line2: 'starts with a single bit',
  },
  title: {
    // app.json → expo.name "Empire of Bits: Ocean Warfare"
    name: 'Empire of Bits',
    sub: 'Ocean Warfare',
    tagline: 'Command the sea.',
  },
  wallet: {
    word1: 'Connect.',
    word2: "You're in.",
    // UI string on the wallet screen: "Privy embedded Solana wallet"
    callout: 'Embedded Solana wallet',
  },
  build: {
    headline: 'Build your base.',
    line2: 'Position is everything.',
    // src/features/arsenal/catalog.ts ARSENAL_NAMES
    calloutAa: 'AA Gun',
    calloutMine: 'Mine',
    calloutPoints: 'Points',
    cards: ['AA Gun', 'Mine'],
  },
  fleet: {
    headline: 'Meet the fleet.',
    // src/features/store/catalog.ts STORE_ITEMS (fleet section), largest first
    ships: ['Battleship', 'Cruiser', 'Destroyer', 'Patrol Boat'],
    // src/engine/fleet.ts FLEET_SHIP_COUNT = 8
    statNumber: '8',
    statWord: 'ships.',
  },
  arsenal: {
    line: 'An arsenal for every strategy.',
    // ARSENAL_NAMES, the attack group; the Atomic Bomber ends centred
    weapons: ['Torpedo Bomber', 'Double Torpedo Bomber', 'Bomber', 'Submarine', 'Radar', 'Atomic Bomber'],
  },
  match: {
    line: 'Find your rival.',
  },
  battle: {
    // establishing callouts: the opponent reveal calls it "Enemy waters"; the deck is titled "Attack"
    calloutOwn: 'Your fleet',
    calloutEnemy: 'Enemy waters',
    calloutDeck: 'Attack deck',
    aim: 'Aim.',
    fire: 'Fire.',
    hit: 'Hit.',
    labelAtomic: 'Atomic Bomber',
    labelAa: 'AA Gun',
    line: 'Every move matters.',
  },
  victory: {
    word: 'Victory.',
    callout: 'Points gained',
  },
  economy: {
    // the store sells colour editions for the collection ("colours unlock in the Store")
    // '\n' breaks a line
    words: ['Buy points.', 'Sell points.', 'Collect every\ncolour.', 'Climb\nthe ranks.'],
    calloutTop: 'No. 1',
  },
  bento: {
    // tile labels only
    tiles: {
      battle: 'Ranked battles',
      fleet: 'Eight ships',
      arsenal: 'Arsenal',
      defence: 'Defence',
      match: 'Matchmaking',
      wallet: 'Solana wallet',
      points: 'Points exchange',
      store: 'Store',
      leaderboard: 'Leaderboard',
      port: 'Port City',
    },
  },
  finale: {
    oneMore: 'One more thing.',
    live: 'Live on the Solana dApp Store.',
    lockupName: 'Empire of Bits',
    // the final period is the bit
    yourMove: 'Your move',
  },
} as const;
