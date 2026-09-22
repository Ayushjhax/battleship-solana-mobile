# Part 3 — Shipyard and Stationer's Shop (cosmetics)

**Depends on:** Parts 1–2 · **Flag:** `portCity.cosmetics` · **Surface:** two city buildings, one equip screen, render hooks in the board

The game is drawn with a pen on paper. So the cosmetics are **pens, ink and paper** — the
most on-brand store a game like this can have, and not one point of power.

---

## 1. Slots

| Slot | Where | What it changes | Seen by the opponent? |
| --- | --- | --- | --- |
| Fleet ink | Stationer's | the colour your ships and your marks are drawn in | yes, on cells they have proven (sunk ships, revealed items) and on your arena card |
| Paper | Stationer's | the sheet both boards are drawn on, for you only | no |
| Pen | Stationer's | stroke width, wobble, alpha and texture of **your** fleet and marks | yes, same rule as ink |
| Hull set | Shipyard | the ship sprites of your fleet | yes, same rule as ink |
| Sink effect | Shipyard | the animation played when **you** sink an enemy ship | yes — it plays on both screens |
| Victory stamp | Shipyard | the Result ribbon when you win | yes |

Nothing here changes a hitbox, a timing that matters, or a rule. Animations must keep the
same durations as §13.2 of the game design doc.

## 2. Catalogue (v1)

**Fleet ink** — Ballpoint violet (default), Crimson, Forest, Sepia, Charcoal, Teal,
Rust, **Gold** (gems). 300–900 coins, gold 350 gems.

**Paper** — Graph (default), Parchment, Blueprint, Dotted notebook, Old sea chart,
Squared exercise book. 400–1,200 coins.

**Pen** — Ballpoint (default), Fountain pen (variable width), Pencil (grey, grainy,
lighter), Marker (thick, less wobble), Crayon (rough edges). 500–1,500 coins.

**Hull sets** — Standard (default), **Ghost fleet** (existing masks at 45% alpha with a
dashed overlay and a slow drift), **Paper boats** (procedural origami polygons), plus
slots reserved for art-dependent sets (Ironclad, Longship, Junk). 1,500–4,000 coins or
250–400 gems.

**Sink effects** — Ink blot (default), Splatter, Whirlpool, Confetti (event). 600–1,800 coins.

**Victory stamps** — Laurel (default), Anchor, Skull and crossbones, Kraken. 800–2,000 coins.

Each store's **level gates the shelf**: Shipyard/Stationer's level 1 shows tier 1, level 2
adds tier 2, and so on. Items are permanent once bought.

## 3. Rules that matter

- **Legibility is a rule, not a preference.** A test computes the contrast ratio of every
  ink × paper combination; anything under 3:1 is remapped to that ink's light variant on
  dark papers (Blueprint) instead of being sold as an unreadable combination. Marks
  (miss / hit / sunk / revealed / mine) must stay distinguishable on every paper: the
  test renders each mark on each paper and compares against a reference palette.
- **No hidden information may leak.** Cosmetics travel in the match payload as a small
  `cosmetics` object per player at arena reveal. It contains no positions. Enemy ships are
  still drawn only when the rules have made them public.
- **The attacker's sink effect plays on both screens**, so it must be short (≤ 600 ms) and
  must not delay the turn flip. If the opponent's client does not know an effect id, it
  falls back to the default — never a crash, never a blocking download.
- Cosmetics are **bought and equipped server-side** (`cosmetics_owned`, `cosmetics_equipped`).
  A client that claims to own something it does not is rejected, and the match payload is
  built from the server's copy.

## 4. Screens

- **Shipyard** and **Stationer's Shop** sheets open from their plots: a shelf of ink cards
  (2 rows, horizontally scrolling), each showing the item drawn in its own style, its price
  and Own/Equip.
- **The Captain's Desk** (the equip preview, reachable from either shop): a mini board on
  the current paper with your fleet in the current ink, pen and hulls, one ship sinking on
  loop so the sink effect is visible. Tapping a card previews it live for free; Buy commits.
- Gem store: a `GemStore` adapter interface with a `NotAvailable` implementation. The
  button shows "Coming soon" and the screen exists so IAP can be dropped in later.

## 5. API

`GET /cosmetics` → catalogue (server-driven, so a season can add items without an app
update) + owned + equipped.
`POST /cosmetics/buy` `{ itemId, requestId }` → typed errors `already-owned`,
`not-enough-coins`, `not-enough-gems`, `locked-tier`, `feature-off`.
`POST /cosmetics/equip` `{ slot, itemId, requestId }` → `not-owned`, `bad-slot`.

## 6. Tests

1. Buy → own → equip → appears in the match payload; buying twice is refused and refunds
   nothing.
2. A player cannot equip an item they do not own, and a forged client payload is ignored:
   the server builds the render config.
3. Contrast test over every ink × paper pair, and mark-distinguishability per paper.
4. Unknown effect id from the opponent falls back to default (simulate an old client).
5. Sink effects all complete within 600 ms and never delay the turn flip (timing test).
6. Shelf gating: a level-1 store never returns tier-2 items as buyable.

**Manual QA:** equip Blueprint paper + Charcoal ink and confirm the board is still
readable; play an online match with Ghost fleet and check the opponent sees it only on
sunk ships; buy the last item with exactly enough coins.

## 7. Acceptance criteria

1. Six slots, catalogue above, bought and equipped server-side, visible where the rules
   allow and nowhere else.
2. Zero effect on balance, and the board stays legible in every combination we sell.
3. Gems have their first real sink, and the IAP seam exists without IAP.
