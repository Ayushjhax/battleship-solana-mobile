/**
 * One 10 x 10 board, authored in the 800 x 360 design space.
 *
 * Layers, bottom to top:
 *   0. a paper-coloured mask over the board's 280 x 280 — the sheet's own
 *      rules are anchored for the battle layout, so any board placed off that
 *      pitch (placement, the battle strip) would otherwise show two grids
 *      through each other
 *   1. optional watermark at 12% opacity, clipped to the board
 *   2. the cell rules — 22 memoised plain <Line>s, not 100 rects, not rough
 *   3. the frame — a heavy double rough frame with overshooting corners,
 *      seeded by a stable key so it never re-wobbles
 *   4. row letters A-J and column numbers 1-10 outside the frame, Bitter 700
 *      at 16 units. Letters go on the board's OUTER side in the battle layout.
 *   5. revealed cells — rough hachure in inkFaint
 *   6. ships and own-board arsenal (own board only)
 *   7. cell marks
 *   8. highlight overlay
 *
 * Two ways to feed it, both supported:
 *   - battle: `origin` + `cells` / `ships` / `arsenal` straight from the view
 *   - placement: `x`/`y` + `board`, with `revealShips`, `hideShips` (the
 *     draggable ships live in an overlay) and `onPressCell(r, c)`
 *
 * PERFORMANCE — this is the screen the whole game lives on:
 *   - layers 1-4 are one <StaticLayer>, memoised on origin/labels/seed/
 *     watermark, so they render once for the life of the board
 *   - marks are keyed by coordKey and memoised; only a changed cell re-renders
 *   - nothing on the parent animates; CellMark animates its own leaf
 *   - `interactive={false}` renders no Pressable at all; omitted, the
 *     presence of a callback decides
 */
import { coordKey, parseKey } from '@engine/board';
import { isSunk } from '@engine/fleet';
import type { ArsenalItem, Board, CellState, Coord, Marks, Ship } from '@engine/types';
import { Image } from 'expo-image';
import { memo, useCallback, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import Svg, { G, Line } from 'react-native-svg';

import type { Asset } from '@/ui/assets';
import { color, font } from '@/ui/tokens';
import { RoughShape, hashString, roughLine, roughRect } from '@/ui/useRough';
import { useTutorialTarget } from '@/tutorial/useTutorialTarget';
import { CellMark } from './CellMark';
import {
  BOARD_SIZE,
  BOARD_TOP,
  CELL,
  COL_LABELS,
  GRID,
  ROW_LABELS,
  pointToCell,
  shipRect,
  type BoardOrigin,
} from './layout';
import { ArsenalSprite, ShipSprite } from './ShipSprite';

/** Room around the board for labels and the frame's overshoot. */
export const LABEL_MARGIN = 24;
const OUTER = BOARD_SIZE + LABEL_MARGIN * 2;
const OVERSHOOT = 5;
const LABEL_SIZE = 16;

export type LabelSide = 'left' | 'right' | 'none';

export interface GridBoardProps {
  /** Battle: the board's top-left on the canvas. */
  origin?: BoardOrigin;
  /** Placement: the same thing as two numbers; y defaults to BOARD_TOP. */
  x?: number;
  y?: number;
  /** A whole engine Board; `cells`/`ships`/`arsenal` override its parts. */
  board?: Board;
  /** What is known about this board, keyed by coordKey. */
  cells?: Marks;
  /** Own board only — the enemy's ships never reach the client. Sunk ones draw as wrecks. */
  ships?: readonly Ship[];
  arsenal?: readonly ArsenalItem[];
  /** Draw `board.ships` / `board.arsenal`. Explicit `ships`/`arsenal` always draw. */
  revealShips?: boolean;
  /** Placement renders its draggable ships in a shared overlay instead. */
  hideShips?: boolean;
  /** true: always touchable; false: never; omitted: whenever a callback is given. */
  interactive?: boolean;
  onCellPress?: (coord: Coord) => void;
  onCellLongPress?: (coord: Coord) => void;
  onPressCell?: (r: number, c: number) => void;
  highlight?: readonly Coord[];
  highlightTone?: 'green' | 'red' | 'ink';
  watermark?: Asset;
  /** Which outer side carries the row letters. */
  labels?: LabelSide;
  /** Column numbers above the board. Off in battle, where the HUD sits there. */
  columnLabels?: boolean;
  /** Stable key for the frame's wobble. */
  seedKey?: string;
  /** Pop marks in as they land. */
  animateMarks?: boolean;
  children?: ReactNode;
}

// ---------------------------------------------------------------------------
// Static layer — rules, frame, labels, watermark. Renders once per board.
// ---------------------------------------------------------------------------

interface StaticLayerProps {
  origin: BoardOrigin;
  labels: LabelSide;
  columnLabels: boolean;
  seedKey: string;
  watermark: Asset | undefined;
}

function buildRules(): ReactNode[] {
  const lines: ReactNode[] = [];
  for (let i = 0; i <= GRID; i++) {
    const p = LABEL_MARGIN + i * CELL;
    const major = i % 5 === 0;
    lines.push(
      <Line
        key={`v${i}`}
        x1={p}
        y1={LABEL_MARGIN}
        x2={p}
        y2={LABEL_MARGIN + BOARD_SIZE}
        stroke={color.gridMajor}
        strokeWidth={major ? 1.35 : 0.85}
      />,
      <Line
        key={`h${i}`}
        x1={LABEL_MARGIN}
        y1={p}
        x2={LABEL_MARGIN + BOARD_SIZE}
        y2={p}
        stroke={color.gridMajor}
        strokeWidth={major ? 1.35 : 0.85}
      />,
    );
  }
  return lines;
}

function StaticLayerInner({ labels, columnLabels, seedKey, watermark }: StaticLayerProps) {
  const seed = hashString(`board-frame-${seedKey}`);
  const m = LABEL_MARGIN;
  const e = m + BOARD_SIZE;
  const heavy = { stroke: color.ink, strokeWidth: 2.3, roughness: 1.3, bowing: 0.9 } as const;
  const edges = [
    roughLine(m - OVERSHOOT, m, e + OVERSHOOT, m, { ...heavy, seed: seed + 1 }),
    roughLine(e, m - OVERSHOOT, e, e + OVERSHOOT, { ...heavy, seed: seed + 2 }),
    roughLine(e + OVERSHOOT, e, m - OVERSHOOT, e, { ...heavy, seed: seed + 3 }),
    roughLine(m, e + OVERSHOOT, m, m - OVERSHOOT, { ...heavy, seed: seed + 4 }),
  ];
  const inner = roughRect(m + 3, m + 3, BOARD_SIZE - 6, BOARD_SIZE - 6, {
    seed: seed + 5,
    stroke: color.ink,
    strokeWidth: 1.1,
    roughness: 1.1,
  });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={styles.sheetMask} />
      {watermark ? (
        <View style={styles.watermarkClip}>
          <Image
            source={watermark}
            style={styles.watermark}
            contentFit="contain"
            tintColor={color.ink}
            cachePolicy="memory-disk"
          />
        </View>
      ) : null}
      <Svg
        width={OUTER}
        height={OUTER}
        viewBox={`0 0 ${OUTER} ${OUTER}`}
        style={StyleSheet.absoluteFill}
      >
        <G>{buildRules()}</G>
        {edges.map((paths, i) => (
          <RoughShape key={i} paths={paths} />
        ))}
        <RoughShape paths={inner} />
      </Svg>
      {columnLabels
        ? COL_LABELS.map((label, c) => (
            <Text
              key={`c${c}`}
              style={[
                styles.label,
                { left: m + c * CELL, top: 2, width: CELL, height: m - 4, lineHeight: m - 4 },
              ]}
            >
              {label}
            </Text>
          ))
        : null}
      {labels !== 'none'
        ? ROW_LABELS.map((label, r) => (
            <Text
              key={`r${r}`}
              style={[
                styles.label,
                {
                  left: labels === 'left' ? 0 : e + 2,
                  top: m + r * CELL,
                  width: m - 2,
                  height: CELL,
                  lineHeight: CELL,
                },
              ]}
            >
              {label}
            </Text>
          ))
        : null}
    </View>
  );
}

/** Only `origin` (and the static identity props) can change what this draws. */
const StaticLayer = memo(
  StaticLayerInner,
  (a, b) =>
    a.origin.x === b.origin.x &&
    a.origin.y === b.origin.y &&
    a.labels === b.labels &&
    a.columnLabels === b.columnLabels &&
    a.seedKey === b.seedKey &&
    a.watermark === b.watermark,
);

// ---------------------------------------------------------------------------
// Highlight overlay
// ---------------------------------------------------------------------------

const TONES = { green: color.inkGreen, red: color.inkRed, ink: color.inkSoft } as const;

const Highlight = memo(function Highlight({
  cells,
  tone,
  seedKey,
}: {
  cells: readonly Coord[];
  tone: keyof typeof TONES;
  seedKey: string;
}) {
  if (cells.length === 0) return null;
  const stroke = TONES[tone];
  return (
    <Svg
      width={BOARD_SIZE}
      height={BOARD_SIZE}
      viewBox={`0 0 ${BOARD_SIZE} ${BOARD_SIZE}`}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    >
      {cells.map((cell) => (
        <RoughShape
          key={coordKey(cell)}
          paths={roughRect(cell.c * CELL + 1.5, cell.r * CELL + 1.5, CELL - 3, CELL - 3, {
            seed: hashString(`hl-${seedKey}-${tone}-${coordKey(cell)}`),
            stroke,
            strokeWidth: 1.6,
            fill: stroke,
            fillStyle: 'hachure',
            hachureGap: 4,
            fillWeight: 0.9,
            roughness: 1,
          })}
          opacity={0.7}
        />
      ))}
    </Svg>
  );
});

// ---------------------------------------------------------------------------
// GridBoard
// ---------------------------------------------------------------------------

function GridBoardInner({
  origin,
  x,
  y = BOARD_TOP,
  board,
  cells,
  ships,
  arsenal,
  revealShips = false,
  hideShips = false,
  interactive,
  onCellPress,
  onCellLongPress,
  onPressCell,
  highlight,
  highlightTone = 'green',
  watermark,
  labels = 'left',
  columnLabels = true,
  seedKey = 'own',
  animateMarks = true,
  children,
}: GridBoardProps) {
  const at: BoardOrigin = origin ?? { x: x ?? 0, y };
  const displayCells = cells ?? board?.marks;
  const displayShips = hideShips ? undefined : (ships ?? (revealShips ? board?.ships : undefined));
  const displayArsenal = arsenal ?? (revealShips ? board?.arsenal : undefined);
  const touchable =
    interactive === undefined
      ? Boolean(onCellPress || onCellLongPress || onPressCell)
      : interactive;

  const cellFromEvent = useCallback((e: GestureResponderEvent): Coord | null => {
    // locationX/Y are in the Pressable's own (design-unit) space; the
    // Pressable covers exactly the 280 x 280 board, so the origin is 0,0.
    const { locationX, locationY } = e.nativeEvent;
    return pointToCell({ x: locationX, y: locationY }, { x: 0, y: 0 });
  }, []);
  const handlePress = useCallback(
    (e: GestureResponderEvent) => {
      const cell = cellFromEvent(e);
      if (!cell) return;
      onCellPress?.(cell);
      onPressCell?.(cell.r, cell.c);
    },
    [cellFromEvent, onCellPress, onPressCell],
  );
  const handleLongPress = useCallback(
    (e: GestureResponderEvent) => {
      const cell = cellFromEvent(e);
      if (cell) onCellLongPress?.(cell);
    },
    [cellFromEvent, onCellLongPress],
  );

  // The tutorial spotlights cells by board: this registers `board-<seedKey>`.
  const tutorialTarget = useTutorialTarget(`board-${seedKey}`);

  const marks = displayCells ? (Object.entries(displayCells) as [string, CellState][]) : [];
  const revealed = marks.filter(([, state]) => state === 'revealed');
  const others = marks.filter(([, state]) => state !== 'revealed');

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: at.x - LABEL_MARGIN,
        top: at.y - LABEL_MARGIN,
        width: OUTER,
        height: OUTER,
      }}
    >
      <StaticLayer
        origin={at}
        labels={labels}
        columnLabels={columnLabels}
        seedKey={seedKey}
        watermark={watermark}
      />
      <View
        {...tutorialTarget}
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          left: LABEL_MARGIN,
          top: LABEL_MARGIN,
          width: BOARD_SIZE,
          height: BOARD_SIZE,
        }}
      >
        {revealed.map(([key, state]) => (
          <CellMark key={key} state={state} coord={parseKey(key)} animate={animateMarks} />
        ))}
        {displayShips?.map((ship) => {
          const rect = shipRect(ship);
          return (
            <View
              key={ship.id}
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: rect.x,
                top: rect.y,
                width: rect.w,
                height: rect.h,
              }}
            >
              <ShipSprite
                shipClass={ship.class}
                orientation={ship.orientation}
                sunk={isSunk(ship)}
              />
            </View>
          );
        })}
        {displayArsenal?.map((item) =>
          item.at ? <ArsenalSprite key={item.id} item={item} /> : null,
        )}
        {others.map(([key, state]) => (
          <CellMark key={key} state={state} coord={parseKey(key)} animate={animateMarks} />
        ))}
        {highlight && highlight.length > 0 ? (
          <Highlight cells={highlight} tone={highlightTone} seedKey={seedKey} />
        ) : null}
        {children}
        {touchable ? (
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={handlePress}
            onLongPress={onCellLongPress ? handleLongPress : undefined}
            delayLongPress={350}
            accessibilityRole="button"
            accessibilityLabel="Grid, 10 by 10"
          />
        ) : null}
      </View>
    </View>
  );
}

export const GridBoard = memo(GridBoardInner);

const styles = StyleSheet.create({
  label: {
    position: 'absolute',
    color: color.ink,
    fontFamily: font.display,
    fontSize: LABEL_SIZE,
    textAlign: 'center',
  },
  sheetMask: {
    position: 'absolute',
    left: LABEL_MARGIN,
    top: LABEL_MARGIN,
    width: BOARD_SIZE,
    height: BOARD_SIZE,
    backgroundColor: color.paper,
  },
  watermarkClip: {
    position: 'absolute',
    left: LABEL_MARGIN,
    top: LABEL_MARGIN,
    width: BOARD_SIZE,
    height: BOARD_SIZE,
    overflow: 'hidden',
  },
  watermark: {
    position: 'absolute',
    left: 10,
    top: 10,
    width: BOARD_SIZE - 20,
    height: BOARD_SIZE - 20,
    opacity: 0.12,
  },
});
