import { describe, expect, it } from 'vitest';
import { EMPIRE_PORTS, KRAKEN_SHAPE, PIRATE_KING_INVENTORY, TRIBUTE_CAP_MS, accrueTribute, connected, empireProgress, obeysHalo, relocateGhost, replayEmpireBattle, scriptedSolution, shipSunk, starsFor } from '@engine/empire';

describe('11C handcrafted campaign', () => {
  it('has exactly 20 ports in four regions and exactly three special bosses', () => {
    expect(EMPIRE_PORTS).toHaveLength(20);
    expect(new Set(EMPIRE_PORTS.map((p) => p.region)).size).toBe(4);
    expect(EMPIRE_PORTS.filter((p) => p.boss).map((p) => p.boss)).toEqual(['kraken', 'ghost-fleet', 'pirate-king']);
  });
  it('a scripted solver sinks every ship at every port', () => {
    for (const port of EMPIRE_PORTS) { const solution = scriptedSolution(port); const hits = new Set(solution.map((c) => `${c.row}:${c.col}`)); expect(port.ships.every((ship) => shipSunk(ship, hits)), port.id).toBe(true); expect(replayEmpireBattle(port, solution).won, port.id).toBe(true); }
  });
  it('awards stars at exact condition boundaries', () => {
    const port = EMPIRE_PORTS[0]!;
    expect(starsFor(port, { won: false, shipsAfloat: 9, turns: 1 })).toBe(0);
    expect(starsFor(port, { won: true, shipsAfloat: 1, turns: 1 })).toBe(1);
    expect(starsFor(port, { won: true, shipsAfloat: 2, turns: port.threeStarTurns + 1 })).toBe(2);
    expect(starsFor(port, { won: true, shipsAfloat: 2, turns: port.threeStarTurns })).toBe(3);
  });
});

describe('11C bosses', () => {
  it('the Kraken is connected, irregular, halo-legal and sinks cell by cell', () => {
    expect(connected(KRAKEN_SHAPE.cells)).toBe(true);
    expect(new Set(KRAKEN_SHAPE.cells.map((c) => c.row)).size).toBeGreaterThan(2);
    const port = EMPIRE_PORTS.find((p) => p.boss === 'kraken')!;
    expect(obeysHalo(port.ships)).toBe(true);
    expect(shipSunk(KRAKEN_SHAPE, new Set(KRAKEN_SHAPE.cells.map((c) => `${c.row}:${c.col}`)))).toBe(true);
  });
  it('Ghost Fleet moves only every third turn, legally, and never after a hit', () => {
    const port = EMPIRE_PORTS.find((p) => p.boss === 'ghost-fleet')!; const ghost = port.ships.find((s) => s.ghost)!;
    expect(relocateGhost(ghost, port.ships, new Set(), 2, 1)).toBe(ghost);
    for (let seed = 0; seed < 1000; seed++) expect(obeysHalo(port.ships.filter((s) => s.id !== ghost.id).concat(relocateGhost(ghost, port.ships, new Set(), 3, seed)))).toBe(true);
    const hit = new Set([`${ghost.cells[0]!.row}:${ghost.cells[0]!.col}`]); expect(relocateGhost(ghost, port.ships, hit, 3, 4)).toBe(ghost);
  });
  it('pins the Pirate King inventory', () => { expect(PIRATE_KING_INVENTORY).toEqual({ aaGuns: 5, mines: 8, decoys: 2 }); });
});

describe('11C tribute and isolation', () => {
  it('accrues proportionally and caps at one day', () => { const ids = EMPIRE_PORTS.map((p) => p.id); expect(accrueTribute(ids, TRIBUTE_CAP_MS * 20)).toEqual(accrueTribute(ids, TRIBUTE_CAP_MS)); expect(accrueTribute(ids, TRIBUTE_CAP_MS / 2).coins).toBe(Math.floor(accrueTribute(ids, TRIBUTE_CAP_MS).coins / 2)); });
  it('reports campaign progress without duplicates', () => { expect(empireProgress([])).toBe(0); expect(empireProgress([EMPIRE_PORTS[0]!.id, EMPIRE_PORTS[0]!.id])).toBe(5); expect(empireProgress(EMPIRE_PORTS.map((p) => p.id))).toBe(100); });
  it('contains no ranked, renown, or arsenal catalogue fields', () => { const wire = JSON.stringify(EMPIRE_PORTS); expect(wire).not.toMatch(/rank|renown|fuel|catalogue/i); });
});
