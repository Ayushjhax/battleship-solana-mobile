/**
 * The welcome reward, drawn to its mockup on BACKGROUNDS.welcome: the logo, and
 * the complete reward panel (WELCOME_ART.panel, its text and Claim button baked
 * in) with gulls over the page. The panel's baked button is the touch target;
 * pressing it lays the separately exported button over it as a tinted
 * silhouette, which darkens exactly the button's own shape.
 */
import { Image } from 'expo-image';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { haptic } from '@/audio/haptics';
import { usePoints } from '@/state/points';
import { BACKGROUNDS, BRAND, WELCOME_ART } from '@/ui/assets';
import { Scale } from '@/ui/Scale';
import { artColor } from '@/ui/tokens';

/** reward-panel-complete.png is 1064 x 584; everything below is in its pixels. */
const PANEL_PX = { w: 1064, h: 584 } as const;
const CLAIM_PX = { x: 287, y: 432, w: 486, h: 118 } as const;
const PANEL_W = 400;
const K = PANEL_W / PANEL_PX.w;
const PANEL = { x: 200, y: 88, w: PANEL_W, h: PANEL_PX.h * K } as const;

const GULLS = [
  { x: 206, y: 23, w: 23, h: 9 },
  { x: 222, y: 46, w: 25, h: 10 },
  { x: 554, y: 42, w: 26, h: 11 },
  { x: 580, y: 19, w: 16, h: 7 },
] as const;

export function WelcomePointsModal() {
  const visible = usePoints((state) => state.welcomePending);
  const [pressed, setPressed] = useState(false);
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.fill} accessibilityViewIsModal>
        <Scale backgroundImage={BACKGROUNDS.welcome}>
          {GULLS.map((g, i) => (
            <Image
              key={i}
              source={WELCOME_ART.seagulls[i]}
              style={[styles.abs, { left: g.x, top: g.y, width: g.w, height: g.h }]}
              contentFit="contain"
              pointerEvents="none"
            />
          ))}
          <Image source={BRAND.wordmark} style={styles.logo} contentFit="contain" pointerEvents="none" />

          <View style={styles.panel}>
            <Image
              source={WELCOME_ART.panel}
              style={StyleSheet.absoluteFill}
              contentFit="fill"
              accessible
              accessibilityRole="image"
              accessibilityLabel="Welcome aboard, Captain. 100 points awarded! Use points for optional 50-point wager matches, or exchange them for SOL in the Points desk."
            />
            <Pressable
              style={styles.claim}
              onPress={() => usePoints.getState().dismissWelcome()}
              onPressIn={() => {
                setPressed(true);
                haptic('buttonPress');
              }}
              onPressOut={() => setPressed(false)}
              accessibilityRole="button"
              accessibilityLabel="Claim reward"
            >
              {pressed ? (
                <Image
                  source={WELCOME_ART.claimButton}
                  style={[StyleSheet.absoluteFill, styles.pressShade]}
                  contentFit="fill"
                  tintColor={artColor.ink}
                />
              ) : null}
            </Pressable>
          </View>
        </Scale>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  abs: { position: 'absolute' },
  logo: { position: 'absolute', left: 289, top: 0, width: 222, height: 88 },
  panel: { position: 'absolute', left: PANEL.x, top: PANEL.y, width: PANEL.w, height: PANEL.h },
  claim: {
    position: 'absolute',
    left: CLAIM_PX.x * K,
    top: CLAIM_PX.y * K,
    width: CLAIM_PX.w * K,
    height: CLAIM_PX.h * K,
  },
  pressShade: { opacity: 0.18 },
});
