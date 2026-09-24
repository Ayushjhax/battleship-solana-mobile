/**
 * The typed client for the Gazette, the puzzle and voyages — part-09 §4.
 *
 * Transport is the shared `src/net/featureClient.ts`, as Parts 4, 6, 7 and 8
 * use. Nothing here computes a reward, a par or a resolution: §2 is explicit
 * that the puzzle is server-authoritative, so the client renders what it is
 * told and nothing else.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE SCHEMAS ARE `.strict()`, AND THAT IS A SECRECY GUARANTEE.
 *
 * Part 6 did the same for `RaidViewSchema`. A `.strict()` object REJECTS an
 * unknown key, so if a future server change ever put `ships` or `layout` into
 * a puzzle response, this parse fails loudly on the client rather than
 * quietly handing the solver the answer. The leak becomes a crash, which is
 * the outcome you want.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { z } from 'zod';

import { requestWithRetry, type SendInit } from '@/net/featureClient';

export const DAILY_ERROR_CODES = [
  'offline',
  'unauthenticated',
  'internal',
  'feature-off',
  'not-found',
  'already-finished',
  'illegal-cell',
  'no-slot',
  'slot-busy',
  'unknown-route',
  'not-back-yet',
  'already-collected',
  'under-attack',
  'already-settled',
] as const;

export type DailyErrorCode = (typeof DAILY_ERROR_CODES)[number];

export function asDailyErrorCode(raw: string): DailyErrorCode {
  return (DAILY_ERROR_CODES as readonly string[]).includes(raw)
    ? (raw as DailyErrorCode)
    : 'internal';
}

export class DailyApiError extends Error {
  readonly code: DailyErrorCode;
  constructor(code: DailyErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'DailyApiError';
    this.code = code;
  }
}

const TRANSPORT = {
  makeError: (code: DailyErrorCode, detail?: string) => new DailyApiError(code, detail),
  asCode: asDailyErrorCode,
};

function request(path: string, init: SendInit): Promise<unknown> {
  return requestWithRetry(path, init, TRANSPORT);
}

function parse<T extends z.ZodTypeAny>(schema: T, data: unknown, what: string): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new DailyApiError('internal', `${what}: ${result.error.issues[0]?.message ?? 'bad shape'}`);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// The Gazette (§1)
// ---------------------------------------------------------------------------

const StorySchema = z
  .object({
    templateId: z.string(),
    score: z.number(),
    text: z.string(),
  })
  .strict();

export const EditionSchema = z
  .object({
    date: z.string(),
    masthead: z.string(),
    price: z.string(),
    headline: StorySchema,
    subStories: z.array(StorySchema),
    tip: z.string(),
    weather: z.string(),
    puzzleNumber: z.number().int(),
    /** Part 10B — announced so ranked players know the season's water. */
    seasonSea: z
      .object({ id: z.string(), name: z.string() })
      .nullable()
      .optional(),
  })
  .strict();

export type Edition = z.infer<typeof EditionSchema>;

const GazetteResponse = z.object({
  edition: EditionSchema,
  fresh: z.boolean(),
  serverNow: z.number(),
});

export async function getGazette(): Promise<z.infer<typeof GazetteResponse>> {
  return parse(GazetteResponse, await request('/gazette', { method: 'GET' }), 'gazette');
}

export async function markGazetteRead(): Promise<void> {
  await request('/gazette/read', { method: 'POST', body: {} });
}

// ---------------------------------------------------------------------------
// The daily puzzle (§2)
// ---------------------------------------------------------------------------

/**
 * §2 — "the layout never reaches the client."
 *
 * `.strict()` here is the structural half of that promise. There is no
 * `ships` and no `layout` key, so a payload carrying one is a parse error.
 */
export const PuzzleViewSchema = z
  .object({
    date: z.string(),
    number: z.number().int(),
    marks: z.record(z.string(), z.string()),
    shots: z.number().int(),
    shipsRemaining: z.number().int(),
    finished: z.boolean(),
    par: z.number().int(),
  })
  .strict();

export type PuzzleViewDto = z.infer<typeof PuzzleViewSchema>;

const PuzzleRewardSchema = z
  .object({
    coins: z.number().int(),
    steel: z.number().int(),
    ink: z.number().int(),
    gems: z.number().int(),
    streak: z.number().int(),
    milestone: z.number().int().nullable(),
  })
  .strict();

const PuzzleResponse = z.object({
  view: PuzzleViewSchema,
  streak: z.number().int(),
  reward: PuzzleRewardSchema.optional(),
  serverNow: z.number(),
});

export type PuzzleResponseDto = z.infer<typeof PuzzleResponse>;

export async function getPuzzle(): Promise<PuzzleResponseDto> {
  return parse(PuzzleResponse, await request('/puzzle', { method: 'GET' }), 'puzzle');
}

export async function firePuzzle(cell: { r: number; c: number }): Promise<PuzzleResponseDto> {
  return parse(
    PuzzleResponse,
    await request('/puzzle/fire', { method: 'POST', body: { cell } }),
    'puzzle/fire',
  );
}

const LeaderboardResponse = z.object({
  leaders: z.array(
    z
      .object({
        place: z.number().int(),
        name: z.string(),
        avatarId: z.number().int(),
        shots: z.number().int(),
        seconds: z.number().int(),
      })
      .strict(),
  ),
  me: z
    .object({
      place: z.number().int(),
      shots: z.number().int(),
      seconds: z.number().int(),
    })
    .strict()
    .nullable(),
  serverNow: z.number(),
});

export type PuzzleLeaderboard = z.infer<typeof LeaderboardResponse>;

export async function getPuzzleLeaderboard(): Promise<PuzzleLeaderboard> {
  return parse(
    LeaderboardResponse,
    await request('/puzzle/leaderboard', { method: 'GET' }),
    'puzzle/leaderboard',
  );
}

// ---------------------------------------------------------------------------
// Trade voyages (§3)
// ---------------------------------------------------------------------------

const RewardSchema = z
  .object({
    coins: z.number().int(),
    steel: z.number().int(),
    gems: z.number().int(),
    cosmetic: z.string().nullable(),
    pirate: z.boolean(),
  })
  .strict();

/**
 * §3 — "revealed on return". `reward` and `pirate` are NULL while the ship is
 * still out; the server nulls them, and the screen must not pretend otherwise.
 */
export const VoyageSchema = z
  .object({
    id: z.string(),
    route: z.string(),
    slot: z.number().int(),
    sentAt: z.number(),
    returnsAt: z.number(),
    state: z.string(),
    back: z.boolean(),
    reward: RewardSchema.nullable(),
    pirate: z.boolean().nullable(),
    // Null until the ship is home. §3 — the client plays the board, the
    // server replays the log; the seed is how both build the same one.
    skirmishSeed: z.number().nullable(),
  })
  .strict();

export type VoyageDto = z.infer<typeof VoyageSchema>;

const VoyageListResponse = z.object({
  voyages: z.array(VoyageSchema),
  serverNow: z.number(),
});

export async function listVoyages(): Promise<VoyageDto[]> {
  return parse(VoyageListResponse, await request('/voyage', { method: 'GET' }), 'voyage').voyages;
}

const SentResponse = z
  .object({
    id: z.string(),
    route: z.string(),
    slot: z.number().int(),
    returnsAt: z.number(),
    // Always false — §3's "revealed on return". It is in the schema so a
    // server that started sending the real flag fails the parse.
    pirate: z.literal(false),
    serverNow: z.number(),
  })
  .strict();

export async function sendVoyage(route: string, slot: number): Promise<z.infer<typeof SentResponse>> {
  return parse(
    SentResponse,
    await request('/voyage/send', { method: 'POST', body: { route, slot } }),
    'voyage/send',
  );
}

const CollectedResponse = z.object({
  coins: z.number().int(),
  steel: z.number().int(),
  gems: z.number().int(),
  result: z.enum(['won', 'lost', 'ignored', 'unverified', 'none']),
  verified: z.boolean().optional(),
  serverNow: z.number(),
});

export type Collected = z.infer<typeof CollectedResponse>;

export async function collectVoyage(id: string): Promise<Collected> {
  return parse(
    CollectedResponse,
    await request('/voyage/collect', { method: 'POST', body: { id } }),
    'voyage/collect',
  );
}

export interface SubmittedLog {
  readonly seed: number;
  readonly shots: readonly { r: number; c: number }[];
  readonly claimedWinner: 'player' | 'pirate';
}

export async function submitSkirmish(id: string, log: SubmittedLog): Promise<Collected> {
  return parse(
    CollectedResponse,
    await request('/voyage/skirmish', { method: 'POST', body: { id, log } }),
    'voyage/skirmish',
  );
}
