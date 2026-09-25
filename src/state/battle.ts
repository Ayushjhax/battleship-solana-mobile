/**
 * The live match on this device. Holds the authoritative MatchState (offline
 * modes) or the last server view (online, P13), and `shown` — the view the
 * screen renders, advanced one event at a time by the EventPlayer.
 *
 * The screen never inspects `match` to decide what to draw. It draws `shown`.
 *
 * Mode plumbing: 'ai' drives the opponent with src/engine/ai.ts on a
 * 900-1400 ms "thinking" delay; 'hotseat' swaps the viewer the moment the
 * turn changes hands and drops a paper sheet over the incoming player's own
 * board (`fleetCovered`) until they lift it; 'online' is fed by
 * src/net/match-client.ts. All of them feed the same EventPlayer.
 *
 * Online: there is no `match` here at all — the server owns both boards and
 * this store only ever sees projectView() output (`onlineView`). Input
 * guards read `shown` (phase, turn), which is in sync with the truth
 * whenever `animating` is false, in every mode. The optimistic shot (P13):
 * `act()` enqueues the SHOT_FIRED shell at once and sends the action; the
 * outcome is only ever what the server's events say. `pending` locks input
 * until they land, and `pendingShotAt` is the "…" on the target cell once
 * the shell has landed with nothing to show yet.
 */
import type { Difficulty } from '@engine/ai';
import { coordKey } from '@engine/board';
import { projectView } from '@engine/match';
import {
  TURN_SECONDS,
  type ArsenalItem,
  type ArsenalKind,
  type Coord,
  type MatchAction,
  type MatchEvent,
  type MatchMode,
  type MatchState,
  type PlayerView,
  type Ship,
} from '@engine/types';
import { create } from 'zustand';

import { EventPlayer, type PlayEvent } from '@/fx/EventPlayer';
import { applyEvent, applyReveal } from '@/fx/applyEvent';
import { LocalMatch, setLocalAiThinkTime } from '@/features/offline/LocalMatch';
import { useMatchClient } from '@/net/match-client';
import { usePoints } from '@/state/points';
import { useProfile } from '@/state/profile';

export type BattleMode = 'ai' | 'hotseat' | 'online' | 'tutorial';

export interface Combatant {
  readonly id: string;
  readonly name: string;
  readonly points: number;
  readonly avatarId: number;
  readonly avatarColor: string;
  readonly countryCode: string;
  readonly ships: readonly Ship[];
  readonly arsenal: readonly ArsenalItem[];
}

export interface BattleSetup {
  readonly mode: BattleMode;
  readonly ruleset: MatchMode;
  readonly seed: number;
  readonly one: Combatant;
  readonly two: Combatant;
  readonly difficulty?: Difficulty;
  /** Online: the server's match id (the Realtime emote channel key). */
  readonly matchId?: string;
}

export const AIM_MS = 260;

/** Test/dev hook: make the AI think faster (or slower). */
export function setAiThinkTime(minMs: number, spreadMs: number): void {
  setLocalAiThinkTime(minMs, spreadMs);
}

interface BattleData {
  mode: BattleMode;
  ruleset: MatchMode;
  /** Offline modes only. Online, the server owns it and this stays null. */
  match: MatchState | null;
  /** Every mode. Server-created matches have uuid ids; local ones "local-…". */
  matchId: string | null;
  /** The device owner's player id. Hot-seat rewards are judged for this player. */
  ownerId: string;
  /** Unique idempotency key for a locally awarded result. */
  resultId: string | null;
  /**
   * An offline wager is riding on this match — the stake was taken before the
   * first shot. Captured at start() so a settlement still queued from an
   * earlier match can never make this one look wagered.
   */
  wagered: boolean;
  /** Whose eyes we look through. Swaps in hotseat. */
  me: string;
  combatants: Record<string, Combatant>;
  shown: PlayerView | null;
  /** Online: the last authoritative view from the server, reconciled into `shown` when idle. */
  onlineView: PlayerView | null;
  animating: boolean;
  /** Countdown for the current turn. */
  seconds: number;
  /** The last flip followed a mine — snap it. */
  snapTurn: boolean;
  /** Where the crosshair is converging before a shot. */
  aiming: Coord | null;
  /** Online: an action is in flight; input stays locked until the server answers. */
  pending: boolean;
  /** Online: our shell is away (or landed) and no verdict yet — the "…" cell. */
  pendingShotAt: Coord | null;
  /**
   * Online: an arsenal item is deployed and awaiting the server's events.
   * FIRE has flown its shell locally since P13, so a shot reads as instant;
   * USE_ARSENAL sent and then showed nothing at all until the round trip came
   * back, which on a distant server is most of a second of dead screen.
   */
  pendingArsenalAt: Coord | null;
  /**
   * Hotseat: the device is changing hands. The incoming player's own board
   * sits under an opaque paper sheet with their name on it, the turn clock
   * waits, and nothing of theirs — a shot, the arsenal — goes until they lift
   * it. Only the own board is covered: the enemy board shows nothing the
   * outgoing player did not already know, so the game stays in view.
   */
  fleetCovered: boolean;
  /** GAME_OVER has played out; the screen may route to the result. */
  finished: boolean;
  difficulty: Difficulty;
  /**
   * Emotes rising up the screen, Google Meet style: yours from your side,
   * the opponent's from theirs. Each removes itself when its rise is over.
   */
  emotes: readonly { key: number; id: number; from: 'me' | 'them' }[];
  /** The last accepted action and the events it produced — the tutorial watches these. */
  lastAction: MatchAction | null;
  lastEvents: readonly MatchEvent[];
  /** The Arsenal popover (P08) is open. */
  arsenalOpen: boolean;
  /** A weapon is selected and the next enemy-board tap fires it. */
  targeting: { itemId: string; kind: ArsenalKind } | null;
}

interface BattleActions {
  start: (setup: BattleSetup) => void;
  /** Tap on the enemy board: crosshair, then fire. */
  aim: (at: Coord) => void;
  fire: (at: Coord) => void;
  /** Apply an action on behalf of any player (server messages, hotseat). */
  act: (action: MatchAction) => void;
  tick: () => void;
  skip: () => void;
  /** Hotseat: the incoming player has the device — lift the sheet, start the clock. */
  uncoverFleet: () => void;
  showEmote: (id: number, from?: 'me' | 'them') => void;
  setArsenalOpen: (open: boolean) => void;
  /** Enter targeting with one of your unused offensive items; null cancels. */
  selectArsenal: (itemId: string | null) => void;
  reset: () => void;
}

export type BattleState = BattleData & BattleActions;

const EMPTY: BattleData = {
  mode: 'ai',
  ruleset: 'classic',
  match: null,
  matchId: null,
  ownerId: '',
  resultId: null,
  wagered: false,
  me: '',
  combatants: {},
  shown: null,
  onlineView: null,
  animating: false,
  seconds: TURN_SECONDS,
  snapTurn: false,
  aiming: null,
  pending: false,
  pendingShotAt: null,
  pendingArsenalAt: null,
  fleetCovered: false,
  finished: false,
  difficulty: 'normal',
  emotes: [],
  lastAction: null,
  lastEvents: [],
  arsenalOpen: false,
  targeting: null,
};

let aimTimer: ReturnType<typeof setTimeout> | null = null;
/** How long an emote takes to rise and fade; FloatingEmote in Hud.tsx plays it. */
export const EMOTE_RISE_MS = 2600;
const emoteTimers = new Set<ReturnType<typeof setTimeout>>();
let emoteKey = 0;
let lastWasMine = false;
let onlineUnsubscribe: (() => void) | null = null;
let localMatch: LocalMatch | null = null;

function clearTimers(): void {
  if (aimTimer) clearTimeout(aimTimer);
  for (const timer of emoteTimers) clearTimeout(timer);
  emoteTimers.clear();
  aimTimer = null;
}

/** Headless effects: commit only. The screen swaps in the animated ones. */
export const battlePlayer = new EventPlayer({
  animate: async () => {},
  commit: (event) => commitEvent(event),
});

export function commitEvent(event: PlayEvent): void {
  const { shown } = useBattle.getState();
  if (!shown) return;
  const patch: Partial<BattleData> = { shown: applyEvent(shown, event) };
  if (event.type === 'TURN_CHANGED') {
    patch.seconds = TURN_SECONDS;
    patch.snapTurn = lastWasMine;
  }
  lastWasMine = event.type === 'MINE_TRIGGERED';
  useBattle.setState(patch);
}

export function commitReveal(actorId: string, cell: Coord): void {
  const { shown } = useBattle.getState();
  if (!shown) return;
  useBattle.setState({ shown: applyReveal(shown, actorId, cell) });
}

function finishLocalResult(): void {
  const state = useBattle.getState();
  if (
    !state.finished &&
    (state.mode === 'ai' || state.mode === 'hotseat') &&
    state.resultId &&
    state.ownerId &&
    state.shown?.winner
  ) {
    const won = state.shown.winner === state.ownerId;
    useProfile.getState().queueResult({
      id: state.resultId,
      mode: state.mode,
      won,
      completedAt: new Date().toISOString(),
    });
    // A wager on this match becomes a settlement the result screen sends and
    // the app retries until it lands. No-op when nothing was staked.
    if (state.wagered) usePoints.getState().finishWager(won);
  }
  useBattle.setState({ finished: true });
}

export function markFinished(): void {
  finishLocalResult();
}

function opponentOf(state: BattleData, id: string): string {
  const ids = Object.keys(state.combatants);
  return ids[0] === id ? (ids[1] as string) : (ids[0] as string);
}

function withShotEvent(action: MatchAction, events: readonly MatchEvent[]): PlayEvent[] {
  const shot: PlayEvent[] =
    action.type === 'FIRE'
      ? [{ type: 'SHOT_FIRED', playerId: action.playerId, at: action.at }]
      : [];
  return [...shot, ...events];
}

/** After the queue drains: resync the view, then hand the turn to whoever drives it. */
function onIdle(): void {
  const s = useBattle.getState();
  if (s.mode === 'online') {
    // The server's next message drives the loop; we only settle the view.
    reconcileOnlineView();
    return;
  }
  const match = localMatch?.state ?? s.match;
  if (!match) return;
  const shown = projectView(match, s.me);
  useBattle.setState({ shown, arsenalOpen: false, targeting: null });
  if (match.phase === 'over') {
    // The queue drained after the GAME_OVER hold: the screen may route now.
    finishLocalResult();
    return;
  }
  if (match.turn === s.me) return;
  if (s.mode === 'hotseat') {
    // The turn changed hands. The view swaps to the next player here and
    // now — `me` must move or player two could never act — and in the same
    // commit their own board goes under the sheet, so no frame ever shows
    // the incoming fleet to whoever is still holding the device.
    //
    // This used to raise a full-screen modal every single turn: three lines
    // of the same instruction and a Ready button after every miss. The sheet
    // covers only what is secret, says just whose it is, and lifts on a tap.
    const next = match.turn;
    useBattle.setState({
      me: next,
      shown: projectView(match, next),
      seconds: TURN_SECONDS,
      // The triangle is already pointing at the new player; do not rotate it
      // a second time for a view that changed identity rather than turn.
      snapTurn: true,
      fleetCovered: true,
    });
    return;
  }
  localMatch?.driveAi();
}

battlePlayer.onBusy((busy) => {
  useBattle.setState({ animating: busy });
  if (!busy) onIdle();
});

// ---------------------------------------------------------------------------
// Online — src/net/match-client.ts feeds the same EventPlayer
// ---------------------------------------------------------------------------

/** Snap `shown` to the server's last view. Only ever called when the queue is idle. */
function reconcileOnlineView(): void {
  const s = useBattle.getState();
  if (s.mode !== 'online' || !s.onlineView) return;
  const view = s.onlineView;
  const acted = !s.shown || s.shown.moves !== view.moves || s.shown.phase !== view.phase;
  const patch: Partial<BattleData> = { shown: view };
  if (acted) {
    patch.arsenalOpen = false;
    patch.targeting = null;
  }
  if (view.phase === 'over') patch.finished = true;
  useBattle.setState(patch);
}

function receiveOnlineView(view: PlayerView): void {
  useBattle.setState({ onlineView: view });
  if (!battlePlayer.busy) reconcileOnlineView();
}

/** A live batch from the server — the animation script, straight into the queue. */
function receiveOnlineEvents(events: readonly MatchEvent[]): void {
  const s = useBattle.getState();
  if (s.mode !== 'online' || events.length === 0) return;
  const first = events[0] as MatchEvent;
  // Our own shot already flew when we sent it (act). The opponent's gets its
  // shell here, so both boards read the same way: arc, then verdict.
  const shotLike = first.type === 'HIT' || first.type === 'MISS' || first.type === 'MINE_TRIGGERED';
  const prefix: PlayEvent[] =
    shotLike && first.playerId !== s.me
      ? [{ type: 'SHOT_FIRED', playerId: first.playerId, at: first.at }]
      : [];
  useBattle.setState({
    pending: false,
    pendingShotAt: null,
    pendingArsenalAt: null,
    lastEvents: events,
  });
  battlePlayer.enqueue([...prefix, ...events]);
}

function onOnlineError(error: { code: string; message: string } | null): void {
  const s = useBattle.getState();
  if (s.mode !== 'online') return;
  if (s.pending) {
    // The server said no (or couldn't say yes). Nothing was applied on either
    // side; unlock and let the player try again. The next state resyncs us.
    console.warn(
      `[battle] action refused by the server: ${error?.code ?? '?'} ${error?.message ?? ''}`,
    );
    useBattle.setState({ pending: false, pendingShotAt: null, pendingArsenalAt: null });
  }
}

function wireOnline(): void {
  unwireOnline();
  onlineUnsubscribe = useMatchClient.subscribe((next, prev) => {
    if (prev.status === 'reconnecting' && next.status === 'active') {
      // Resynced: whatever we had in flight is either applied or lost. The
      // fresh view (below) is the truth; drop the optimistic leftovers.
      useBattle.setState({ pending: false, pendingShotAt: null, pendingArsenalAt: null });
      battlePlayer.skip();
    }
    if (next.eventsNonce !== prev.eventsNonce) receiveOnlineEvents(next.takePendingEvents());
    if (next.view !== prev.view && next.view) receiveOnlineView(next.view);
    if (next.errorNonce !== prev.errorNonce) onOnlineError(next.lastError);
  });
  // Anything that landed before the battle screen mounted.
  const mc = useMatchClient.getState();
  if (mc.pendingEvents.length > 0) receiveOnlineEvents(mc.takePendingEvents());
  if (mc.view) receiveOnlineView(mc.view);
}

function unwireOnline(): void {
  if (onlineUnsubscribe) onlineUnsubscribe();
  onlineUnsubscribe = null;
}

// ---------------------------------------------------------------------------

export const useBattle = create<BattleState>((set, get) => ({
  ...EMPTY,

  start: (setup) => {
    clearTimers();
    unwireOnline();
    localMatch?.dispose();
    localMatch = null;
    battlePlayer.clear();
    lastWasMine = false;

    if (setup.mode === 'online') {
      set({
        ...EMPTY,
        mode: 'online',
        ruleset: setup.ruleset,
        matchId: setup.matchId ?? null,
        ownerId: setup.one.id,
        me: setup.one.id,
        combatants: { [setup.one.id]: setup.one, [setup.two.id]: setup.two },
        seconds: TURN_SECONDS,
      });
      wireOnline();
      return;
    }

    const localMode =
      setup.mode === 'hotseat' ? 'hotseat' : setup.mode === 'tutorial' ? 'tutorial' : 'ai';
    const local = new LocalMatch({
      mode: localMode,
      ruleset: setup.ruleset,
      seed: setup.seed,
      one: setup.one,
      two: setup.two,
      difficulty: setup.difficulty ?? 'normal',
      onResolved: (action, result) => {
        useBattle.setState({
          match: result.state,
          lastAction: action,
          lastEvents: result.events,
        });
        battlePlayer.enqueue(withShotEvent(action, result.events));
      },
    });
    localMatch = local;
    const match = local.state;

    const me = setup.mode === 'hotseat' ? match.turn : setup.one.id;
    set({
      ...EMPTY,
      mode: setup.mode,
      ruleset: setup.ruleset,
      match,
      matchId: match.id,
      ownerId: setup.one.id,
      resultId: `${match.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      wagered: setup.mode === 'ai' && usePoints.getState().activeWager !== null,
      me,
      combatants: { [setup.one.id]: setup.one, [setup.two.id]: setup.two },
      shown: projectView(match, me),
      difficulty: setup.difficulty ?? 'normal',
      seconds: TURN_SECONDS,
      // Hotseat: player two placed last, so the device is in their hands and
      // player one's fleet — whose turn it is — starts under the sheet.
      fleetCovered: setup.mode === 'hotseat',
    });
    local.driveAi();
  },

  aim: (at) => {
    const s = get();
    if (!s.shown || (s.mode !== 'online' && !s.match)) return;
    if (s.animating || s.aiming || s.fleetCovered || s.finished || s.pending) return;
    if (s.shown.phase !== 'playing' || s.shown.turn !== s.me) return;
    if (s.targeting) {
      // A weapon is armed: the tap is its target. Rows for torpedo kinds.
      const { itemId, kind } = s.targeting;
      set({ targeting: null });
      const rowKind = kind === 'torpedoBomber' || kind === 'doubleTorpedoBomber';
      get().act(
        rowKind
          ? { type: 'USE_ARSENAL', playerId: s.me, itemId, row: at.r }
          : { type: 'USE_ARSENAL', playerId: s.me, itemId, at },
      );
      return;
    }
    if (s.shown.enemy.marks[coordKey(at)]) return;

    // Online, the crosshair's 260 ms ran BEFORE the request left the device,
    // so it sat on top of the round trip rather than inside it: a tap cost
    // AIM_MS + RTT before anything could resolve. The shell is the feedback
    // that matters, and `act` flies it locally the moment it is called, so
    // online skips straight to it and the network starts at the tap.
    //
    // Enqueuing before sending also keeps the order honest: the server's
    // verdict can never be queued ahead of the shell that precedes it, which
    // it could if the crosshair delayed the enqueue on a fast connection.
    if (s.mode === 'online') {
      get().fire(at);
      return;
    }

    set({ aiming: at });
    aimTimer = setTimeout(() => {
      aimTimer = null;
      set({ aiming: null });
      get().fire(at);
    }, AIM_MS);
  },

  fire: (at) => {
    const s = get();
    if (!s.shown || (s.mode !== 'online' && !s.match)) return;
    if (s.animating || s.pending || s.shown.phase !== 'playing' || s.shown.turn !== s.me) return;
    get().act({ type: 'FIRE', playerId: s.me, at });
  },

  act: (action) => {
    const s = get();
    if (s.mode === 'online') {
      if (!s.shown || s.shown.phase !== 'playing' || s.pending) return;
      const client = useMatchClient.getState();
      if (action.type === 'FIRE') {
        // Optimistic: the shell flies now. The verdict is the server's alone.
        set({ pending: true, pendingShotAt: action.at, pendingArsenalAt: null, lastAction: action });
        battlePlayer.enqueue([{ type: 'SHOT_FIRED', playerId: s.me, at: action.at }]);
        client.fire(action.at);
      } else if (action.type === 'USE_ARSENAL') {
        // Mark the target immediately. This says "sent", never an outcome —
        // the verdict is still the server's alone.
        const mark: Coord | null =
          action.at ?? (action.row === undefined ? null : { r: action.row, c: 0 });
        set({ pending: true, pendingArsenalAt: mark, pendingShotAt: null, lastAction: action });
        client.useArsenal(action.itemId, { at: action.at, row: action.row });
      } else if (action.type === 'RESIGN') {
        client.resign();
      }
      return;
    }
    localMatch?.dispatch(action);
  },

  tick: () => {
    const s = get();
    if (s.mode === 'online') {
      // The server's clock, counted from when its `turn` message landed here
      // (phone clocks drift; the 2 s latency grace is deliberately not shown).
      const at = useMatchClient.getState().turnReceivedAt;
      if (!s.shown || s.shown.phase !== 'playing' || at === null) return;
      const seconds = Math.max(0, TURN_SECONDS - Math.floor((Date.now() - at) / 1000));
      if (seconds !== s.seconds) set({ seconds });
      return;
    }
    if (!s.match || s.match.phase !== 'playing' || s.animating || s.fleetCovered || s.aiming)
      return;
    if (s.seconds > 1) {
      set({ seconds: s.seconds - 1 });
      return;
    }
    set({ seconds: 0 });
    if (s.mode === 'tutorial' || s.match.turn !== s.me) return;
    get().act({ type: 'TIMEOUT', playerId: s.me });
  },

  skip: () => battlePlayer.skip(),

  uncoverFleet: () => {
    // `me` already moved at the handover; this only lifts the sheet. The
    // clock starts here: the seconds spent passing the phone were nobody's.
    if (get().fleetCovered) set({ fleetCovered: false, seconds: TURN_SECONDS });
  },

  setArsenalOpen: (open) => {
    const state = get();
    if (
      open &&
      (state.ruleset !== 'advanced' ||
        !state.shown ||
        state.shown.phase !== 'playing' ||
        state.shown.turn !== state.me ||
        state.animating ||
        state.pending ||
        state.fleetCovered ||
        state.finished)
    )
      return;
    set({ arsenalOpen: open, ...(open ? { targeting: null } : {}) });
  },

  selectArsenal: (itemId) => {
    if (itemId === null) {
      set({ targeting: null });
      return;
    }
    const s = get();
    const item = s.shown?.you.board.arsenal.find((i) => i.id === itemId);
    if (
      s.ruleset !== 'advanced' ||
      !s.shown ||
      s.shown.phase !== 'playing' ||
      s.shown.turn !== s.me ||
      s.animating ||
      s.pending ||
      s.fleetCovered ||
      s.finished ||
      !item ||
      item.used ||
      item.destroyed ||
      item.kind === 'aaGun' ||
      item.kind === 'mine'
    ) {
      return;
    }
    set({ targeting: { itemId, kind: item.kind }, arsenalOpen: false });
  },

  showEmote: (id, from = 'me') => {
    const key = ++emoteKey;
    // A burst of taps stacks; past six the oldest makes way.
    set((s) => ({ emotes: [...s.emotes.slice(-5), { key, id, from }] }));
    const timer = setTimeout(() => {
      emoteTimers.delete(timer);
      set((s) => ({ emotes: s.emotes.filter((e) => e.key !== key) }));
    }, EMOTE_RISE_MS + 100);
    emoteTimers.add(timer);
  },

  reset: () => {
    clearTimers();
    unwireOnline();
    localMatch?.dispose();
    localMatch = null;
    battlePlayer.clear();
    set({ ...EMPTY });
  },
}));

/** The opponent of the current viewer, for the HUD. */
export function selectOpponent(state: BattleState): Combatant | null {
  if (Object.keys(state.combatants).length < 2) return null;
  return state.combatants[opponentOf(state, state.me)] ?? null;
}
