import { describe, expect, it } from 'vitest';
import { EMPIRE_PORTS, TRIBUTE_CAP_MS } from '@engine/empire';
import { EmpireService } from '../empire/service';

describe('11C server authority', () => {
  it('keeps best stars and conquest per player', () => { const s = new EmpireService(); const id = EMPIRE_PORTS[0]!.id; s.complete('a', id, { won: true, shipsAfloat: 1, turns: 99 }, 0); s.complete('a', id, { won: true, shipsAfloat: 2, turns: 1 }, 0); expect(s.view('a', 0).stars[id]).toBe(3); expect(s.view('b', 0).progress).toBe(0); });
  it('caps tribute and replays an idempotent collection', async () => { const s = new EmpireService(); s.complete('a', EMPIRE_PORTS[0]!.id, { won: true, shipsAfloat: 2, turns: 1 }, 0); const first = await s.collect('a', 'same', TRIBUTE_CAP_MS * 50); const retry = await s.collect('a', 'same', TRIBUTE_CAP_MS * 60); expect(first).toEqual(retry); expect(first.coins).toBe(EMPIRE_PORTS[0]!.tributeCoins); });
  it('two concurrent collections credit tribute once', async () => { const s = new EmpireService(); s.complete('a', EMPIRE_PORTS[0]!.id, { won: true, shipsAfloat: 2, turns: 1 }, 0); const [a, b] = await Promise.all([s.collect('a', 'a', TRIBUTE_CAP_MS), s.collect('a', 'b', TRIBUTE_CAP_MS)]); expect(a.coins + b.coins).toBe(EMPIRE_PORTS[0]!.tributeCoins); });
  it('replays the submitted transcript instead of trusting a claimed win', () => { const s = new EmpireService(); const port = EMPIRE_PORTS[0]!; expect(s.completeTranscript('a', port.id, [], 0).progress).toBe(0); expect(s.completeTranscript('a', port.id, port.ships.flatMap((ship) => ship.cells), 0).progress).toBe(5); });
});
