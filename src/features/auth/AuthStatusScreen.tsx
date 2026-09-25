/**
 * The screens before the boot: Privy restoring a session, or failing to. Both
 * are transparent over the first page the root layout paints once under
 * everything, so the launch reads as one page — the loading screen carries no
 * logo, because the boot pops it in next.
 */
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { BRAND, PAPER_PANEL } from '@/ui/assets';
import { ImagePanel } from '@/ui/ImagePanel';
import { InkPanel } from '@/ui/InkPanel';
import { InkSpinner } from '@/ui/InkSpinner';
import { Scale } from '@/ui/Scale';
import { CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';

const LOGO = { w: 220, h: 88 } as const;
// Matches paper-panel.png's own 728 x 260 aspect — see BackendWakeGate, which
// wears the same skin for the sync/wake overlay that follows this screen.
const LOADING_PANEL_H = 120;
const LOADING_PANEL_W = Math.round((LOADING_PANEL_H * 728) / 260);

export function AuthLoadingScreen({ label = 'Checking your logbook…' }: { label?: string }) {
  return (
    <Scale transparent>
      <View style={styles.panel}>
        <ImagePanel source={PAPER_PANEL} w={LOADING_PANEL_W} h={LOADING_PANEL_H}>
          <View style={styles.loadingRow}>
            <InkSpinner size={28} seedKey="auth-loading" />
            <Text style={styles.message}>{label}</Text>
          </View>
        </ImagePanel>
      </View>
    </Scale>
  );
}

export function AuthErrorScreen({ title, message }: { title: string; message: string }) {
  return (
    <Scale transparent>
      <View style={styles.logo} pointerEvents="none">
        <Image source={BRAND.wordmark} style={StyleSheet.absoluteFill} contentFit="contain" />
      </View>
      <View style={styles.errorPanel}>
        <InkPanel w={480} h={170} seedKey={`auth-error-${title}`}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
        </InkPanel>
      </View>
    </Scale>
  );
}

const styles = StyleSheet.create({
  logo: {
    position: 'absolute',
    left: (CANVAS_W - LOGO.w) / 2,
    top: 8,
    width: LOGO.w,
    height: LOGO.h,
  },
  panel: { position: 'absolute', left: (CANVAS_W - LOADING_PANEL_W) / 2, top: 120 },
  errorPanel: { position: 'absolute', left: (CANVAS_W - 480) / 2, top: 105 },
  loadingRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  title: {
    color: color.inkRed,
    fontFamily: font.display,
    fontSize: typeScale.lg,
    marginBottom: space.sm,
    textAlign: 'center',
  },
  message: {
    color: color.ink,
    fontFamily: font.body,
    fontSize: typeScale.sm,
    lineHeight: 22,
    textAlign: 'center',
  },
});
