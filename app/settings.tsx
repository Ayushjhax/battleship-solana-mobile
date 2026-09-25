/**
 * Settings — drawn to its mockup on BACKGROUNDS.settings: the rope-crowned
 * panel of switches and volumes on the left, name and avatar and the game's
 * card on the right. Sound, music and haptics each toggle (ArtToggle); the two
 * volumes step by 10%, disabled while their channel is off. The tutorial row
 * appears once there is a tutorial to put back.
 */
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View, type ImageStyle } from 'react-native';

import { ArtButton } from '@/features/auth/LoginArt';
import { useProfile, type ProfileSetting, type ProfileVolume } from '@/state/profile';
import { ArtImageButton } from '@/ui/ArtImageButton';
import { ArtToggle } from '@/ui/ArtToggle';
import { BACKGROUNDS, MENU_ART, SETTINGS_ART, type Asset } from '@/ui/assets';
import { Scale } from '@/ui/Scale';
import { VSlicedImage } from '@/ui/SlicedImage';
import { CANVAS_W, artColor, font } from '@/ui/tokens';

const PANEL = { x: 22, y: 66, w: 390, h: 274 } as const;
const INSET = { x: 20, top: 20, bottom: 14 } as const;
const ROW_W = PANEL.w - INSET.x * 2;
const ICON_BOX = 38;
const RIGHT = { x: 432, w: 346 } as const;
const ABOUT = { y: 128, h: 178 } as const;

function Art({ source, style }: { source: Asset; style: ImageStyle }) {
  return (
    <Image
      source={source}
      style={[{ position: 'absolute' }, style]}
      contentFit="contain"
      cachePolicy="memory-disk"
      pointerEvents="none"
    />
  );
}

function RowIcon({ source, w, h }: { source: Asset; w: number; h: number }) {
  return (
    <View style={styles.iconBox}>
      <Image source={source} style={{ width: w, height: h }} contentFit="contain" />
    </View>
  );
}

function ToggleRow({ icon, label, setting }: { icon: Asset; label: string; setting: ProfileSetting }) {
  const on = useProfile((s) => s[setting]);
  const setSetting = useProfile((s) => s.setSetting);
  return (
    <>
      <View style={styles.rowStart}>
        <RowIcon source={icon} w={30} h={26} />
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      <View style={styles.toggleSlot}>
        <ArtToggle on={on} label={label} onChange={(next) => setSetting(setting, next)} />
      </View>
    </>
  );
}

function VolumeRow({
  icon,
  label,
  setting,
  enabled,
}: {
  icon: Asset;
  label: string;
  setting: ProfileVolume;
  enabled: boolean;
}) {
  const value = useProfile((s) => s[setting]);
  const setVolume = useProfile((s) => s.setVolume);
  const set = (next: number) => setVolume(setting, Math.round(next * 10) / 10);
  return (
    <>
      <View style={styles.rowStart}>
        <RowIcon source={icon} w={27} h={25} />
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      <View style={[styles.stepper, { opacity: enabled ? 1 : 0.55 }]}>
        <ArtImageButton
          source={SETTINGS_ART.minus}
          w={31}
          h={29}
          label={`Lower ${label.toLowerCase()}`}
          disabled={!enabled || value <= 0}
          hitSlop={4}
          onPress={() => set(value - 0.1)}
        />
        <Text style={styles.volumeValue}>{Math.round(value * 100)}%</Text>
        <ArtImageButton
          source={SETTINGS_ART.plus}
          w={32}
          h={29}
          label={`Raise ${label.toLowerCase()}`}
          disabled={!enabled || value >= 1}
          hitSlop={4}
          onPress={() => set(value + 0.1)}
        />
      </View>
    </>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const hasCompletedTutorial = useProfile((s) => s.hasCompletedTutorial);
  const resetTutorial = useProfile((s) => s.resetTutorial);
  const soundOn = useProfile((s) => s.soundOn);
  const musicOn = useProfile((s) => s.musicOn);
  const version = Constants.expoConfig?.version ?? '0.0.0';

  const rows = [
    <ToggleRow key="sound" icon={SETTINGS_ART.soundIcon} label="Sound effects" setting="soundOn" />,
    <VolumeRow key="sfx" icon={SETTINGS_ART.sfxVolumeIcon} label="SFX volume" setting="soundVolume" enabled={soundOn} />,
    <ToggleRow key="music" icon={SETTINGS_ART.musicIcon} label="Music" setting="musicOn" />,
    <VolumeRow
      key="music-volume"
      icon={SETTINGS_ART.musicVolumeIcon}
      label="Music volume"
      setting="musicVolume"
      enabled={musicOn}
    />,
    <ToggleRow key="haptics" icon={SETTINGS_ART.hapticsIcon} label="Haptics" setting="hapticsOn" />,
  ];
  // Playing the tutorial lives on the menu as "How to play"; what only
  // Settings can do is put it back, so that is all it offers — and only once
  // there is something to put back.
  if (hasCompletedTutorial) {
    rows.push(
      <View key="tutorial" style={styles.rowStart}>
        <RowIcon source={MENU_ART.rulebook} w={27} h={24} />
        <Text style={styles.rowLabel}>Tutorial</Text>
      </View>,
    );
  }
  const rowH = (PANEL.h - INSET.top - INSET.bottom) / rows.length;

  return (
    <Scale backgroundImage={BACKGROUNDS.settings}>
      <Art source={SETTINGS_ART.quote} style={styles.quote} />

      <ArtImageButton
        source={SETTINGS_ART.back}
        w={72}
        h={44}
        label="Back"
        style={styles.back}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/menu'))}
      />
      <Art source={SETTINGS_ART.emphasisLeft} style={styles.emphasisLeft} />
      <Art source={SETTINGS_ART.banner} style={styles.banner} />
      <Art source={SETTINGS_ART.emphasisRight} style={styles.emphasisRight} />

      <VSlicedImage
        slices={SETTINGS_ART.panel}
        w={PANEL.w}
        h={PANEL.h}
        style={{ position: 'absolute', left: PANEL.x, top: PANEL.y }}
      />
      <Art source={SETTINGS_ART.ropeDivider} style={styles.rope} />
      {rows.map((row, i) => (
        <View
          key={i}
          style={[
            styles.row,
            { top: PANEL.y + INSET.top + i * rowH, height: rowH },
          ]}
        >
          {row}
          {i === rows.length - 1 && hasCompletedTutorial ? (
            <ArtButton
              slices={SETTINGS_ART.creamButton}
              w={88}
              h={28}
              label="Reset"
              fontSize={14}
              onPress={resetTutorial}
            />
          ) : null}
          {i < rows.length - 1 ? (
            <Image source={SETTINGS_ART.dashedDivider} style={styles.divider} contentFit="fill" />
          ) : null}
        </View>
      ))}

      <View style={styles.identityRow}>
        <ArtImageButton
          source={SETTINGS_ART.changeName}
          w={165}
          h={50}
          label="Change name"
          onPress={() => router.push({ pathname: '/name', params: { next: 'back' } })}
        />
        <ArtImageButton
          source={SETTINGS_ART.changeAvatar}
          w={158}
          h={50}
          label="Change avatar"
          onPress={() => router.push('/avatar')}
        />
      </View>
      <VSlicedImage
        slices={SETTINGS_ART.panel}
        w={RIGHT.w}
        h={ABOUT.h}
        style={{ position: 'absolute', left: RIGHT.x, top: ABOUT.y }}
      />
      <Image
        source={SETTINGS_ART.logo}
        style={styles.logo}
        contentFit="contain"
        accessibilityLabel="Ocean Warfare. An Empire of Bits game. On Indies on Solana Season 2."
      />

      <Text style={styles.version}>Empire of Bits: Ocean Warfare v{version}</Text>
      <Art source={SETTINGS_ART.waveDivider} style={styles.wave} />
    </Scale>
  );
}

const LOGO_H = 126;

const styles = StyleSheet.create({
  back: { position: 'absolute', left: 8, top: 8 },
  banner: { left: (CANVAS_W - 272) / 2, top: 2, width: 272, height: 58 },
  emphasisLeft: { left: (CANVAS_W - 272) / 2 - 26, top: 8, width: 30, height: 21 },
  emphasisRight: { left: (CANVAS_W + 272) / 2 - 4, top: 16, width: 32, height: 15 },
  rope: {
    left: PANEL.x + (PANEL.w - 196) / 2,
    top: PANEL.y - 12,
    width: 196,
    height: 196 * (113 / 567),
  },
  row: {
    position: 'absolute',
    left: PANEL.x + INSET.x,
    width: ROW_W,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowStart: { flexDirection: 'row', alignItems: 'center' },
  iconBox: { width: ICON_BOX, alignItems: 'center', justifyContent: 'center' },
  rowLabel: {
    marginLeft: 8,
    color: artColor.navy,
    fontFamily: font.display,
    fontSize: 17,
  },
  toggleSlot: { marginRight: 14 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 4 },
  volumeValue: {
    width: 46,
    color: artColor.navy,
    fontFamily: font.display,
    fontSize: 15,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  divider: { position: 'absolute', left: 0, right: 0, bottom: -1, height: 4, opacity: 0.8 },
  identityRow: {
    position: 'absolute',
    left: RIGHT.x,
    width: RIGHT.w,
    top: 68,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  logo: {
    position: 'absolute',
    left: RIGHT.x + (RIGHT.w - LOGO_H * (486 / 294)) / 2,
    top: ABOUT.y + (ABOUT.h - LOGO_H) / 2,
    width: LOGO_H * (486 / 294),
    height: LOGO_H,
  },
  version: {
    position: 'absolute',
    left: RIGHT.x,
    width: RIGHT.w,
    top: 318,
    color: artColor.navy,
    fontFamily: font.body,
    fontSize: 11,
    textAlign: 'center',
  },
  wave: { left: RIGHT.x + (RIGHT.w - 170) / 2, top: 332, width: 170, height: 10 },
  quote: { left: 706, top: 4, width: 80, height: 51 },
});
