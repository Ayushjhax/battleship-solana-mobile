/**
 * The tutorial: the REAL battle screen (steps 1-10) and the REAL placement
 * screen (steps 11-14) with the TutorialOverlay driving them from
 * src/tutorial/script.ts. Nothing here is a parallel fake game — tweak a P07
 * animation and it shows up in the tutorial with no extra work.
 */
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useBattle } from '@/state/battle';
import { useProfile } from '@/state/profile';
import { useTutorialDriver } from '@/tutorial/driver';
import { buildTutorialSetup, STEPS } from '@/tutorial/script';
import { useTutorial } from '@/tutorial/store';
import { TutorialOverlay } from '@/tutorial/TutorialOverlay';
import { BattleScreen } from './(game)/battle';
import PlacementScreen from './(game)/placement';

export default function TutorialRoute() {
  const router = useRouter();
  const stepIndex = useTutorial((s) => s.stepIndex);
  const screen = (STEPS[stepIndex] ?? STEPS[STEPS.length - 1])?.screen ?? 'battle';

  const setup = useMemo(() => {
    const p = useProfile.getState();
    return buildTutorialSetup({
      name: p.name,
      avatarId: p.avatarId,
      avatarColor: p.avatarColor,
      countryCode: p.countryCode,
    });
  }, []);

  useEffect(() => {
    useTutorial.getState().start();
    return () => {
      useTutorial.getState().reset();
      useBattle.getState().reset();
    };
  }, []);

  const finish = useCallback(() => {
    useProfile.getState().markTutorialComplete();
    useTutorial.getState().finish();
    router.replace('/menu');
  }, [router]);

  useTutorialDriver(finish);

  // Both are <Scale> roots (flex: 1); as siblings they would split the height.
  return (
    <View style={styles.root}>
      {screen === 'battle' ? <BattleScreen setup={setup} tutorial /> : <PlacementScreen />}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <TutorialOverlay onSkip={finish} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
