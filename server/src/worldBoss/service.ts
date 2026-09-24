import {
  bossCoordKey,
  dailyShotAllowance,
  generateBossLayout,
  publicBossBoard,
  reachedMilestones,
  resolveBossCell,
  totalShipCells,
  type BossCoord,
  type BossLayout,
  type BossMark,
  type PublicBossBoard,
} from '@engine/worldBoss';

export type WorldBossError = 'event-closed' | 'no-shots-left' | 'cell-out-of-bounds';
export interface ShotRequest {
  readonly requestId: string;
  readonly playerId: string;
  readonly coord: BossCoord;
  readonly gazetteBonus?: boolean;
  readonly fleetWarRaids?: number;
  readonly day: string;
}
export interface ShotResponse {
  readonly ok: true;
  readonly charged: boolean;
  readonly refunded: boolean;
  readonly mark: BossMark;
  readonly wave: number;
  readonly nextWave: number | null;
  readonly shotsUsed: number;
  readonly allowance: number;
  readonly milestones: readonly number[];
  readonly board: PublicBossBoard;
}
export type ShotOutcome = ShotResponse | { readonly ok: false; readonly error: WorldBossError };

interface Participant { day: string; used: number; firedWaves: Set<number> }
interface EventState {
  seed: number;
  wave: number;
  layout: BossLayout;
  marks: Record<string, BossMark>;
  participants: Map<string, Participant>;
  requests: Map<string, ShotOutcome>;
  rewards: Set<string>;
  closed: boolean;
}

/**
 * One promise tail per event is the reference serialized writer. Production's
 * SQL RPC mirrors this with SELECT ... FOR UPDATE on the event row.
 */
export class SerializedWorldBoss {
  private readonly state: EventState;
  private tail: Promise<void> = Promise.resolve();

  constructor(seed: number) {
    this.state = { seed, wave: 1, layout: generateBossLayout(seed, 1), marks: {}, participants: new Map(), requests: new Map(), rewards: new Set(), closed: false };
  }

  close(): void { this.state.closed = true; }
  snapshot(): PublicBossBoard { return publicBossBoard(this.state.layout, this.state.marks); }
  rewardKeys(): readonly string[] { return [...this.state.rewards]; }

  shoot(input: ShotRequest): Promise<ShotOutcome> {
    let release!: () => void;
    const turn = new Promise<void>((resolve) => { release = resolve; });
    const previous = this.tail;
    this.tail = previous.then(() => turn);
    return previous.then(() => this.resolve(input)).finally(release);
  }

  private resolve(input: ShotRequest): ShotOutcome {
    const replay = this.state.requests.get(`${input.playerId}:${input.requestId}`);
    if (replay) return replay;
    if (this.state.closed) return { ok: false, error: 'event-closed' };
    if (!Number.isInteger(input.coord.row) || !Number.isInteger(input.coord.col) || input.coord.row < 0 || input.coord.col < 0 || input.coord.row >= 30 || input.coord.col >= 30) return { ok: false, error: 'cell-out-of-bounds' };

    let participant = this.state.participants.get(input.playerId);
    if (!participant || participant.day !== input.day) {
      participant = { day: input.day, used: 0, firedWaves: new Set() };
      this.state.participants.set(input.playerId, participant);
    }
    const allowance = dailyShotAllowance(input.gazetteBonus === true, input.fleetWarRaids ?? 0);
    const wave = this.state.wave;
    const key = bossCoordKey(input.coord);
    const existing = this.state.marks[key];
    if (existing) {
      const response: ShotResponse = { ok: true, charged: false, refunded: true, mark: existing, wave, nextWave: null, shotsUsed: participant.used, allowance, milestones: [], board: this.snapshot() };
      this.state.requests.set(`${input.playerId}:${input.requestId}`, response);
      return response;
    }
    if (participant.used >= allowance) return { ok: false, error: 'no-shots-left' };

    const beforeHits = Object.values(this.state.marks).filter((mark) => mark === 'hit').length;
    const mark = resolveBossCell(this.state.layout, input.coord);
    this.state.marks[key] = mark;
    participant.used += 1;
    participant.firedWaves.add(wave);
    const afterHits = beforeHits + (mark === 'hit' ? 1 : 0);
    const total = totalShipCells(this.state.layout);
    const milestones = reachedMilestones((beforeHits / total) * 100, (afterHits / total) * 100);
    for (const milestone of milestones) {
      for (const [playerId, p] of this.state.participants) if (p.firedWaves.has(wave)) this.state.rewards.add(`${wave}:milestone:${milestone}:${playerId}`);
    }

    let nextWave: number | null = null;
    const board = this.snapshot();
    if (afterHits === total) {
      for (const [playerId, p] of this.state.participants) if (p.firedWaves.has(wave)) this.state.rewards.add(`${wave}:complete:${playerId}`);
      this.state.wave += 1;
      nextWave = this.state.wave;
      this.state.layout = generateBossLayout(this.state.seed, this.state.wave);
      this.state.marks = {};
    }
    const response: ShotResponse = { ok: true, charged: true, refunded: false, mark, wave, nextWave, shotsUsed: participant.used, allowance, milestones, board };
    this.state.requests.set(`${input.playerId}:${input.requestId}`, response);
    return response;
  }
}
