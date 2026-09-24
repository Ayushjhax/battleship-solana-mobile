/**
 * Quick chat — part-08 §2, tested by §7.8.
 *
 * §2 is a scoping decision, not a limitation, and it is worth restating where
 * someone might otherwise "just add a TextInput":
 *
 *   "The game has no OS keyboard by design ... and free text means moderation,
 *    reporting and a minor-safety burden nobody has scoped. ... Free text stays
 *    behind a `fleets.freeText` flag, default off, and **does not ship** until
 *    moderation, muting and reporting are designed."
 *
 * So THERE IS NO FREE-TEXT PATH IN THIS MODULE, and none anywhere else. Not a
 * disabled one, not one behind a flag check — none. A `ChatMessage` carries a
 * `code`, which is an id into one of the two tables below, and the server
 * rejects anything that is not in them. §7.8's last case asserts exactly that:
 * no exported function anywhere accepts arbitrary text.
 *
 * The flag exists in the flag list so the decision is visible, and turning it
 * on today does nothing at all, because there is nothing behind it.
 */
import type { ChatMessage } from './types';

// ---------------------------------------------------------------------------
// The phrases (§2)
// ---------------------------------------------------------------------------

export type PhraseGroup = 'greetings' | 'requests' | 'tactics' | 'praise';

export interface QuickPhrase {
  readonly id: string;
  readonly group: PhraseGroup;
  readonly text: string;
}

/**
 * §2 — "~24 quick phrases in four groups". Six each, in the Captain's
 * register: plain, naval, and never anything that could be read as an insult,
 * because a closed vocabulary is only safe if the vocabulary is safe.
 */
export const QUICK_PHRASES: readonly QuickPhrase[] = [
  // greetings
  { id: 'g1', group: 'greetings', text: 'Fair winds.' },
  { id: 'g2', group: 'greetings', text: 'Reporting in.' },
  { id: 'g3', group: 'greetings', text: 'Good to have you aboard.' },
  { id: 'g4', group: 'greetings', text: 'Off to sea — back later.' },
  { id: 'g5', group: 'greetings', text: 'Anyone about?' },
  { id: 'g6', group: 'greetings', text: 'Thank you, Captain.' },

  // requests
  { id: 'r1', group: 'requests', text: 'I need a bomber.' },
  { id: 'r2', group: 'requests', text: 'I need a torpedo bomber.' },
  { id: 'r3', group: 'requests', text: 'I need a submarine.' },
  { id: 'r4', group: 'requests', text: 'Could somebody fill my request?' },
  { id: 'r5', group: 'requests', text: 'Requests are open — help yourselves.' },
  { id: 'r6', group: 'requests', text: 'Who needs anything?' },

  // tactics
  { id: 't1', group: 'tactics', text: 'Raid them at dawn.' },
  { id: 't2', group: 'tactics', text: 'Save your raids for the war.' },
  { id: 't3', group: 'tactics', text: 'Their flagship is on the left.' },
  { id: 't4', group: 'tactics', text: 'Mines along the bottom row.' },
  { id: 't5', group: 'tactics', text: 'Watch for decoys.' },
  { id: 't6', group: 'tactics', text: 'I will take the top half.' },

  // praise
  { id: 'p1', group: 'praise', text: 'Good hunting!' },
  { id: 'p2', group: 'praise', text: 'Three stars — well done.' },
  { id: 'p3', group: 'praise', text: 'That was a hard harbour.' },
  { id: 'p4', group: 'praise', text: 'Nicely sailed.' },
  { id: 'p5', group: 'praise', text: 'Best of the day, that.' },
  { id: 'p6', group: 'praise', text: 'Unlucky — next time.' },
];

const PHRASE_IDS = new Set(QUICK_PHRASES.map((p) => p.id));

export function phraseById(id: string): QuickPhrase | null {
  return QUICK_PHRASES.find((p) => p.id === id) ?? null;
}

export function phrasesIn(group: PhraseGroup): readonly QuickPhrase[] {
  return QUICK_PHRASES.filter((p) => p.group === group);
}

// ---------------------------------------------------------------------------
// The stickers (§2)
// ---------------------------------------------------------------------------

/** §2 — "The existing 8 emote stickers, plus fleet-only ones unlocked by
 *  Fleet Hall level." The first eight are the match emotes, already drawn. */
export const BASE_STICKER_COUNT = 8;

/** Two more per Fleet Hall level, to a maximum of eight extra. */
export function stickersAvailable(fleetHallLevel: number): number {
  const extra = Math.max(0, Math.min(Math.trunc(fleetHallLevel), 4)) * 2;
  return BASE_STICKER_COUNT + extra;
}

export function stickerUnlocked(stickerId: number, fleetHallLevel: number): boolean {
  return stickerId >= 0 && stickerId < stickersAvailable(fleetHallLevel);
}

// ---------------------------------------------------------------------------
// Validation — the only way a message gets in
// ---------------------------------------------------------------------------

export type ChatReject =
  | 'unknown-phrase'
  | 'locked-sticker'
  | 'too-fast'
  | 'too-many'
  | 'not-a-member';

export interface ChatCheck {
  readonly ok: boolean;
  readonly error: ChatReject | null;
  readonly reason: string | null;
}

const ok: ChatCheck = { ok: true, error: null, reason: null };
const no = (error: ChatReject, reason: string): ChatCheck => ({ ok: false, error, reason });

/** §2 — "Rate limit 1 message / 2 s, 30 / minute." */
export const MIN_GAP_MS = 2_000;
export const PER_MINUTE = 30;
export const MINUTE_MS = 60_000;

/** §2 — "Messages last 7 days." */
export const MESSAGE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export interface ChatSendInput {
  readonly kind: 'phrase' | 'sticker';
  readonly code: string;
  readonly fleetHallLevel: number;
  readonly isMember: boolean;
  /** This sender's recent message times, newest first. */
  readonly recent: readonly number[];
  readonly now: number;
}

/**
 * The single gate. A message is a KNOWN phrase id or an UNLOCKED sticker id,
 * inside the rate limit, from a member. There is no other shape it can take.
 */
export function checkSend(input: ChatSendInput): ChatCheck {
  if (!input.isMember) return no('not-a-member', 'You are not in that fleet.');

  if (input.kind === 'phrase') {
    if (!PHRASE_IDS.has(input.code)) return no('unknown-phrase', 'That is not one of the signals.');
  } else {
    const id = Number(input.code);
    if (!Number.isInteger(id) || !stickerUnlocked(id, input.fleetHallLevel)) {
      return no('locked-sticker', 'The Fleet Hall has not run that one up yet.');
    }
  }

  const last = input.recent[0];
  if (last !== undefined && input.now - last < MIN_GAP_MS) {
    return no('too-fast', 'Steady on — one signal at a time.');
  }

  const inLastMinute = input.recent.filter((t) => input.now - t < MINUTE_MS).length;
  if (inLastMinute >= PER_MINUTE) {
    return no('too-many', 'That is enough signalling for one minute.');
  }

  return ok;
}

/** §2 — "Messages last 7 days." Applied on read as well as by a sweep. */
export function isExpired(message: Pick<ChatMessage, 'at'>, now: number): boolean {
  return now - message.at >= MESSAGE_TTL_MS;
}

export function liveMessages(
  messages: readonly ChatMessage[],
  now: number,
): readonly ChatMessage[] {
  return messages.filter((m) => !isExpired(m, now));
}

/** What a message renders as. A sticker has no text; a phrase has only ours. */
export function renderMessage(message: ChatMessage): { text: string | null; stickerId: number | null } {
  if (message.kind === 'sticker') {
    const id = Number(message.code);
    return { text: null, stickerId: Number.isInteger(id) ? id : null };
  }
  return { text: phraseById(message.code)?.text ?? null, stickerId: null };
}
