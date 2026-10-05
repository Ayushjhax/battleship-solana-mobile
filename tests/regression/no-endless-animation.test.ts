/**
 * Regression: "after a lot of games the game starts lagging and the phone
 * starts heating." docs/brief.md: "No ambient idle animation. It costs
 * battery."
 *
 * An endless animation keeps the whole screen redrawing every frame for as
 * long as it is mounted. On a screen a player sits on through a match — the
 * battle, its boards and HUD, the placement under it, the menu under
 * everything, the reveal, the result — that is a phone that never rests: the
 * smoke on a single sunk ship used to redraw the battle from the first
 * sinking to the last shot, every match. Finite loops (a few puffs, a few
 * breaths) are fine; `withRepeat(…, -1, …)` is not, on these screens.
 *
 * Transient pieces that loop only while they exist — a plane's wobble in
 * flight, the "…" while a shot is pending, the radar sweep, loading
 * spinners — live elsewhere (src/fx, src/ui/InkSpinner) and are not checked.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');

/** Everything that stays on screen through a match, or under it. */
const ALWAYS_ON = [
  'app/menu.tsx',
  // Pushed under placement and the whole hot-seat match (BUG-013): its caret
  // blinked on, invisibly, from the names screen to the last shot.
  'app/(game)/hotseat.tsx',
  'app/(game)/placement.tsx',
  'app/(game)/battle.tsx',
  'app/(game)/reveal.tsx',
  'app/(game)/result.tsx',
  'src/board',
  'src/features/battle',
  'src/features/reveal',
  'src/features/menu',
  'src/ui/TurnTriangle.tsx',
];

function files(path: string): string[] {
  const full = join(ROOT, path);
  if (statSync(full).isFile()) return [path];
  return readdirSync(full).flatMap((name) => files(join(path, name)));
}

/** The argument list of every `withRepeat(` call, parentheses balanced. */
function repeatCalls(source: string): string[] {
  const calls: string[] = [];
  let at = source.indexOf('withRepeat(');
  while (at !== -1) {
    let depth = 0;
    let end = at + 'withRepeat'.length;
    for (; end < source.length; end += 1) {
      const ch = source[end];
      if (ch === '(') depth += 1;
      else if (ch === ')' && --depth === 0) break;
    }
    calls.push(source.slice(at + 'withRepeat('.length, end));
    at = source.indexOf('withRepeat(', end);
  }
  return calls;
}

/** The second top-level argument: the repeat count. */
function countArg(args: string): string {
  let depth = 0;
  const parts: string[] = [''];
  for (const ch of args) {
    if ('([{'.includes(ch)) depth += 1;
    if (')]}'.includes(ch)) depth -= 1;
    if (ch === ',' && depth === 0) parts.push('');
    else parts[parts.length - 1] += ch;
  }
  return (parts[1] ?? '').trim();
}

describe('no endless animation on the screens a match lives on', () => {
  const sources = ALWAYS_ON.flatMap(files).filter((f) => /\.tsx?$/.test(f) && !f.includes('__tests__'));

  it('finds the files it guards', () => {
    expect(sources.length).toBeGreaterThan(10);
    expect(sources).toContain('src/board/ShipSprite.tsx');
  });

  it.each(sources)('%s repeats only a finite number of times', (file) => {
    const text = readFileSync(join(ROOT, file), 'utf8');
    for (const args of repeatCalls(text)) {
      const count = countArg(args);
      expect(count, `withRepeat(${args.slice(0, 60)}…) in ${file}`).not.toMatch(/^-\s*1$|^Infinity$/);
      // An omitted count is Reanimated's default of 2; a name must be a finite constant.
    }
  });

  it('the parser itself sees an endless loop', () => {
    expect(countArg(repeatCalls('x = withRepeat(withTiming(1, { duration: 9 }), -1, false);')[0] as string)).toBe('-1');
    expect(countArg(repeatCalls('withRepeat(withSequence(a(1), b(2)), PUFF_CYCLES, false)')[0] as string)).toBe(
      'PUFF_CYCLES',
    );
  });
});
