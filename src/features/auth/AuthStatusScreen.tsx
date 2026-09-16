import { StyleSheet, Text, View } from 'react-native';

import { InkPanel } from '@/ui/InkPanel';
import { InkSpinner } from '@/ui/InkSpinner';
import { LogoMark } from '@/ui/LogoMark';
import { Paper } from '@/ui/Paper';
import { Scale } from '@/ui/Scale';
import { color, font, space, type as typeScale } from '@/ui/tokens';

export function AuthLoadingScreen({ label = 'Checking your logbook…' }: { label?: string }) {
  return (
    <Scale>
      <Paper variant="full" />
      <View style={styles.logo}>
        <LogoMark w={280} h={56} subtitle="Ocean Warfare" />
      </View>
      <View style={styles.panel}>
        <InkPanel w={330} h={120} seedKey="auth-loading">
          <View style={styles.loadingRow}>
            <InkSpinner size={28} seedKey="auth-loading" />
            <Text style={styles.message}>{label}</Text>
          </View>
        </InkPanel>
      </View>
    </Scale>
  );
}

export function AuthErrorScreen({ title, message }: { title: string; message: string }) {
  return (
    <Scale>
      <Paper variant="full" />
      <View style={styles.logo}>
        <LogoMark w={280} h={56} subtitle="Ocean Warfare" />
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
  logo: { position: 'absolute', left: 260, top: 10 },
  panel: { position: 'absolute', left: 235, top: 125 },
  errorPanel: { position: 'absolute', left: 160, top: 105 },
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
