import { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { CITY_PALETTES, type LivingWorldState } from '@engine/liveWorld';
import { MAP_H, MAP_W } from './plots';

export const LIVING_WORLD_SCENE_ASSET_COUNT = 1;
export const LIGHTHOUSE_SWEEP_MS = 6_000;

const Snow = memo(function Snow() {
  return (
    <Svg width={MAP_W} height={MAP_H} style={StyleSheet.absoluteFill}>
      {Array.from({ length: 44 }, (_, i) => (
        <Line
          key={i}
          x1={(i * 83) % MAP_W}
          y1={(i * 137) % MAP_H}
          x2={((i * 83) % MAP_W) + 5}
          y2={((i * 137) % MAP_H) + 2}
          stroke="#EAF6FF"
          strokeWidth={1.2}
          opacity={0.72}
        />
      ))}
    </Svg>
  );
});

const Lanterns = memo(function Lanterns() {
  return (
    <Svg width={MAP_W} height={MAP_H} style={StyleSheet.absoluteFill}>
      <Path d="M80 285 Q260 245 430 280 T730 260" fill="none" stroke="#FFD36A" strokeWidth={1.5} />
      {Array.from({ length: 12 }, (_, i) => (
        <Circle key={i} cx={92 + i * 55} cy={274 + (i % 3) * 5} r={4} fill="#FFD36A" />
      ))}
    </Svg>
  );
});

function Rain() {
  return (
    <Svg width={MAP_W} height={MAP_H} style={StyleSheet.absoluteFill}>
      {Array.from({ length: 54 }, (_, i) => {
        const x = (i * 71) % MAP_W;
        const y = (i * 113) % MAP_H;
        return <Line key={i} x1={x} y1={y} x2={x + 8} y2={y + 15} stroke="#BBDDF5" opacity={0.55} />;
      })}
    </Svg>
  );
}

function LighthouseBeam() {
  const sweep = useSharedValue(0);
  useEffect(() => {
    sweep.value = withRepeat(withTiming(1, { duration: LIGHTHOUSE_SWEEP_MS, easing: Easing.linear }), -1);
  }, [sweep]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${-32 + sweep.value * 64}deg` }] }));
  return (
    <Animated.View style={[styles.beam, style]}>
      <Svg width={230} height={80}>
        <Path d="M0 40 L225 4 L225 76 Z" fill="#FFD36A" opacity={0.16} />
      </Svg>
    </Animated.View>
  );
}

export function LivingWorldLayer({ state }: { readonly state: LivingWorldState }) {
  const reduceMotion = useReducedMotion();
  const night = state.theme === 'night';
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden>
      {night ? <View style={[StyleSheet.absoluteFill, styles.nightWash]} /> : null}
      {state.seasons.includes('winter') ? <Snow /> : null}
      {state.seasons.includes('lantern-festival') ? <Lanterns /> : null}
      {state.weather === 'rain' && !reduceMotion ? <Rain /> : null}
      {night && !reduceMotion ? <LighthouseBeam /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  nightWash: { backgroundColor: CITY_PALETTES.night.paper, opacity: 0.32 },
  beam: { position: 'absolute', left: 458, top: 760, width: 230, height: 80, transformOrigin: '0px 40px' },
});

