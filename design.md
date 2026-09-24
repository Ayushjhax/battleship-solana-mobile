# Battleship: currency help, matchmaking fallback, arsenal cleanup, and online fee

## Goal

Make the three displayed balances understandable, keep a player from waiting indefinitely for an online opponent, show mines only where they can be used, and retain a 5% platform fee on completed online player-versus-player matches.

This specification describes intended behavior. The implementing agent must inspect the repository and preserve its actual architecture, names, stake rules, and existing economy. Do not infer currency definitions or create conversion rules from color alone.

## 1. Tap-to-explain balances

### Discovery

Find every balance display for blue points, golden points, and green gems, including the home screen, lobby, match setup, shop, profile, and any shared header. Trace each balance to its authoritative model and existing earn, spend, wager, and redemption paths. Record the real unit names and semantics in a single shared UI metadata source. If a currency's meaning cannot be established from code or existing product copy, use a truthful generic explanation and flag the missing product definition in the delivery summary; do not invent earning methods or cash value.

### UI behavior

- Tapping/clicking each icon **or** its displayed balance opens a concise detail sheet, popover, or modal using the app's existing component pattern. Each displays the correct name, what it is used for, and how it is obtained **only if verified**. Include a close action and preserve access to the underlying screen.
- Keep the blue, gold, and green visual associations and their current formatting. Give each item an accessible name such as `About [verified currency name]`; support keyboard activation and screen-reader labeling where relevant.
- Ensure the targets work on the actual mobile layout and that tapping a balance does not also launch an underlying action. Where the same balance component is shared, implement the behavior once. If separate implementations exist, update all relevant visible balances consistently.
- Explanations are informational. Opening or closing them never changes a balance or performs a purchase.

## 2. Online matchmaking: bot after 40 seconds

### Timer and transitions

- Start a 40-second deadline when the online matchmaking request has successfully entered the queue, using the existing matchmaking clock/source of truth. Show the app's normal searching UI and, if appropriate, the remaining time.
- If a human opponent is matched before the deadline, start exactly one human match and cancel the fallback. If no human opponent is matched by the deadline, leave/cancel the queue and launch the **existing offline bot gameplay** with the chosen supported settings. Never label the bot as a human online opponent. Show a brief, clear notice: `No opponent found. Playing against a bot instead.`
- Route to the established offline bot match path. Do not spin up an unrelated AI, duplicate game rules, or keep an online match open while bot play starts.
- Cancel the deadline on human match, manual cancellation/back navigation, unmount, disconnect handling, and any other terminal state. Handle a human match arriving at the same time as timeout with one atomic/guarded transition: one match only, no orphaned queue entry.
- Reconnect/background behavior must follow the repository's existing queue contract. Do not start multiple independent 40-second timers on rerender or accidentally reset the deadline when the screen remounts. If the server owns matchmaking, prefer a server-coordinated deadline and cancellation or idempotent fallback; a client timer may drive display but must not allow a late human match to create a second game.

### Stakes and balances

- Bot fallback is an offline bot match, so **no online platform fee applies**. Before switching, release/refund any online stake reservation in the existing transaction model and confirm that the bot mode does not silently inherit a real-money/points wager. If the repository has explicit bot rewards or costs, preserve those existing rules and make them visible.
- Make cancellation, timeout, retry, and network error paths financially idempotent. Never charge twice or lose an escrowed stake because the queue timed out.

## 3. Mines belong to defense

- Identify the attack-phase arsenal renderer and remove `Mine` from its available actions, count, tooltip, shortcuts, and attack selection state. A player must never be offered a mine while choosing an offensive move.
- Preserve the existing mine placement/defensive mechanic where it is valid, including existing limits and inventory. Do not delete mine data or break old matches, replays, or server validation.
- Prevent any stale selected mine or deep-linked action from being sent as an attack. Prefer deriving UI availability from a shared phase/ability rule rather than filtering only its icon.

## 4. Five percent fee on online human matches

### Applicability and formula

- Apply to completed, eligible **online human-versus-human** matches only. Offline bot games, bot fallback, cancellations before play, refunded matches, and no-contest outcomes do not collect this fee.
- User intent: the winner receives **95% of the gross points they would otherwise win**; the platform retains **5% of that same gross award**. Determine from the code whether the gross award is a pooled stake, a defined prize, or another amount. Do not assume it is a single player's stake and do not reapply the fee to an already net amount.
- For integer points, use an exact, documented rounding rule in the authoritative settlement layer. Preferred rule: `fee = floor(grossAward * 5 / 100)` and `winnerPayout = grossAward - fee`; this preserves the full gross amount with no fractional points. If the existing ledger has a mandated rounding policy, follow it and document the choice. Example for a gross award of 200 points: winner 190, platform 10. For a 1-point gross award under the preferred rule: winner 1, platform 0.
- Calculate in integer smallest units with overflow-safe arithmetic, not floating-point money math. Make `grossAward = winnerPayout + platformFee` an invariant. Decide and document which existing wallet/ledger/account holds the fee; do not credit an invented account or make points disappear without an auditable fee entry.

### Lifecycle and display

- The trusted server/database settlement or existing authoritative on-chain settlement must apply the fee **once**, atomically with outcome and payout, using the match ID or settlement ID as an idempotency key. The client may preview the amounts but must not determine or submit a trusted winner payout.
- Apply to new eligible matches after the change. Preserve existing finalized match payouts and transaction histories. Handle rematch, duplicate result messages, retries, simultaneous disconnects, and failed transfers without charging twice.
- Before an online stake is committed, show the fee and expected payout in the existing stake/confirmation UI. Use accurate examples based on the actual pot or prize model. At result and in history, show gross prize, fee, and winner's net payout where those values are already shown or can be surfaced naturally. A loser should not be charged a second 5% fee beyond the agreed stake.
- If real currency, token transfers, or an existing contract controls settlement, stop short of a client-only fee and report the required trusted settlement change. Do not silently substitute a display-only calculation.

## Implementation approach

1. Trace current screens, balance sources, queue events, offline bot navigation, arsenal phase rules, and settlement/ledger flow. Read repository guidance and existing tests first. Write a short map of relevant files and findings before edits.
2. Implement each change using existing patterns and reusable components. Keep protocol/schema migrations small and backward compatible. Ensure fee constants and reward breakdown have one source of truth.
3. Add focused tests around queue timeout/race/cancel and fee settlement/rounding/idempotency, plus UI or component coverage for balance interaction and attack arsenal when the project has suitable test infrastructure.
4. Run the relevant lint, typecheck, and tests. Manually verify the match flow if a local environment supports it. Report commands, outcomes, changed files, remaining assumptions, and any migration/deployment ordering.

## Acceptance cases

| Scenario | Expected outcome |
| --- | --- |
| Tap any of the three balance icons or amounts | Correct verified explanation opens; no balance change |
| Opponent appears at 39 seconds | One human online match; no bot |
| No opponent by 40 seconds | Queue is exited; one explicitly identified offline bot match begins |
| Opponent appears during timeout transition | Exactly one match wins the race; no orphaned queue/stake |
| User cancels search | No later bot launch, no online charge |
| Attack turn opens arsenal | Mine is absent and cannot be submitted as an attack |
| Defense or placement allows mines | Mine still works according to existing rules |
| Eligible human match gross award 200 points | Winner receives 190; platform fee records 10 |
| Eligible human match gross award 1 point | Under preferred rounding, winner receives 1; fee records 0 |
| Result event or settlement is retried | One payout and one fee only |
| Bot fallback/offline/cancel/refund/no contest | No online platform fee; stake released or handled by existing refund rule |

## Product choices to verify against the repository

- Exact names and purposes of blue points, golden points, and green gems.
- Whether matchmaking is authoritative on the server and how a queued request is canceled.
- Whether online awards are a pooled pot, a fixed prize, or a token transfer, and how platform revenue is represented.
- Whether offline bot games support the selected board size, loadout, and wager mode. Convert unsupported settings safely and explain the change to the player.
