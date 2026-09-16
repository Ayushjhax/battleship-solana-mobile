/**
 * Settings: sound / music / haptics toggles, name and avatar, reset tutorial,
 * the maker's card and the build version.
 */
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useProfile, type ProfileSetting, type ProfileVolume } from '@/state/profile';
import { InkButton } from '@/ui/InkButton';
import { InkIconButton } from '@/ui/InkIconButton';
import { InkPanel } from '@/ui/InkPanel';
import { Paper } from '@/ui/Paper';
import { Scale } from '@/ui/Scale';
import { TitleRibbon } from '@/ui/TitleRibbon';
import { CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';

function Toggle({ label, setting }: { label: string; setting: ProfileSetting }) {
  const on = useProfile((s) => s[setting]);
  const setSetting = useProfile((s) => s.setSetting);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <InkButton
        label={on ? 'On' : 'Off'}
        tone={on ? 'confirm' : 'ink'}
        w={84}
        h={34}
        size="sm"
        seedKey={`toggle-${setting}`}
        onPress={() => setSetting(setting, !on)}
      />
    </View>
  );
}

function VolumeControl({
  label,
  setting,
  enabled,
}: {
  label: string;
  setting: ProfileVolume;
  enabled: boolean;
}) {
  const value = useProfile((s) => s[setting]);
  const setVolume = useProfile((s) => s.setVolume);
  const step = 0.1;
  const set = (next: number) => setVolume(setting, Math.round(next * 10) / 10);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.volumeButtons}>
        <InkButton
          label="−"
          w={34}
          h={34}
          size="sm"
          disabled={!enabled || value <= 0}
          accessibilityLabel={`Lower ${label.toLowerCase()}`}
          onPress={() => set(value - step)}
        />
        <Text style={styles.volumeValue}>{Math.round(value * 100)}%</Text>
        <InkButton
          label="+"
          w={34}
          h={34}
          size="sm"
          disabled={!enabled || value >= 1}
          accessibilityLabel={`Raise ${label.toLowerCase()}`}
          onPress={() => set(value + step)}
        />
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const hasCompletedTutorial = useProfile((s) => s.hasCompletedTutorial);
  const resetTutorial = useProfile((s) => s.resetTutorial);
  const soundOn = useProfile((s) => s.soundOn);
  const musicOn = useProfile((s) => s.musicOn);
  const version = Constants.expoConfig?.version ?? '0.0.0';

  return (
    <Scale>
      <Paper variant="full" />
      <View style={styles.back}>
        <InkIconButton
          icon="back"
          accessibilityLabel="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/menu'))}
        />
      </View>
      <View style={styles.ribbon}>
        <TitleRibbon title="Settings" w={280} h={40} size="md" />
      </View>

      <View style={styles.left}>
        <InkPanel w={320} h={268} seedKey="settings-toggles" padding={space.sm}>
          <Toggle label="Sound effects" setting="soundOn" />
          <VolumeControl label="SFX volume" setting="soundVolume" enabled={soundOn} />
          <Toggle label="Music" setting="musicOn" />
          <VolumeControl label="Music volume" setting="musicVolume" enabled={musicOn} />
          <Toggle label="Haptics" setting="hapticsOn" />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Tutorial</Text>
            <InkButton
              label={hasCompletedTutorial ? 'Reset' : 'Play'}
              w={84}
              h={34}
              size="sm"
              seedKey="reset-tutorial"
              onPress={() => {
                if (hasCompletedTutorial) resetTutorial();
                else router.push('/tutorial');
              }}
            />
          </View>
        </InkPanel>
      </View>

      <View style={styles.right}>
        <View style={styles.actions}>
          <InkButton
            label="Change name"
            w={150}
            h={34}
            size="sm"
            seedKey="change-name"
            onPress={() => router.push({ pathname: '/name', params: { next: 'back' } })}
          />
          <InkButton
            label="Change avatar"
            w={150}
            h={34}
            size="sm"
            seedKey="change-avatar"
            onPress={() => router.push('/avatar')}
          />
        </View>
        <InkPanel w={340} h={132} seedKey="settings-credits" padding={space.xs} fill="none">
          <View style={styles.creditsBody}>
            <Text style={styles.creditsTitle}>Ocean Warfare</Text>
            <Text style={styles.credit}>An Empire of Bits game</Text>
            <Text style={styles.credit}>On Indies on Solana Season 2</Text>
          </View>
        </InkPanel>
      </View>

      <Text style={styles.version}>Empire of Bits: Ocean Warfare v{version}</Text>
    </Scale>
  );
}

const styles = StyleSheet.create({
  back: { position: 'absolute', left: 12, top: 8 },
  ribbon: { position: 'absolute', left: (CANVAS_W - 280) / 2, top: 8 },
  left: { position: 'absolute', left: 64, top: 70 },
  right: { position: 'absolute', left: 416, top: 70, gap: 10 },
  actions: { flexDirection: 'row', gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 38 },
  rowLabel: { color: color.ink, fontFamily: font.label, fontSize: typeScale.sm },
  volumeButtons: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  volumeValue: {
    width: 42,
    color: color.inkSoft,
    fontFamily: font.label,
    fontSize: typeScale.xs,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  creditsBody: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  creditsTitle: {
    color: color.ink,
    fontFamily: font.display,
    fontSize: typeScale.lg,
  },
  credit: { color: color.inkSoft, fontFamily: font.label, fontSize: typeScale.sm },
  version: {
    position: 'absolute',
    right: space.md,
    bottom: space.sm,
    color: color.inkSoft,
    fontFamily: font.body,
    fontSize: typeScale.xxs,
  },
});
