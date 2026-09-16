/**
 * Small square icon buttons drawn with the pen: settings gear, sound toggle.
 * Same press feel as InkButton — seed + 1 while pressed, light haptic.
 */
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, type ViewStyle } from 'react-native';
import Svg from 'react-native-svg';

import { haptic } from '@/audio/haptics';
import { useScale } from './Scale';
import { color } from './tokens';
import { RoughShape, hashString, useRough, type PathInfo, type Point } from './useRough';

export type InkIcon =
  | 'settings'
  | 'sound-on'
  | 'sound-off'
  | 'home'
  | 'chat'
  | 'close'
  | 'back'
  | 'profile'
  | 'wallet';

export interface InkIconButtonProps {
  icon: InkIcon;
  onPress?: () => void;
  size?: number;
  accessibilityLabel: string;
  style?: ViewStyle;
}

const MIN_REAL_PX = 44;

export function InkIconButton({
  icon,
  onPress,
  size = 40,
  accessibilityLabel,
  style,
}: InkIconButtonProps) {
  const { scale } = useScale();
  const { roughCircle, roughLine, roughPolygon, roughPath, roughRect } = useRough();
  const [pressed, setPressed] = useState(false);

  const s = Math.max(size, Math.ceil(MIN_REAL_PX / scale));
  const c = s / 2;
  const seed = hashString(`icon-${icon}`) + (pressed ? 1 : 0);
  const stroke = { stroke: color.ink, strokeWidth: 1.5 } as const;

  const layers: (readonly PathInfo[])[] = [];
  if (icon === 'close') {
    // The red X in a small box — the modal's corner button.
    layers.push(
      roughRect(c - s * 0.3, c - s * 0.3, s * 0.6, s * 0.6, {
        seed,
        stroke: color.inkRed,
        strokeWidth: 1.4,
      }),
    );
    layers.push(
      roughLine(c - s * 0.17, c - s * 0.17, c + s * 0.17, c + s * 0.17, {
        seed: seed + 1,
        stroke: color.inkRed,
        strokeWidth: 2.2,
      }),
    );
    layers.push(
      roughLine(c + s * 0.17, c - s * 0.17, c - s * 0.17, c + s * 0.17, {
        seed: seed + 2,
        stroke: color.inkRed,
        strokeWidth: 2.2,
      }),
    );
  } else if (icon === 'back') {
    // A curling return arrow, like the placement screen's corner button.
    const pts: Point[] = [];
    for (let k = 0; k <= 8; k++) {
      const a = -Math.PI * 0.9 + (Math.PI * 1.3 * k) / 8;
      pts.push([c + s * 0.05 + Math.cos(a) * s * 0.22, c + Math.sin(a) * s * 0.22]);
    }
    layers.push(roughPath(pts, { seed, stroke: color.ink, strokeWidth: 2 }));
    const tip = pts[0] as Point;
    layers.push(
      roughPolygon(
        [
          [tip[0] - s * 0.1, tip[1] - s * 0.02],
          [tip[0] + s * 0.06, tip[1] - s * 0.12],
          [tip[0] + s * 0.06, tip[1] + s * 0.1],
        ],
        {
          seed: seed + 1,
          stroke: color.ink,
          strokeWidth: 1.2,
          fill: color.ink,
          fillStyle: 'solid',
        },
      ),
    );
  } else if (icon === 'home') {
    // A house: roof, walls, door — the way the reference draws it in red.
    const red = { stroke: color.inkRed, strokeWidth: 1.6 } as const;
    layers.push(
      roughPolygon(
        [
          [c - s * 0.32, c + s * 0.02],
          [c, c - s * 0.3],
          [c + s * 0.32, c + s * 0.02],
        ],
        { seed, ...red, fill: color.inkRed, fillStyle: 'hachure', hachureGap: 2.6, fillWeight: 1 },
      ),
    );
    layers.push(
      roughPolygon(
        [
          [c - s * 0.24, c + s * 0.02],
          [c + s * 0.24, c + s * 0.02],
          [c + s * 0.24, c + s * 0.3],
          [c - s * 0.24, c + s * 0.3],
        ],
        { seed: seed + 1, ...red },
      ),
    );
    layers.push(
      roughPolygon(
        [
          [c - s * 0.06, c + s * 0.3],
          [c - s * 0.06, c + s * 0.14],
          [c + s * 0.06, c + s * 0.14],
          [c + s * 0.06, c + s * 0.3],
        ],
        {
          seed: seed + 2,
          stroke: color.inkRed,
          strokeWidth: 1.2,
          fill: color.inkRed,
          fillStyle: 'solid',
        },
      ),
    );
  } else if (icon === 'chat') {
    // Two overlapping speech bubbles, the back one in red like IMG_9770.
    const bubble = (cx: number, cy: number, w: number, hgt: number): Point[] => [
      [cx - w / 2, cy - hgt / 2],
      [cx + w / 2, cy - hgt / 2],
      [cx + w / 2, cy + hgt / 2],
      [cx - w / 2 + w * 0.4, cy + hgt / 2],
      [cx - w / 2 + w * 0.22, cy + hgt / 2 + hgt * 0.45],
      [cx - w / 2 + w * 0.2, cy + hgt / 2],
      [cx - w / 2, cy + hgt / 2],
    ];
    layers.push(
      roughPolygon(bubble(c + s * 0.1, c - s * 0.06, s * 0.5, s * 0.34), {
        seed,
        stroke: color.inkRed,
        strokeWidth: 1.4,
      }),
    );
    layers.push(
      roughPolygon(bubble(c - s * 0.08, c + s * 0.04, s * 0.5, s * 0.34), {
        seed: seed + 1,
        stroke: color.ink,
        strokeWidth: 1.5,
        fill: color.paper,
        fillStyle: 'solid',
      }),
    );
    for (let k = 0; k < 3; k++) {
      layers.push(
        roughCircle(c - s * 0.2 + k * s * 0.12, c + s * 0.04, 2.2, {
          seed: seed + 2 + k,
          stroke: color.ink,
          strokeWidth: 1,
          fill: color.ink,
          fillStyle: 'solid',
        }),
      );
    }
  } else if (icon === 'profile') {
    layers.push(
      roughCircle(c, c - s * 0.16, s * 0.22, {
        seed,
        stroke: color.ink,
        strokeWidth: 1.6,
        fill: color.inkFaint,
        fillStyle: 'hachure',
        hachureGap: 2.4,
      }),
    );
    layers.push(
      roughPath(
        [
          [c - s * 0.3, c + s * 0.3],
          [c - s * 0.25, c + s * 0.1],
          [c, c + s * 0.02],
          [c + s * 0.25, c + s * 0.1],
          [c + s * 0.3, c + s * 0.3],
        ],
        { seed: seed + 1, stroke: color.ink, strokeWidth: 1.8 },
      ),
    );
  } else if (icon === 'wallet') {
    layers.push(
      roughRect(c - s * 0.3, c - s * 0.22, s * 0.6, s * 0.46, {
        seed,
        stroke: color.ink,
        strokeWidth: 1.6,
        fill: color.inkFaint,
        fillStyle: 'hachure',
        hachureGap: 2.8,
      }),
    );
    layers.push(
      roughRect(c + s * 0.05, c - s * 0.08, s * 0.3, s * 0.2, {
        seed: seed + 1,
        stroke: color.inkRed,
        strokeWidth: 1.4,
        fill: color.paper,
        fillStyle: 'solid',
      }),
    );
    layers.push(
      roughCircle(c + s * 0.2, c + s * 0.02, 2.4, {
        seed: seed + 2,
        stroke: color.inkRed,
        fill: color.inkRed,
        fillStyle: 'solid',
      }),
    );
  } else if (icon === 'settings') {
    const r = s * 0.24;
    layers.push(roughCircle(c, c, r * 2, { seed, ...stroke }));
    layers.push(roughCircle(c, c, r * 0.8, { seed: seed + 1, ...stroke, strokeWidth: 1.2 }));
    for (let k = 0; k < 8; k++) {
      const a = (Math.PI * 2 * k) / 8;
      layers.push(
        roughLine(
          c + Math.cos(a) * r * 1.05,
          c + Math.sin(a) * r * 1.05,
          c + Math.cos(a) * r * 1.5,
          c + Math.sin(a) * r * 1.5,
          { seed: seed + 2 + k, ...stroke, strokeWidth: 2 },
        ),
      );
    }
  } else {
    // Speaker body: a small box with a flared cone.
    const body: Point[] = [
      [c - s * 0.3, c - s * 0.1],
      [c - s * 0.16, c - s * 0.1],
      [c + s * 0.02, c - s * 0.24],
      [c + s * 0.02, c + s * 0.24],
      [c - s * 0.16, c + s * 0.1],
      [c - s * 0.3, c + s * 0.1],
    ];
    layers.push(
      roughPolygon(body, {
        seed,
        ...stroke,
        fill: color.ink,
        fillStyle: 'hachure',
        hachureGap: 2.4,
        fillWeight: 1,
      }),
    );
    if (icon === 'sound-on') {
      const arc = (radius: number): Point[] => {
        const pts: Point[] = [];
        for (let k = 0; k <= 6; k++) {
          const a = -Math.PI * 0.3 + (Math.PI * 0.6 * k) / 6;
          pts.push([c + s * 0.08 + Math.cos(a) * radius, c + Math.sin(a) * radius]);
        }
        return pts;
      };
      layers.push(roughPath(arc(s * 0.14), { seed: seed + 1, ...stroke }));
      layers.push(roughPath(arc(s * 0.26), { seed: seed + 2, ...stroke }));
    } else {
      layers.push(
        roughLine(c + s * 0.12, c - s * 0.12, c + s * 0.32, c + s * 0.12, {
          seed: seed + 1,
          stroke: color.inkRed,
          strokeWidth: 1.8,
        }),
      );
      layers.push(
        roughLine(c + s * 0.32, c - s * 0.12, c + s * 0.12, c + s * 0.12, {
          seed: seed + 2,
          stroke: color.inkRed,
          strokeWidth: 1.8,
        }),
      );
    }
  }

  const onPressIn = useCallback(() => {
    setPressed(true);
    haptic('buttonPress');
  }, []);
  const onPressOut = useCallback(() => setPressed(false), []);

  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[{ width: s, height: s }, style]}
    >
      <Svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} style={StyleSheet.absoluteFill}>
        {layers.map((paths, i) => (
          <RoughShape key={i} paths={paths} />
        ))}
      </Svg>
    </Pressable>
  );
}
