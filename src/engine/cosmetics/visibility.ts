/**
 * What the opponent sees — part-03 §3, tested by §6.2 and §6.4.
 * **This file closes DECISIONS D12.**
 *
 * §3: "**No hidden information may leak.** Cosmetics travel in the match
 * payload as a small `cosmetics` object per player at arena reveal. It
 * contains no positions. Enemy ships are still drawn only when the rules have
 * made them public."
 *
 * ─────────────────────────────────────────────────────────────────────────
 * D12, RESOLVED: opponent hull cosmetics render on SUNK ships only.
 *
 * Ghost fleet is "existing masks at 45% alpha with a dashed overlay and a
 * **slow drift**" (§2). A drifting sprite on an enemy cell the rules have not
 * made public would announce a ship's presence — which is an information
 * boundary, and the hard rule for this part is to stop rather than ship that.
 *
 * The resolution is that there is no conflict once the scope is right.
 * `opponentHullVisible()` returns true only for cells that are ALREADY public:
 * a sunk ship's cells are all marked 'sunk', and the whole hull is drawn as a
 * wreck. A drifting wreck reveals nothing, because the wreck itself is the
 * reveal. §1's table ("Hull set — seen by the opponent? yes, same rule as
 * ink") is satisfied exactly, and no boundary moves.
 *
 * What does NOT ship: any hull cosmetic on an un-sunk enemy ship. There is no
 * flag for it and no code path to it.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { COSMETIC_SLOTS, DEFAULTS, OPPONENT_VISIBLE, cosmeticById, type CosmeticSlot, type Equipped } from './catalogue';

/** §3's "small `cosmetics` object per player". It contains NO positions. */
export interface CosmeticPayload {
  readonly fleetInk: string;
  readonly pen: string;
  readonly hullSet: string;
  readonly sinkEffect: string;
  readonly victoryStamp: string;
}

/**
 * What one player's cosmetics look like ON THE WIRE.
 *
 * `paper` is deliberately absent: §1 says it is "for you only", so it never
 * leaves the device that chose it. Omitting it from the type is stronger than
 * remembering not to send it.
 */
export function payloadFor(equipped: Equipped): CosmeticPayload {
  return {
    fleetInk: equipped.fleetInk,
    pen: equipped.pen,
    hullSet: equipped.hullSet,
    sinkEffect: equipped.sinkEffect,
    victoryStamp: equipped.victoryStamp,
  };
}

/** Every slot the payload may carry — the inverse is the privacy guarantee. */
export const PAYLOAD_SLOTS: readonly CosmeticSlot[] = COSMETIC_SLOTS.filter(
  (slot) => OPPONENT_VISIBLE[slot],
);

/**
 * D12's answer. Is an opponent's hull cosmetic allowed on this cell?
 *
 * ONLY when the ship is sunk. Not "revealed", not "hit", not "adjacent to a
 * sunk one" — sunk, which is the state in which every one of its cells is
 * already marked and the whole hull is already drawn.
 */
export function opponentHullVisible(ship: { sunk: boolean }): boolean {
  return ship.sunk;
}

/**
 * The same question for ink and pen. §1: "yes, on cells they have proven
 * (sunk ships, revealed items)".
 */
export function opponentInkVisible(cell: { proven: boolean }): boolean {
  return cell.proven;
}

// ---------------------------------------------------------------------------
// §3 — "If the opponent's client does not know an effect id, it falls back to
// the default — never a crash, never a blocking download."
// ---------------------------------------------------------------------------

/**
 * Resolves an id that arrived from another client, which may be running a
 * newer catalogue. An unknown id is not an error: it is an older app meeting
 * a newer one, which will happen on every release.
 */
export function resolveRemote(slot: CosmeticSlot, id: string | undefined): string {
  const cosmetic = id ? cosmeticById(id) : null;
  return cosmetic && cosmetic.slot === slot ? cosmetic.id : DEFAULTS[slot];
}

/** A whole remote payload, made safe. Never throws, never returns undefined. */
export function resolveRemotePayload(raw: Partial<CosmeticPayload> | null | undefined): CosmeticPayload {
  return {
    fleetInk: resolveRemote('fleetInk', raw?.fleetInk),
    pen: resolveRemote('pen', raw?.pen),
    hullSet: resolveRemote('hullSet', raw?.hullSet),
    sinkEffect: resolveRemote('sinkEffect', raw?.sinkEffect),
    victoryStamp: resolveRemote('victoryStamp', raw?.victoryStamp),
  };
}

// ---------------------------------------------------------------------------
// §3 — "must be short (<= 600 ms) and must not delay the turn flip"
// ---------------------------------------------------------------------------

/** §3's cap. A sink effect plays on BOTH screens, so it is on the critical path. */
export const MAX_SINK_EFFECT_MS = 600;

/**
 * Part 2's own finding, carried forward: the user selected "Cap sink effects
 * at 420 ms" from three proposed changes, so the shipped cap is tighter than
 * §3's ceiling. §3 is the rule; 420 is the setting.
 */
export const SINK_EFFECT_MS = 420;

export function sinkEffectDuration(id: string): number {
  const cosmetic = cosmeticById(id);
  const declared = cosmetic?.durationMs ?? SINK_EFFECT_MS;
  // Never longer than the cap, whatever an item claims.
  return Math.min(declared, MAX_SINK_EFFECT_MS);
}

/**
 * §6.5 — "Sink effects all complete within 600 ms and **never delay the turn
 * flip**". The turn flip does not wait for the effect: the effect is fired and
 * the flip proceeds, so this returns the delay the flip should take, which is
 * always zero.
 */
export const TURN_FLIP_DELAY_MS = 0;
