/**
 * The collect animation — part-02 §6.
 *
 * "the bubble pops, 6-10 tiny ink coins/girders arc to the HUD chip over
 * 420 ms with a slight stagger, the number rolls, light haptic."
 *
 * Presentation only. The number the HUD rolls to is whatever the server sent;
 * nothing here adds up a balance.
 */
import { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg from 'react-native-svg';

import { COIN_GOLD } from '@/ui/CurrencyChip';
import { color } from '@/ui/tokens';
import { RoughShape, hashString, useRough } from '@/ui/useRough';

export const COLLECT_FLIGHT_MS = 420;
const STAGGER_MS = 28;

export interface Flight {
  readonly id: string;
  readonly from: { x: number; y: number };
  readonly to: { x: number; y: number };
  readonly resource: 'coins' | 'steel';
  readonly count: number;
}

const Token = memo(function Token({
  from,
  to,
  resource,
  index,
  seedKey,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  resource: 'coins' | 'steel';
  index: number;
  seedKey: string;
}) {
  const t = useSharedValue(0);
  const { roughCircle, roughPolygon } = useRough();

  useEffect(() => {
    t.value = withDelay(
      index * STAGGER_MS,
      withTiming(1, { duration: COLLECT_FLIGHT_MS, easing: Easing.inOut(Easing.quad) }),
    );
  }, [t, index]);

  // A shallow arc: the token lifts before it flies, so a row of them reads as
  // a handful thrown rather than a straight line.
  const lift = 26 + (index % 3) * 8;
  const spread = ((index % 5) - 2) * 7;

  const style = useAnimatedStyle(() => {
    const p = t.value;
    const x = from.x + spread * (1 - p) + (to.x - from.x) * p;
    const y = from.y + (to.y - from.y) * p - Math.sin(Math.PI * p) * lift;
    return {
      opacity: p < 0.92 ? 1 : (1 - p) / 0.08,
      transform: [{ translateX: x }, { translateY: y }, { scale: 1 - p * 0.35 }],
    };
  });

  const seed = hashString(`${seedKey}-${index}`);
  const paths =
    resource === 'coins'
      ? roughCircle(5, 5, 9, { seed, strokeWidth: 1, stroke: COIN_GOLD, fill: COIN_GOLD, fillStyle: 'solid' })
      : roughPolygon(
          [
            [1, 2],
            [9, 2],
            [9, 8],
            [1, 8],
          ],
          { seed, strokeWidth: 1, stroke: color.ink, fill: color.ink, fillStyle: 'solid' },
        );

  return (
    <Animated.View style={[styles.token, style]} pointerEvents="none">
      <Svg width={10} height={10}>
        <RoughShape paths={paths} />
      </Svg>
    </Animated.View>
  );
});

export function CollectFlightLayer({
  flights,
  onDone,
}: {
  readonly flights: readonly Flight[];
  readonly onDone: (id: string) => void;
}) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion || flights.length === 0) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {flights.map((flight) => (
        <FlightGroup key={flight.id} flight={flight} onDone={onDone} />
      ))}
    </View>
  );
}

function FlightGroup({
  flight,
  onDone,
}: {
  flight: Flight;
  onDone: (id: string) => void;
}) {
  const done = useSharedValue(0);
  useEffect(() => {
    const total = COLLECT_FLIGHT_MS + flight.count * STAGGER_MS + 60;
    done.value = withDelay(total, withTiming(1, { duration: 1 }, (finished) => {
      if (finished) runOnJS(onDone)(flight.id);
    }));
  }, [done, flight.id, flight.count, onDone]);

  return (
    <>
      {Array.from({ length: flight.count }, (_, index) => (
        <Token
          key={index}
          index={index}
          from={flight.from}
          to={flight.to}
          resource={flight.resource}
          seedKey={flight.id}
        />
      ))}
    </>
  );
}

/** 6-10 tokens, scaled a little by how much was collected (§6). */
export function tokenCountFor(amount: number): number {
  if (amount <= 0) return 0;
  return Math.max(6, Math.min(10, 6 + Math.floor(amount / 60)));
}

const styles = StyleSheet.create({
  token: { position: 'absolute', left: 0, top: 0, width: 10, height: 10 },
});
