/**
 * Who sees the reveal (plan.ts), the countdown's arithmetic (clock.ts) and the
 * one-reveal-per-match session (revealStore.ts). Pure, with a fake clock.
 */
import type { Board } from '@engine/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { fractionLeft, msToNextChange, secondsShown } from '../../src/features/reveal/clock';
import { REVEAL_MS, revealSource, revealWinner, type FinishFacts } from '../../src/features/reveal/plan';
import { useReveal } from '../../src/features/reveal/revealStore';

const LOSS: FinishFacts = { mode: 'online', tutorial: false, ownerId: 'me', winnerId: 'them', opponentId: 'them' };
const BOARD: Board = { ships: [], arsenal: [], marks: {} };
const WINNER = revealWinner({ id: 'them', name: 'Berhan', points: 1200 });

describe('revealSource — only the loser, only with a confirmed winner', () => {
  it('an online loss (server bots included) waits for the server’s board', () => {
    expect(revealSource(LOSS)).toBe('server');
  });
  it('a loss to the offline AI uses the local board', () => {
    expect(revealSource({ ...LOSS, mode: 'ai' })).toBe('local');
  });
  it('the winner goes straight on', () => {
    expect(revealSource({ ...LOSS, winnerId: 'me' })).toBe('none');
    expect(revealSource({ ...LOSS, mode: 'ai', winnerId: 'me' })).toBe('none');
  });
  it('no confirmed winner — none, empty, or not the player we fought — keeps the existing flow', () => {
    expect(revealSource({ ...LOSS, winnerId: null })).toBe('none');
    expect(revealSource({ ...LOSS, winnerId: undefined })).toBe('none');
    expect(revealSource({ ...LOSS, winnerId: '' })).toBe('none');
    expect(revealSource({ ...LOSS, winnerId: 'someone-else' })).toBe('none');
    expect(revealSource({ ...LOSS, opponentId: null })).toBe('none');
    expect(revealSource({ ...LOSS, ownerId: '' })).toBe('none');
  });
  it('hot-seat and the tutorial are untouched', () => {
    expect(revealSource({ ...LOSS, mode: 'hotseat' })).toBe('none');
    expect(revealSource({ ...LOSS, mode: 'tutorial' })).toBe('none');
    expect(revealSource({ ...LOSS, tutorial: true })).toBe('none');
  });
});

describe('revealWinner — the result screen’s own fallbacks, nothing invented', () => {
  it('keeps real values', () => {
    expect(
      revealWinner({ id: 'x', name: ' Mara ', points: 640, avatarId: 3, avatarColor: '#fff', countryCode: 'IN' }),
    ).toEqual({ id: 'x', name: 'Mara', points: 640, avatarId: 3, avatarColor: '#fff', countryCode: 'IN' });
  });
  it('falls back for every missing or malformed field — and leaves the flag blank, not made up', () => {
    expect(revealWinner({ id: 'x', name: '  ', points: Number.NaN, avatarId: 0.5, avatarColor: 3, countryCode: null })).toEqual({
      id: 'x',
      name: 'Opponent',
      points: 0,
      avatarId: 2,
      avatarColor: '',
      countryCode: '',
    });
    expect(revealWinner({ id: 'x' }).name).toBe('Opponent');
    expect(revealWinner({ id: 'x', points: -40 }).points).toBe(0);
  });
});

describe('the countdown is arithmetic on a deadline', () => {
  const t0 = 1_000_000;
  const deadline = t0 + REVEAL_MS;

  it('counts 5, 4, 3, 2, 1 — each for a full second — then 0 at the deadline', () => {
    const seen: number[] = [];
    for (let t = t0; t < deadline; t += 100) {
      const n = secondsShown(deadline, t);
      if (seen[seen.length - 1] !== n) seen.push(n);
    }
    expect(seen).toEqual([5, 4, 3, 2, 1]);
    expect(secondsShown(deadline, t0 + 999)).toBe(5);
    expect(secondsShown(deadline, t0 + 1000)).toBe(4);
    expect(secondsShown(deadline, deadline - 1)).toBe(1);
    expect(secondsShown(deadline, deadline)).toBe(0);
    expect(secondsShown(deadline, deadline + 60_000)).toBe(0);
  });

  it('the bar runs from full to empty and never outside', () => {
    expect(fractionLeft(deadline, t0)).toBe(1);
    expect(fractionLeft(deadline, t0 + 2500)).toBe(0.5);
    expect(fractionLeft(deadline, deadline)).toBe(0);
    expect(fractionLeft(deadline, deadline + 9000)).toBe(0);
    expect(fractionLeft(deadline, t0 - 9000)).toBe(1);
  });

  it('the next timer lands exactly on the next change', () => {
    expect(msToNextChange(deadline, t0)).toBe(1000);
    expect(msToNextChange(deadline, t0 + 250)).toBe(750);
    expect(msToNextChange(deadline, deadline - 300)).toBe(300);
    expect(msToNextChange(deadline, deadline)).toBe(0);
  });

  it('a long trip to the background finishes at once on return, instead of starting again', () => {
    const back = deadline + 42_000;
    expect(secondsShown(deadline, back)).toBe(0);
    expect(msToNextChange(deadline, back)).toBe(0);
  });
});

describe('the reveal session: one per match', () => {
  beforeEach(() => {
    useReveal.setState({ session: null, opened: [], left: [] });
  });

  it('a duplicate end-of-match for the same match never reopens it', () => {
    expect(useReveal.getState().open('m1', WINNER, BOARD)).toBe(true);
    const first = useReveal.getState().session;
    expect(useReveal.getState().open('m1', WINNER, { ...BOARD })).toBe(false);
    expect(useReveal.getState().session).toBe(first);
  });

  it('the deadline is set once; a re-mount gets the same one, not a fresh five seconds', () => {
    useReveal.getState().open('m1', WINNER, BOARD);
    const deadline = useReveal.getState().start('m1', 10_000);
    expect(deadline).toBe(10_000 + REVEAL_MS);
    expect(useReveal.getState().start('m1', 13_000)).toBe(deadline);
    expect(useReveal.getState().start('other', 13_000)).toBeNull();
  });

  it('leaving happens once per match and releases the board', () => {
    useReveal.getState().open('m1', WINNER, BOARD);
    useReveal.getState().start('m1', 0);
    expect(useReveal.getState().leave('m1')).toBe(true);
    expect(useReveal.getState().session).toBeNull();
    expect(useReveal.getState().leave('m1')).toBe(false);
    // …and a left match cannot be opened again either.
    expect(useReveal.getState().open('m1', WINNER, BOARD)).toBe(false);
  });

  it('many matches in one session hold one board and a bounded list of ids', () => {
    for (let i = 0; i < 200; i++) {
      const key = `m${i}`;
      expect(useReveal.getState().open(key, WINNER, BOARD)).toBe(true);
      useReveal.getState().start(key, i);
      expect(useReveal.getState().leave(key)).toBe(true);
    }
    const s = useReveal.getState();
    expect(s.session).toBeNull();
    expect(s.opened.length).toBeLessThanOrEqual(12);
    expect(s.left.length).toBeLessThanOrEqual(12);
  });
});
