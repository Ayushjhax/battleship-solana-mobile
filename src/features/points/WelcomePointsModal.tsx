import { Modal, StyleSheet, Text, View } from 'react-native';

import { usePoints } from '@/state/points';
import { InkButton } from '@/ui/InkButton';
import { InkPanel } from '@/ui/InkPanel';
import { Scale } from '@/ui/Scale';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';

export function WelcomePointsModal() {
  const visible = usePoints((state) => state.welcomePending);
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.dim} accessibilityViewIsModal>
        <Scale>
          <View style={styles.card}>
            <InkPanel w={390} h={210} seedKey="welcome-points" padding={space.lg}>
              <Text style={styles.kicker}>WELCOME ABOARD, CAPTAIN</Text>
              <Text style={styles.title}>100 points awarded!</Text>
              <Text style={styles.body}>
                Use points for optional 50-point wager matches, or exchange them for SOL in the Points desk.
              </Text>
              <InkButton
                label="Claim reward"
                tone="confirm"
                w={180}
                h={42}
                size="sm"
                style={styles.button}
                onPress={() => usePoints.getState().dismissWelcome()}
              />
            </InkPanel>
          </View>
        </Scale>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dim: { flex: 1, backgroundColor: 'rgba(28,20,15,0.44)' },
  card: {
    position: 'absolute',
    left: (CANVAS_W - 390) / 2,
    top: (CANVAS_H - 210) / 2,
  },
  kicker: {
    color: color.inkGreen,
    fontFamily: font.label,
    fontSize: typeScale.xs,
    textAlign: 'center',
    letterSpacing: 1.1,
  },
  title: {
    color: color.ink,
    fontFamily: font.display,
    fontSize: typeScale.xl,
    textAlign: 'center',
    marginTop: space.xs,
  },
  body: {
    color: color.inkSoft,
    fontFamily: font.body,
    fontSize: typeScale.sm,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: space.sm,
  },
  button: { alignSelf: 'center', marginTop: space.md },
});
