/**
 * The tutorial's overlay driver, drawn over the REAL screens:
 *   - a full-canvas ink dim with an SVG mask cutting a hole around the
 *     spotlight target, outlined in a dashed animated ink stroke
 *   - the Captain, on a paper card, sliding in from the beat's side with the
 *     P01 SpeechBubble — the bubble steps out of the spotlight's way, above or
 *     below the hole, so the square the player must tap is never under it
 *   - a pointing-hand cursor that animates to the required target and taps
 *     twice, looping every 2 s until the player acts
 *   - a Skip button pinned top-right on every beat
 *   - every touch outside the required target is swallowed and counted as a
 *     wrong tap, which re-prompts the Captain and restarts the hand
 *
 * Targets come from useTutorialTarget() registrations — nothing here knows
 * where the Arsenal tab or a shop card is until the element says so.
 */
import { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, Mask, Rect } from 'react-native-svg';

import { CELL } from '@/board/layout';
import { AssetSlot } from '@/ui/AssetSlot';
import { AVATARS, UI_ART } from '@/ui/assets';
import { InkButton } from '@/ui/InkButton';
import { InkPanel } from '@/ui/InkPanel';
import { Scale } from '@/ui/Scale';
import { SpeechBubble } from '@/ui/SpeechBubble';
import { CANVAS_H, CANVAS_W, color } from '@/ui/tokens';
import { RoughShape, hashString, roughCircle, roughPolygon } from '@/ui/useRough';
import { currentStep, useTutorial, type TargetRect } from './store';
import type { Requirement, Step } from './script';

const AnimatedRect = Animated.createAnimatedComponent(Rect);
const W = CANVAS_W;
const H = CANVAS_H;
const HOLE_PAD = 4;
/** How far the dim runs past the canvas edges, canvas units. */
const DIM_BLEED = 200;
const CAPTAIN = { w: 150, h: 200 } as const;
/** The paper card the portrait sits on: the portrait plus this much all round. */
const CARD_PAD = 8;
const HAND = 44;
const BUBBLE_W = 250;
/** Room a bubble is assumed to need when checking it against the spotlight. */
const BUBBLE_EST_H = 96;
/** The bubble never rises above the Skip button's row. */
const BUBBLE_MIN_TOP = 46;

// ---------------------------------------------------------------------------
// Resolving rects from the script and the registry
// ---------------------------------------------------------------------------

function cellRectOn(board: TargetRect, r: number, c: number): TargetRect {
  return { x: board.x + c * CELL, y: board.y + r * CELL, w: CELL, h: CELL };
}

/** 'enemy:F5' -> the cell's rect on the registered board. */
function resolveCellRef(ref: string, targets: Record<string, TargetRect>): TargetRect | null {
  const [boardKey, label] = ref.split(':');
  const board = targets[`board-${boardKey ?? ''}`];
  if (!board || !label) return null;
  const r = label.charCodeAt(0) - 65;
  const c = Number(label.slice(1)) - 1;
  return cellRectOn(board, r, c);
}

function spotlightRect(step: Step, targets: Record<string, TargetRect>): TargetRect | null {
  if (!step.spotlight) return null;
  return step.spotlight.target === 'cell'
    ? resolveCellRef(step.spotlight.ref, targets)
    : (targets[step.spotlight.ref] ?? null);
}

/** Where touches are allowed through, or null to swallow everything. */
function inputRect(
  req: Requirement | undefined,
  targets: Record<string, TargetRect>,
): TargetRect | null | 'all' {
  if (!req) return null;
  switch (req.kind) {
    case 'wait':
      return null;
    case 'tap-cell': {
      const board = targets[`board-${req.board}`];
      return board ? cellRectOn(board, req.coord.r, req.coord.c) : null;
    }
    case 'tap-element':
      return targets[req.ref] ?? null;
    case 'drag-ship':
      return 'all';
    case 'place-item':
      return targets['board-placement'] ?? null;
  }
}

const centre = (r: TargetRect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

// ---------------------------------------------------------------------------
// Dim + spotlight
// ---------------------------------------------------------------------------

function Spotlight({ hole, pulse }: { hole: TargetRect | null; pulse: boolean }) {
  const dash = useSharedValue(0);
  const glow = useSharedValue(1);
  useEffect(() => {
    dash.value = withRepeat(withTiming(-22, { duration: 700, easing: Easing.linear }), -1, false);
    glow.value = pulse
      ? withRepeat(
          withSequence(withTiming(0.35, { duration: 500 }), withTiming(1, { duration: 500 })),
          -1,
          true,
        )
      : 1;
  }, [dash, glow, pulse]);
  const dashProps = useAnimatedProps(() => ({ strokeDashoffset: dash.value, opacity: glow.value }));

  const x = hole ? hole.x - HOLE_PAD : 0;
  const y = hole ? hole.y - HOLE_PAD : 0;
  const w = hole ? hole.w + HOLE_PAD * 2 : 0;
  const h = hole ? hole.h + HOLE_PAD * 2 : 0;

  // The dim reaches past the canvas: the screen around it is paper as well
  // (Scale's backdrop), and a bright frame around a dimmed page reads wrong.
  const dx = -DIM_BLEED;
  const dy = -DIM_BLEED;
  const dw = W + DIM_BLEED * 2;
  const dh = H + DIM_BLEED * 2;

  return (
    <Svg
      width={dw}
      height={dh}
      viewBox={`${dx} ${dy} ${dw} ${dh}`}
      style={{ position: 'absolute', left: dx, top: dy, width: dw, height: dh }}
      pointerEvents="none"
    >
      <Defs>
        <Mask id="tutorial-spot" maskUnits="userSpaceOnUse" x={dx} y={dy} width={dw} height={dh}>
          <Rect x={dx} y={dy} width={dw} height={dh} fill="white" />
          {hole ? <Rect x={x} y={y} width={w} height={h} rx={5} fill="black" /> : null}
        </Mask>
      </Defs>
      <Rect
        x={dx}
        y={dy}
        width={dw}
        height={dh}
        fill={color.ink}
        opacity={0.45}
        mask="url(#tutorial-spot)"
      />
      {hole ? (
        <AnimatedRect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={5}
          fill="none"
          stroke={color.ink}
          strokeWidth={2}
          strokeDasharray={[6, 5]}
          strokeLinecap="round"
          animatedProps={dashProps}
        />
      ) : null}
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// The hand cursor
// ---------------------------------------------------------------------------

function handPaths() {
  const seed = hashString('hand-pointer');
  const ink = {
    stroke: color.ink,
    strokeWidth: 1.5,
    fill: color.paper,
    fillStyle: 'solid',
  } as const;
  return [
    // palm
    roughPolygon(
      [
        [14, 22],
        [30, 20],
        [34, 30],
        [30, 40],
        [16, 40],
        [12, 30],
      ],
      { seed, ...ink },
    ),
    // pointing finger
    roughPolygon(
      [
        [16, 24],
        [16, 6],
        [22, 4],
        [24, 24],
      ],
      { seed: seed + 1, ...ink },
    ),
    roughCircle(19, 6, 6, { seed: seed + 2, ...ink }),
  ];
}

function HandCursor({
  from,
  to,
  nonce,
  drag,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  nonce: number;
  drag: boolean;
}) {
  const x = useSharedValue(from.x);
  const y = useSharedValue(from.y);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0);

  useEffect(() => {
    // Fingertip is at (19, 6) in the 44-box: offset so it lands on the target.
    const tipX = 19;
    const tipY = 6;
    const start = drag
      ? { x: from.x - tipX, y: from.y - tipY }
      : { x: to.x - tipX + 38, y: to.y - tipY + 52 };
    const end = { x: to.x - tipX, y: to.y - tipY };
    const move = drag ? 900 : 600;
    x.value = start.x;
    y.value = start.y;
    opacity.value = 0;
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 150 }),
        withTiming(1, { duration: 1450 }),
        withTiming(0, { duration: 250 }),
        withTiming(0, { duration: 150 }),
      ),
      -1,
      false,
    );
    x.value = withRepeat(
      withSequence(
        withTiming(end.x, { duration: move, easing: Easing.inOut(Easing.quad) }),
        withTiming(end.x, { duration: 2000 - move - 150 }),
        withTiming(start.x, { duration: 150 }),
      ),
      -1,
      false,
    );
    y.value = withRepeat(
      withSequence(
        withTiming(end.y, { duration: move, easing: Easing.inOut(Easing.quad) }),
        withTiming(end.y, { duration: 2000 - move - 150 }),
        withTiming(start.y, { duration: 150 }),
      ),
      -1,
      false,
    );
    scale.value = drag
      ? withRepeat(
          withSequence(
            withTiming(0.85, { duration: 120 }),
            withTiming(0.85, { duration: move }),
            withTiming(1, { duration: 120 }),
            withTiming(1, { duration: 2000 - move - 240 }),
          ),
          -1,
          false,
        )
      : withRepeat(
          withSequence(
            withDelay(move, withTiming(0.82, { duration: 130 })),
            withTiming(1, { duration: 130 }),
            withTiming(0.82, { duration: 130 }),
            withTiming(1, { duration: 130 }),
            withTiming(1, { duration: 2000 - move - 520 }),
          ),
          -1,
          false,
        );
  }, [from.x, from.y, to.x, to.y, nonce, drag, x, y, scale, opacity]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }));
  const paths = useMemo(handPaths, []);

  return (
    <Animated.View pointerEvents="none" style={[styles.hand, style]}>
      {UI_ART.handPointer ? (
        <AssetSlot source={UI_ART.handPointer} w={HAND} h={HAND} label="hand" />
      ) : (
        <Svg width={HAND} height={HAND} viewBox={`0 0 ${HAND} ${HAND}`}>
          {paths.map((p, i) => (
            <RoughShape key={i} paths={p} />
          ))}
        </Svg>
      )}
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// The Captain
// ---------------------------------------------------------------------------

const intersects = (a: TargetRect, b: TargetRect, pad: number) =>
  a.x < b.x + b.w + pad && a.x + a.w > b.x - pad && a.y < b.y + b.h + pad && a.y + a.h > b.y - pad;

/**
 * Where the bubble goes: beside the Captain's head by default; if that would
 * sit on the spotlight, above the hole when there is room, else below it.
 * The tail slides along the bubble's edge to keep pointing at the Captain.
 */
function placeBubble(
  side: 'left' | 'right',
  hole: TargetRect | null,
): { left: number; top: number; tailAt: number } {
  const captainLeft = side === 'right' ? W - CAPTAIN.w - 10 : 10;
  const left = side === 'right' ? captainLeft - BUBBLE_W - 14 : captainLeft + CAPTAIN.w + 2;
  const headY = H - CAPTAIN.h + 30;
  let top = H - CAPTAIN.h + 6;
  if (hole && intersects({ x: left, y: top, w: BUBBLE_W, h: BUBBLE_EST_H }, hole, 10)) {
    const above = hole.y - HOLE_PAD - 14 - BUBBLE_EST_H;
    const below = hole.y + hole.h + HOLE_PAD + 14;
    top = above >= BUBBLE_MIN_TOP ? above : Math.min(below, H - BUBBLE_EST_H - 4);
  }
  // Tail towards the Captain's face: bottom of the edge when the bubble is
  // high, top of it when low, a third down beside him.
  const tailAt = top + BUBBLE_EST_H / 2 < headY - 20 ? 0.92 : top > headY + 20 ? 0.12 : 0.3;
  return { left, top, tailAt };
}

function Captain({
  side,
  text,
  nonce,
  hole,
}: {
  side: 'left' | 'right';
  text: string;
  nonce: number;
  hole: TargetRect | null;
}) {
  const rise = useSharedValue(120);
  useEffect(() => {
    rise.value = 120;
    rise.value = withTiming(0, { duration: 320, easing: Easing.out(Easing.cubic) });
  }, [side, rise]);
  const slide = useAnimatedStyle(() => ({ transform: [{ translateY: rise.value }] }));

  const left = side === 'right' ? W - CAPTAIN.w - 10 : 10;
  const bubble = placeBubble(side, hole);
  const cardW = CAPTAIN.w + CARD_PAD * 2;
  const cardH = CAPTAIN.h + CARD_PAD * 2;

  return (
    <>
      {/* The portrait on a paper card, so the ink reads against the dim. The
          card runs a little past the bottom edge, like a photo tucked in. */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            left: left - CARD_PAD,
            top: H - CAPTAIN.h - CARD_PAD,
            width: cardW,
            height: cardH + CARD_PAD,
          },
          slide,
        ]}
      >
        <InkPanel w={cardW} h={cardH + CARD_PAD} seedKey="captain-card" padding={CARD_PAD}>
          <AssetSlot source={AVATARS.captain} w={CAPTAIN.w} h={CAPTAIN.h} label="captain" />
        </InkPanel>
      </Animated.View>
      <View pointerEvents="none" style={{ position: 'absolute', left: bubble.left, top: bubble.top }}>
        <SpeechBubble
          key={`${nonce}-${text}`}
          text={text}
          tail={side === 'right' ? 'right' : 'left'}
          tailAt={bubble.tailAt}
          w={BUBBLE_W}
          seedKey={`captain-${side}`}
        />
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

export function TutorialOverlay({ onSkip }: { onSkip: () => void }) {
  const active = useTutorial((s) => s.active);
  const stepIndex = useTutorial((s) => s.stepIndex);
  const targets = useTutorial((s) => s.targets);
  const handNonce = useTutorial((s) => s.handNonce);
  const nudge = useTutorial((s) => s.nudge);
  const wrongTap = useTutorial((s) => s.wrongTap);
  if (!active) return null;

  const step = currentStep({ stepIndex });
  const hole = spotlightRect(step, targets);
  const input = inputRect(step.require, targets);
  const text = nudge ?? step.say?.text ?? '';
  const side = step.say?.side ?? 'right';

  // Where the hand goes: the input target, or the drag's destination.
  let handTo: { x: number; y: number } | null = null;
  let handFrom: { x: number; y: number } | null = null;
  const req = step.require;
  if (req?.kind === 'drag-ship') {
    const ship = targets[`ship-${req.shipId}`];
    const board = targets['board-placement'];
    if (ship && board) {
      // From the ship's FIRST cell: a drop is judged by where the bow lands,
      // so the hand shows the grab that puts it on the target square.
      handFrom = {
        x: ship.x + Math.min(ship.w, CELL + 8) / 2,
        y: ship.y + Math.min(ship.h, CELL + 8) / 2,
      };
      handTo = centre(cellRectOn(board, req.to.r, req.to.c));
    }
  } else if (input && input !== 'all') {
    handTo = centre(input);
    handFrom = handTo;
  }

  const swallow = input === 'all' ? [] : input ? aroundRects(input) : [{ x: 0, y: 0, w: W, h: H }];

  return (
    <Scale transparent>
      <Spotlight hole={hole} pulse={step.spotlight?.target === 'element'} />
      {swallow.map((r, i) => (
        <Pressable
          key={i}
          onPress={wrongTap}
          accessibilityLabel="Tutorial guard"
          style={{ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h }}
        />
      ))}
      {text ? <Captain side={side} text={text} nonce={handNonce} hole={hole} /> : null}
      {handTo && handFrom ? (
        <HandCursor
          from={handFrom}
          to={handTo}
          nonce={handNonce}
          drag={req?.kind === 'drag-ship'}
        />
      ) : null}
      <View style={styles.skip}>
        <InkButton label="Skip" size="sm" w={80} h={34} seedKey="tutorial-skip" onPress={onSkip} />
      </View>
    </Scale>
  );
}

/** Four rects covering everything except `r`. */
function aroundRects(r: TargetRect): TargetRect[] {
  const x0 = Math.max(0, r.x - 1);
  const y0 = Math.max(0, r.y - 1);
  const x1 = Math.min(W, r.x + r.w + 1);
  const y1 = Math.min(H, r.y + r.h + 1);
  return [
    { x: 0, y: 0, w: W, h: y0 },
    { x: 0, y: y1, w: W, h: H - y1 },
    { x: 0, y: y0, w: x0, h: y1 - y0 },
    { x: x1, y: y0, w: W - x1, h: y1 - y0 },
  ].filter((q) => q.w > 0 && q.h > 0);
}

const styles = StyleSheet.create({
  hand: { position: 'absolute', left: 0, top: 0, width: HAND, height: HAND },
  skip: { position: 'absolute', right: 14, top: 6 },
});
