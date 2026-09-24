import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { BossMark, PublicBossBoard } from '@engine/worldBoss';
import { fireWorldBoss, getWorldBoss } from '@/worldBoss/api';
import { InkButton } from '@/ui/InkButton';
import { Paper } from '@/ui/Paper';
import { Scale } from '@/ui/Scale';
import { color, font, type as typeScale } from '@/ui/tokens';
import { randomUuid } from '@/util/uuid';

function glyph(mark: BossMark | undefined): string { return mark === 'hit' ? '×' : mark === 'mine' ? '✦' : mark === 'miss' ? '·' : ''; }

export default function WorldBossScreen() {
  const router = useRouter();
  const [board, setBoard] = useState<PublicBossBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try { setBoard((await getWorldBoss()).board); setError(null); }
    catch (next) { setError(next instanceof Error ? next.message : 'offline'); }
  }, []);
  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(id);
  }, [refresh]);
  const fire = async (row: number, col: number) => {
    if (busy || board?.marks[`${row}:${col}`]) return;
    setBusy(true);
    try { setBoard((await fireWorldBoss(row, col, randomUuid())).board); setError(null); }
    catch (next) { setError(next instanceof Error ? next.message : 'offline'); }
    finally { setBusy(false); }
  };
  return (
    <Scale><Paper variant="full" />
      <View style={styles.header}>
        <InkButton label="Back" w={80} h={40} onPress={() => router.back()} />
        <View><Text style={styles.title}>The Great Armada</Text><Text style={styles.sub}>Wave {board?.wave ?? '—'} · shared chart</Text></View>
        <InkButton label="Refresh" w={96} h={40} disabled={busy} onPress={() => void refresh()} />
      </View>
      {error ? <View style={styles.message}><Text style={styles.error}>Couldn’t load the Armada: {error}</Text><InkButton label="Try again" w={110} h={38} onPress={() => void refresh()} /></View> : null}
      {!board && !error ? <Text style={styles.loading}>Unrolling the taped charts…</Text> : null}
      {board ? <ScrollView horizontal style={styles.viewport} contentContainerStyle={styles.scrollContent}>
        <ScrollView><View style={styles.board}>
          {Array.from({ length: 9 }, (_, sheet) => <View key={sheet} style={[styles.sheet, { left: (sheet % 3) * 202, top: Math.floor(sheet / 3) * 202 }]} />)}
          {Array.from({ length: 30 }, (_, row) => Array.from({ length: 30 }, (_unused, col) => {
            const mark = board.marks[`${row}:${col}`];
            return <Pressable key={`${row}:${col}`} accessibilityRole="button" accessibilityLabel={`Fire at row ${row + 1}, column ${col + 1}${mark ? `, ${mark}` : ''}`} disabled={busy || !!mark} onPress={() => void fire(row, col)} style={[styles.cell, { left: col * 20, top: row * 20 }]}><Text style={[styles.mark, mark === 'hit' && styles.hit]}>{glyph(mark)}</Text></Pressable>;
          }))}
        </View></ScrollView>
      </ScrollView> : null}
    </Scale>
  );
}

const styles = StyleSheet.create({
  header: { position: 'absolute', left: 18, right: 18, top: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: color.ink, fontFamily: font.display, fontSize: typeScale.lg, textAlign: 'center' },
  sub: { color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.xs, textAlign: 'center' },
  viewport: { position: 'absolute', left: 92, top: 62, width: 616, height: 286 },
  scrollContent: { minWidth: 620 }, board: { width: 604, height: 604, position: 'relative', backgroundColor: color.paper },
  sheet: { position: 'absolute', width: 200, height: 200, borderWidth: 1, borderColor: color.inkFaint, backgroundColor: 'rgba(251,252,254,0.72)' },
  cell: { position: 'absolute', width: 20, height: 20, borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: color.gridMajor, alignItems: 'center', justifyContent: 'center' },
  mark: { color: color.inkSoft, fontFamily: font.label, fontSize: 15 }, hit: { color: color.inkRed },
  message: { position: 'absolute', left: 220, top: 145, alignItems: 'center', gap: 12 }, error: { color: color.inkRed, fontFamily: font.body, fontSize: typeScale.sm },
  loading: { position: 'absolute', left: 300, top: 170, color: color.ink, fontFamily: font.body, fontSize: typeScale.sm },
});

