/**
 * The battle layout from the reference screenshots: own board at x = 100,
 * enemy at x = 420, a 40-unit gutter with the TurnTriangle centred in it.
 * Row letters sit on the outer side of each board. In battle the boards sit
 * under the HUD strip (top = BATTLE_BOARD_TOP) with no column numbers.
 *
 * `boardStyle` is applied to the container holding both boards and the
 * triangle — that is how the HIT camera shake moves the boards and never the
 * HUD. Nothing else on this level animates.
 */
import type { ArsenalItem, Coord, Marks, Ship } from '@engine/types';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { type AnimatedStyle } from 'react-native-reanimated';
import type { StyleProp, ViewStyle } from 'react-native';

import { BOARD_ART } from '@/ui/assets';
import { CANVAS_H, CANVAS_W } from '@/ui/tokens';
import { TurnTriangle, type TurnState } from '@/ui/TurnTriangle';
import { GridBoard, type BoardSkin } from './GridBoard';
import { BOARD_TOP, boardOrigins } from './layout';

export interface DualBoardsProps {
  own: {
    cells: Marks;
    ships: readonly Ship[];
    arsenal?: readonly ArsenalItem[];
    highlight?: readonly Coord[];
  };
  enemy: {
    cells: Marks;
    /** Sunk enemy ships, rebuilt from the view — drawn as wrecks. */
    wrecks?: readonly Ship[];
    /** Enemy own-board items the rules have revealed. */
    revealed?: readonly ArsenalItem[];
    highlight?: readonly Coord[];
    highlightTone?: 'green' | 'red' | 'ink';
  };
  turn: TurnState;
  seconds?: number;
  /** Snap the triangle flip instead of animating it (after a mine). */
  snapTurn?: boolean;
  /** Fire at the enemy board. Off while it is not your turn. */
  interactive: boolean;
  onEnemyCellPress?: (coord: Coord) => void;
  onEnemyCellLongPress?: (coord: Coord) => void;
  onOwnCellPress?: (coord: Coord) => void;
  animateMarks?: boolean;
  /** Top edge of both boards; BATTLE_BOARD_TOP under the HUD. */
  top?: number;
  columnLabels?: boolean;
  /** Animated style for the camera shake — boards only, never the HUD. */
  boardStyle?: StyleProp<AnimatedStyle<ViewStyle>>;
  /** Anything that must move with the boards (fx overlays, gutter buttons). */
  children?: ReactNode;
  skin?: BoardSkin;
}

const TRIANGLE_SIZE = 62;
const TRIANGLE_W = 34;

export function DualBoards({
  own,
  enemy,
  turn,
  seconds,
  snapTurn,
  interactive,
  onEnemyCellPress,
  onEnemyCellLongPress,
  onOwnCellPress,
  animateMarks = true,
  top = BOARD_TOP,
  columnLabels = true,
  boardStyle,
  children,
  skin = 'ink',
}: DualBoardsProps) {
  const origins = boardOrigins(top);
  const triW = TRIANGLE_W;
  return (
    <Animated.View style={[styles.canvas, boardStyle]} pointerEvents="box-none">
      <GridBoard
        origin={origins.own}
        cells={own.cells}
        ships={own.ships}
        arsenal={own.arsenal}
        highlight={own.highlight}
        interactive={onOwnCellPress !== undefined}
        onCellPress={onOwnCellPress}
        labels="left"
        columnLabels={columnLabels}
        seedKey="own"
        watermark={BOARD_ART.watermarkAnchor}
        animateMarks={animateMarks}
        skin={skin}
      />
      <GridBoard
        origin={origins.enemy}
        cells={enemy.cells}
        ships={enemy.wrecks}
        arsenal={enemy.revealed}
        highlight={enemy.highlight}
        highlightTone={enemy.highlightTone}
        interactive={interactive}
        onCellPress={onEnemyCellPress}
        onCellLongPress={onEnemyCellLongPress}
        labels="right"
        columnLabels={columnLabels}
        seedKey="enemy"
        watermark={BOARD_ART.watermarkKraken}
        animateMarks={animateMarks}
        skin={skin}
        wrecks
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: origins.gutterCentre.x - triW / 2,
          top: origins.gutterCentre.y - TRIANGLE_SIZE / 2,
        }}
      >
        <TurnTriangle
          direction={turn === 'theirs' ? 'left' : 'right'}
          state={turn}
          seconds={seconds}
          snap={snapTurn}
          size={TRIANGLE_SIZE}
          width={TRIANGLE_W}
          seedKey="battle"
        />
      </View>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  canvas: { position: 'absolute', left: 0, top: 0, width: CANVAS_W, height: CANVAS_H },
});
