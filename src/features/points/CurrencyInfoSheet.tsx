/**
 * The currency explanation sheet — one root-level modal for all three
 * balances.
 *
 * It is informational only: opening or closing it never touches a balance and
 * never starts a purchase. The copy comes from src/data/currencies.ts, the
 * single source every chip reads, so no two screens can describe a currency
 * differently.
 *
 * Mounted next to WelcomePointsModal in app/_layout.tsx (a Modal sibling of
 * the Stack) rather than inside a chip, so it can never be clipped by the
 * chip's own layout or fall under a later sibling.
 */
import { CURRENCIES } from '@/data/currencies';
import { useCurrencyInfo } from '@/state/currencyInfo';
import { InkButton } from '@/ui/InkButton';
import { InkPanel } from '@/ui/InkPanel';
import { Scale } from '@/ui/Scale';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

const PANEL_W = 470;
const PANEL_H = 256;

function Bullets({ title, lines }: { title: string; lines: readonly string[] }) {
  return (
    <View style={styles.column}>
      <Text style={styles.columnTitle}>{title}</Text>
      {lines.map((line) => (
        <Text key={line} style={styles.bullet}>
          • {line}
        </Text>
      ))}
    </View>
  );
}

export function CurrencyInfoSheet() {
  const open = useCurrencyInfo((state) => state.open);
  const close = useCurrencyInfo((state) => state.closeCurrency);
  const info = open ? CURRENCIES[open] : null;

  return (
    <Modal
      visible={info !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={close}
    >
      <View style={styles.dim} accessibilityViewIsModal>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Close currency explanation"
          onPress={close}
        />
        <Scale transparent>
          {info ? (
            <View style={styles.card}>
              <InkPanel w={PANEL_W} h={PANEL_H} seedKey={`currency-info-${info.id}`} padding={space.md}>
                <Text style={styles.kicker}>CURRENCY</Text>
                <Text style={styles.name}>{info.name}</Text>
                <Text style={styles.what}>{info.what}</Text>
                <View style={styles.columns}>
                  <Bullets title="EARNED BY" lines={info.earned} />
                  <Bullets title="USED FOR" lines={info.used} />
                </View>
                <View style={styles.closeRow}>
                  <InkButton
                    label="Close"
                    tone="confirm"
                    size="sm"
                    w={128}
                    h={34}
                    seedKey="currency-info-close"
                    onPress={close}
                  />
                </View>
              </InkPanel>
            </View>
          ) : null}
        </Scale>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dim: { flex: 1, backgroundColor: 'rgba(28,20,15,0.44)' },
  card: {
    position: 'absolute',
    left: (CANVAS_W - PANEL_W) / 2,
    top: (CANVAS_H - PANEL_H) / 2,
  },
  kicker: {
    color: color.inkSoft,
    fontFamily: font.label,
    fontSize: typeScale.xxs,
    letterSpacing: 1.1,
  },
  name: {
    color: color.ink,
    fontFamily: font.display,
    fontSize: typeScale.xl,
    marginTop: 1,
  },
  what: {
    color: color.inkSoft,
    fontFamily: font.body,
    fontSize: typeScale.xs,
    lineHeight: 16,
    marginTop: 3,
  },
  columns: { flexDirection: 'row', gap: space.md, marginTop: space.sm },
  column: { flex: 1, gap: 2 },
  columnTitle: {
    color: color.ink,
    fontFamily: font.label,
    fontSize: typeScale.xxs,
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  bullet: {
    color: color.ink,
    fontFamily: font.body,
    fontSize: typeScale.xxs,
    lineHeight: 14,
  },
  closeRow: { flexGrow: 1, justifyContent: 'flex-end', alignItems: 'center' },
});
