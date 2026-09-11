/**
 * The live match on this device. Holds the authoritative MatchState (offline
 * modes) or the last server state (online, P13), and `shown` — the view the
 * screen renders, advanced one event at a time by the EventPlayer.
 *
 * The screen never inspects `match` to decide what to draw. It draws `shown`.
 *
 * Mode plumbing: 'ai' drives the opponent with src/engine/ai.ts on a
 * 900-1400 ms "thinking" delay; 'hotseat' swaps the viewer between turns
 * behind a pass-the-device curtain (P14 dresses it up); 'online' is fed by
 * P13's server messages. All three feed the same EventPlayer.
 */
import { chooseMove, type Difficulty } from '@engine/ai';
import { coordKey } from '@engine/board';
import { createMatch, projectView, reduce } from '@engine/match';
import { autoPlaceFleet } from '@engine/placement';
import { createRng } from '@engine/rng';
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
}

export const AIM_MS = 260;
let AI_THINK_MIN_MS = 900;
let AI_THINK_SPREAD_MS = 500;

/** Test/dev hook: make the AI think faster (or slower). */
export function setAiThinkTime(minMs: number, spreadMs: number): void {
  AI_THINK_MIN_MS = minMs;
  AI_THINK_SPREAD_MS = spreadMs;
}

interface BattleData {
  mode: BattleMode;
  ruleset: MatchMode;
  match: MatchState | null;
  /** Whose eyes we look through. Swaps in hotseat. */
  me: string;
  combatants: Record<string, Combatant>;
  shown: PlayerView | null;
  animating: boolean;
  /** Countdown for the current turn. */
  seconds: number;
  /** The last flip followed a mine — snap it. */
  snapTurn: boolean;
  /** Where the crosshair is converging before a shot. */
  aiming: Coord | null;
  /** Hotseat: waiting for the device to be passed. */
  curtain: boolean;
  /** GAME_OVER has played out; the screen may route to the result. */
  finished: boolean;
  difficulty: Difficulty;
  /** Emote floating over the opponent, if any. */
  emote: { id: number; nonce: number } | null;
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
  dismissCurtain: () => void;
  showEmote: (id: number) => void;
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
  me: '',
  combatants: {},
  shown: null,
  animating: false,
  seconds: TURN_SECONDS,
  snapTurn: false,
  aiming: null,
  curtain: false,
  finished: false,
  difficulty: 'normal',
  emote: null,
  lastAction: null,
  lastEvents: [],
  arsenalOpen: false,
  targeting: null,
};

let aiTimer: ReturnType<typeof setTimeout> | null = null;
let aimTimer: ReturnType<typeof setTimeout> | null = null;
let emoteTimer: ReturnType<typeof setTimeout> | null = null;
let lastWasMine = false;

function clearTimers(): void {
  if (aiTimer) clearTimeout(aiTimer);
  if (aimTimer) clearTimeout(aimTimer);
  if (emoteTimer) clearTimeout(emoteTimer);
  aiTimer = aimTimer = emoteTimer = null;
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

export function markFinished(): void {
  useBattle.setState({ finished: true });
}

function opponentOf(state: BattleData, id: string): string {
  const ids = Object.keys(state.combatants);
  return ids[0] === id ? (ids[1] as string) : (ids[0] as string);
}

/** A random unknown enemy cell — the offline timeout shot. */
function randomLegalCell(view: PlayerView, seed: number): Coord | null {
  const unknown: Coord[] = [];
  for (let r = 0; r < 10; r++)
    for (let c = 0; c < 10; c++) if (!view.enemy.marks[coordKey({ r, c })]) unknown.push({ r, c });
  if (unknown.length === 0) return null;
  return createRng(seed).pick(unknown);
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
  if (!s.match) return;
  const shown = projectView(s.match, s.me);
  useBattle.setState({ shown });
  if (s.match.phase === 'over') {
    // The queue drained after the GAME_OVER hold: the screen may route now.
    useBattle.setState({ finished: true });
    return;
  }
  if (s.match.turn === s.me) return;

  if (s.mode === 'ai') scheduleAi();
  else if (s.mode === 'hotseat') useBattle.setState({ curtain: true });
  // online: the server's next message drives the loop (P13)
}

function scheduleAi(): void {
  const s = useBattle.getState();
  if (!s.match || s.match.phase !== 'playing' || s.match.turn === s.me) return;
  if (aiTimer) clearTimeout(aiTimer);
  const rng = createRng(s.match.seed * 31 + s.match.moves);
  const delay = AI_THINK_MIN_MS + rng.int(AI_THINK_SPREAD_MS + 1);
  aiTimer = setTimeout(() => {
    aiTimer = null;
    const now = useBattle.getState();
    if (
      !now.match ||
      now.match.phase !== 'playing' ||
      now.match.turn === now.me ||
      battlePlayer.busy
    )
      return;
    const ai = now.match.turn;
    const view = projectView(now.match, ai);
    const action = chooseMove(
      view,
      now.difficulty,
      createRng(now.match.seed * 17 + now.match.moves),
    );
    now.act(action);
  }, delay);
}

battlePlayer.onBusy((busy) => {
  useBattle.setState({ animating: busy });
  if (!busy) onIdle();
});

export const useBattle = create<BattleState>((set, get) => ({
  ...EMPTY,

  start: (setup) => {
    clearTimers();
    battlePlayer.clear();
    lastWasMine = false;

    let match = createMatch({
      id: `local-${setup.seed}`,
      mode: setup.ruleset,
      seed: setup.seed,
      playerIds: [setup.one.id, setup.two.id],
    });
    for (const side of [setup.one, setup.two]) {
      const rng = createRng(setup.seed + side.id.length);
      let r = reduce(match, {
        type: 'SUBMIT_LAYOUT',
        playerId: side.id,
        ships: side.ships,
        arsenal: side.arsenal,
      });
      if (r.events.some((e) => e.type === 'REJECTED')) {
        console.warn(`[battle] layout for ${side.id} rejected, auto-placing:`, r.events);
        r = reduce(match, {
          type: 'SUBMIT_LAYOUT',
          playerId: side.id,
          ships: autoPlaceFleet(rng),
          arsenal: [],
        });
      }
      match = r.state;
    }
    if (match.phase !== 'playing') throw new Error('battle could not start');

    const me = setup.mode === 'hotseat' ? match.turn : setup.one.id;
    set({
      ...EMPTY,
      mode: setup.mode,
      ruleset: setup.ruleset,
      match,
      me,
      combatants: { [setup.one.id]: setup.one, [setup.two.id]: setup.two },
      shown: projectView(match, me),
      difficulty: setup.difficulty ?? 'normal',
      seconds: TURN_SECONDS,
    });
    if (setup.mode === 'ai' && match.turn !== me) scheduleAi();
  },

  aim: (at) => {
    const s = get();
    if (!s.match || !s.shown) return;
    if (s.animating || s.aiming || s.curtain || s.finished) return;
    if (s.match.phase !== 'playing' || s.match.turn !== s.me) return;
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
    set({ aiming: at });
    aimTimer = setTimeout(() => {
      aimTimer = null;
      set({ aiming: null });
      get().fire(at);
    }, AIM_MS);
  },

  fire: (at) => {
    const s = get();
    if (!s.match || s.animating || s.match.phase !== 'playing' || s.match.turn !== s.me) return;
    get().act({ type: 'FIRE', playerId: s.me, at });
  },

  act: (action) => {
    const s = get();
    if (!s.match || s.match.phase !== 'playing') return;
    const r = reduce(s.match, action);
    if (r.events.some((e) => e.type === 'REJECTED')) return;
    set({ match: r.state, lastAction: action, lastEvents: r.events });
    battlePlayer.enqueue(withShotEvent(action, r.events));
  },

  tick: () => {
    const s = get();
    if (!s.match || s.match.phase !== 'playing' || s.animating || s.curtain || s.aiming) return;
    if (s.seconds > 1) {
      set({ seconds: s.seconds - 1 });
      return;
    }
    set({ seconds: 0 });
    if (s.mode === 'online' || s.mode === 'tutorial') return; // the server / the script decides
    if (s.match.turn !== s.me) return; // the AI never lets the clock run out
    const view = s.shown ?? projectView(s.match, s.me);
    const at = randomLegalCell(view, s.match.seed + s.match.moves * 7);
    if (at) get().fire(at);
  },

  skip: () => battlePlayer.skip(),

  dismissCurtain: () => {
    const s = get();
    if (!s.match) return;
    const me = s.match.turn;
    set({ curtain: false, me, shown: projectView(s.match, me), seconds: TURN_SECONDS });
  },

  setArsenalOpen: (open) => set({ arsenalOpen: open }),

  selectArsenal: (itemId) => {
    if (itemId === null) {
      set({ targeting: null });
      return;
    }
    const s = get();
    const item = s.shown?.you.board.arsenal.find((i) => i.id === itemId);
    if (!item || item.used || item.destroyed || item.at !== undefined) return;
    set({ targeting: { itemId, kind: item.kind }, arsenalOpen: false });
  },

  showEmote: (id) => {
    if (emoteTimer) clearTimeout(emoteTimer);
    set((s) => ({ emote: { id, nonce: (s.emote?.nonce ?? 0) + 1 } }));
    emoteTimer = setTimeout(() => set({ emote: null }), 1600);
  },

  reset: () => {
    clearTimers();
    battlePlayer.clear();
    set({ ...EMPTY });
  },
}));

/** The opponent of the current viewer, for the HUD. */
export function selectOpponent(state: BattleState): Combatant | null {
  if (!state.match) return null;
  return state.combatants[opponentOf(state, state.me)] ?? null;
}
