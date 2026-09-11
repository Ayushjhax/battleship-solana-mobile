/**
 * Seeded PRNG. Every random decision in the engine goes through this so a match
 * replays exactly from its seed. Nothing in src/engine draws from the global random source.
 */

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  pick<T>(arr: readonly T[]): T;
  /** Returns a new shuffled array; does not mutate the input. */
  shuffle<T>(arr: readonly T[]): T[];
}

/** mulberry32 — small, fast, good enough for gameplay, fully deterministic. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;

  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (maxExclusive: number): number => Math.floor(next() * maxExclusive);

  const pick = <T>(arr: readonly T[]): T => {
    const value = arr[int(arr.length)];
    if (value === undefined) throw new Error('rng.pick called on an empty array');
    return value;
  };

  const shuffle = <T>(arr: readonly T[]): T[] => {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(i + 1);
      const vi = out[i] as T;
      const vj = out[j] as T;
      out[i] = vj;
      out[j] = vi;
    }
    return out;
  };

  return { next, int, pick, shuffle };
}
