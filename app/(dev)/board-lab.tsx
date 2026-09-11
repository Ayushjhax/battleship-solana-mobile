/**
 * Board lab: both boards with a full fleet, one of every cell mark, every ship
 * state, and buttons that fire shots so you can watch marks land. Everything
 * on the enemy board comes through the real engine and projectView(), so what
 * you see here is what a match produces.
 *
 * Tap the enemy board: the readout shows the cell that was resolved — check
 * every corner and edge.
 */
import { projectView, reduce } from '@engine/match';
import { createRng } from '@engine/rng';
import type { Coord, MatchEvent, MatchState } from '@engine/types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { DualBoards } from '@/board/DualBoards';
import { COL_LABELS, ROW_LABELS } from '@/board/layout';
import { YOU, buildLab, wrecksOf } from '@/features/dev/boardLab';
import { InkButton } from '@/ui/InkButton';
import { Paper } from '@/ui/Paper';
import { Scale } from '@/ui/Scale';
import { CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';

function label(coord: Coord): string {
  return `${ROW_LABELS[coord.r]}${COL_LABELS[coord.c]} (r${coord.r},c${coord.c})`;
}

export default function BoardLab() {
  const [state, setState] = useState<MatchState>(() => buildLab());
  const [readout, setReadout] = useState('tap the enemy board');
  const [highlightOn, setHighlightOn] = useState(true);
  const [seconds, setSeconds] = useState(20);
  const shots = useRef(0);
  const rapid = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => (s <= 0 ? 20 : s - 1)), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => () => { if (rapid.current) clearInterval(rapid.current); }, []);

  const view = useMemo(() => projectView(state, YOU), [state]);
  const you = state.players[0];

  const fireAt = useCallback((at: Coord) => {
    setState((s) => {
      const r = reduce({ ...s, turn: YOU }, { type: 'FIRE', playerId: YOU, at });
      const summary = r.events.map((e: MatchEvent) => e.type).join(' · ');
      setReadout(`${label(at)} → ${summary}`);
      return r.state.phase === 'over' ? { ...r.state, phase: 'playing', winner: null } : r.state;
    });
  }, []);

  const fireRandom = useCallback(() => {
    const rng = createRng(1000 + shots.current++);
    setState((s) => {
      const marks = s.players[1].board.marks;
      const unknown: Coord[] = [];
      for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) if (!marks[`${r},${c}`]) unknown.push({ r, c });
      if (unknown.length === 0) return s;
      const at = rng.pick(unknown);
      const r = reduce({ ...s, turn: YOU }, { type: 'FIRE', playerId: YOU, at });
      setReadout(`${label(at)} → ${r.events.map((e) => e.type).join(' · ')}`);
      return r.state.phase === 'over' ? { ...r.state, phase: 'playing', winner: null } : r.state;
    });
  }, []);

  const fireRapid = useCallback(() => {
    if (rapid.current) return;
    let n = 0;
    rapid.current = setInterval(() => {
      fireRandom();
      if (++n >= 20 && rapid.current) {
        clearInterval(rapid.current);
        rapid.current = null;
      }
    }, 60);
  }, [fireRandom]);

  const reset = useCallback(() => {
    shots.current = 0;
    setState(buildLab());
    setReadout('reset');
  }, []);

  const highlight = highlightOn
    ? [
        { r: 6, c: 6 },
        { r: 6, c: 7 },
        { r: 7, c: 6 },
      ]
    : [];

  return (
    <Scale>
      <Paper variant="full" />
      <DualBoards
        own={{ cells: you.board.marks, ships: you.board.ships, arsenal: you.board.arsenal }}
        enemy={{
          cells: view.enemy.marks,
          wrecks: wrecksOf(view.enemy.sunkShips),
          revealed: view.enemy.revealedItems.map((i, n) => ({ id: `rev-${n}`, kind: i.kind, at: i.at, destroyed: i.destroyed, revealed: true })),
          highlight,
        }}
        turn="yours"
        seconds={seconds}
        interactive
        onEnemyCellPress={fireAt}
        onEnemyCellLongPress={(at) => setReadout(`long press ${label(at)}`)}
      />

      <View style={styles.controls}>
        <InkButton label="Fire" size="sm" w={70} h={36} seedKey="lab-fire" onPress={fireRandom} />
        <InkButton label="Fire 20" size="sm" w={70} h={36} seedKey="lab-rapid" tone="confirm" onPress={fireRapid} />
        <InkButton label="Hilite" size="sm" w={70} h={36} seedKey="lab-hl" onPress={() => setHighlightOn((v) => !v)} />
        <InkButton label="Reset" size="sm" w={70} h={36} seedKey="lab-reset" tone="danger" onPress={reset} />
      </View>

      <Text style={styles.readout} numberOfLines={2}>
        {readout} · ships left {view.enemy.shipsRemaining} · moves {state.moves}
      </Text>
    </Scale>
  );
}

const styles = StyleSheet.create({
  controls: { position: 'absolute', left: 4, top: 60, gap: 6 },
  readout: {
    position: 'absolute',
    left: 100,
    top: 328,
    width: CANVAS_W - 200,
    textAlign: 'center',
    color: color.inkSoft,
    fontFamily: font.body,
    fontSize: typeScale.xxs,
    lineHeight: 14,
    paddingHorizontal: space.xs,
  },
});
