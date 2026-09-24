import { EMPIRE_PORTS, accrueTribute, empireProgress, replayEmpireBattle, starsFor, type EmpireCoord, type EmpireResult, type Tribute } from '@engine/empire';

interface Profile { conquered: Set<string>; stars: Map<string, number>; lastCollectedAt: number; requests: Map<string, Tribute> }

/** Reference server authority; the SQL schema persists the same fields. */
export class EmpireService {
  private readonly profiles = new Map<string, Profile>();
  private tails = new Map<string, Promise<void>>();
  private profile(playerId: string, now: number): Profile { let p = this.profiles.get(playerId); if (!p) { p = { conquered: new Set(), stars: new Map(), lastCollectedAt: now, requests: new Map() }; this.profiles.set(playerId, p); } return p; }

  view(playerId: string, now: number) { const p = this.profile(playerId, now); return { conquered: [...p.conquered], stars: Object.fromEntries(p.stars), progress: empireProgress([...p.conquered]), tribute: accrueTribute([...p.conquered], now - p.lastCollectedAt) }; }

  complete(playerId: string, portId: string, result: EmpireResult, now: number) {
    const port = EMPIRE_PORTS.find((candidate) => candidate.id === portId); if (!port) throw new Error('unknown-port');
    const p = this.profile(playerId, now); const stars = starsFor(port, result); if (stars > 0) p.conquered.add(portId); p.stars.set(portId, Math.max(p.stars.get(portId) ?? 0, stars)); return this.view(playerId, now);
  }
  completeTranscript(playerId: string, portId: string, shots: readonly EmpireCoord[], now: number) {
    const port = EMPIRE_PORTS.find((candidate) => candidate.id === portId); if (!port) throw new Error('unknown-port');
    return this.complete(playerId, portId, replayEmpireBattle(port, shots), now);
  }

  collect(playerId: string, requestId: string, now: number): Promise<Tribute> {
    const previous = this.tails.get(playerId) ?? Promise.resolve(); let release!: () => void; const turn = new Promise<void>((resolve) => { release = resolve; }); this.tails.set(playerId, previous.then(() => turn));
    return previous.then(() => { const p = this.profile(playerId, now); const replay = p.requests.get(requestId); if (replay) return replay; const tribute = accrueTribute([...p.conquered], now - p.lastCollectedAt); p.lastCollectedAt = now; p.requests.set(requestId, tribute); return tribute; }).finally(release);
  }
}
