/**
 * Every src/ui component in every state on one landscape screen.
 *
 * Two things to check here with your eyes:
 *  - nothing looks machine-drawn
 *  - pressing "Re-render" or watching the countdown tick must NOT change the
 *    `generated` count in the readout, and no element may re-wobble.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AssetSlot } from '@/ui/AssetSlot';
import { CurrencyChip } from '@/ui/CurrencyChip';
import { InkIconButton } from '@/ui/InkIconButton';
import { LogoMark } from '@/ui/LogoMark';
import { BRAND, SHIPS } from '@/ui/assets';
import { renderStats, roughStats } from '@/ui/debug';
import { InkButton } from '@/ui/InkButton';
import { InkPanel } from '@/ui/InkPanel';
import { Paper } from '@/ui/Paper';
import { RankBadge } from '@/ui/RankBadge';
import { Scale } from '@/ui/Scale';
import { SpeechBubble } from '@/ui/SpeechBubble';
import { TitleRibbon } from '@/ui/TitleRibbon';
import { color, font, space, type as typeScale, CANVAS_H, CANVAS_W, PAPER_GRID } from '@/ui/tokens';
import { TurnTriangle } from '@/ui/TurnTriangle';
import { roughCacheSize } from '@/ui/useRough';

function Label({ children }: { children: string }) {
  return (
    <Text
      style={{
        color: color.inkSoft,
        fontFamily: font.body,
        fontSize: typeScale.xxs,
        marginBottom: 4,
      }}
    >
      {children}
    </Text>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Label>{title}</Label>
      <View style={styles.row}>{children}</View>
    </View>
  );
}

export default function KitchenSink() {
  const [renders, setRenders] = useState(0);
  const [fired, setFired] = useState(0);
  const [seconds, setSeconds] = useState(20);

  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => (s <= 0 ? 20 : s - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <Scale>
      <Paper variant="full" seedKey="kitchen" />
      <View style={styles.header} pointerEvents="none">
        <TitleRibbon title="Kitchen Sink" w={300} h={40} size="md" />
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Section title="InkButton — ink / confirm / danger, sizes, disabled, prop change with a fixed seedKey">
          <InkButton label="Menu" />
          <InkButton label="Battle!" tone="confirm" size="lg" />
          <InkButton label="Resign" tone="danger" />
          <InkButton label="Small" size="sm" />
          <InkButton label="Disabled" disabled />
          <InkButton label="Choose" tone="confirm" disabled />
          <InkButton
            label={`Fired ${fired}`}
            seedKey="fired"
            w={120}
            onPress={() => setFired((n) => n + 1)}
          />
        </Section>

        <Section title="TurnTriangle — yours with countdown (pulses under 5 s), theirs, idle">
          <TurnTriangle direction="right" state="yours" seconds={seconds} seedKey="a" />
          <TurnTriangle direction="left" state="theirs" seconds={12} seedKey="b" />
          <TurnTriangle direction="right" state="idle" seedKey="c" />
          <TurnTriangle direction="left" state="yours" size={36} seedKey="d" />
        </Section>

        <Section title="SpeechBubble — tail left / bottom, auto-height">
          <SpeechBubble text="Welcome aboard. Let's sink something." w={220} seedKey="hello" />
          <SpeechBubble
            text="Sunk. The squares around a wreck are always empty, so we mark them for you."
            tail="bottom"
            tailAt={0.25}
            w={260}
            seedKey="sunk"
          />
        </Section>

        <Section title="InkPanel + RankBadge">
          <InkPanel w={230} h={96} seedKey="profile">
            <RankBadge
              name="Ayush"
              rank="Seaman Apprentice"
              current={139}
              total={300}
              avatar={{ source: null, tint: '#2E7D6B' }}
            />
            <View style={{ height: space.xs }} />
            <RankBadge rank="Vice-admiral" seedKey="va" />
          </InkPanel>
          <InkPanel w={150} h={96} seedKey="empty" fill="none" padding={space.xs}>
            <Text style={{ color: color.ink, fontFamily: font.body, fontSize: typeScale.xs }}>
              fill=&quot;none&quot; lets the graph paper show through.
            </Text>
          </InkPanel>
        </Section>

        <Section title="AssetSlot — placeholders at exact size, and a real image (brand/app-icon.png, tinted)">
          <AssetSlot source={SHIPS.battleship} w={112} h={28} label="battleship" />
          <AssetSlot source={SHIPS.boat} w={28} h={28} label="boat" />
          <AssetSlot source={null} w={64} h={64} label="avatar-1" />
          <AssetSlot source={BRAND.appIcon} w={48} h={48} label="app-icon" tintColor={null} />
          <AssetSlot source={BRAND.appIcon} w={48} h={48} label="app-icon" />
        </Section>

        <Section title="LogoMark (ink bleed) · CurrencyChip · InkIconButton">
          <LogoMark w={240} h={64} />
          <CurrencyChip kind="coins" value={1250} />
          <CurrencyChip kind="gems" value={12} />
          <InkIconButton icon="settings" accessibilityLabel="Settings" />
          <InkIconButton icon="sound-on" accessibilityLabel="Sound on" />
          <InkIconButton icon="sound-off" accessibilityLabel="Sound off" />
        </Section>

        <Section title="TitleRibbon — lg / md">
          <TitleRibbon title="Choose Game Progress" />
          <TitleRibbon title="Arena" w={200} h={36} size="md" />
        </Section>

        <Section title="Paper variant='panel'">
          <Paper variant="panel" w={220} h={110} seedKey="note">
            <View style={{ padding: space.sm }}>
              <Text style={{ color: color.ink, fontFamily: font.display, fontSize: typeScale.sm }}>
                A bare sheet
              </Text>
              <Text
                style={{ color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.xxs }}
              >
                rules every {PAPER_GRID.unit}, major every {PAPER_GRID.major}
              </Text>
            </View>
          </Paper>
        </Section>

        <Section title="Performance readout — press Re-render: generated must not move">
          <InkPanel w={330} h={92} seedKey="stats">
            <Text style={styles.mono}>
              rough generated {roughStats.generated} · cache hits {roughStats.cacheHits} · cached{' '}
              {roughCacheSize()}
            </Text>
            <Text style={styles.mono}>
              renders — Paper {renderStats['Paper'] ?? 0} · GraphRules{' '}
              {renderStats['GraphRules'] ?? 0} · screen {renders}
            </Text>
          </InkPanel>
          <InkButton
            label="Re-render"
            seedKey="rerender"
            onPress={() => setRenders((n) => n + 1)}
          />
        </Section>
        <View style={{ height: space.xl }} />
      </ScrollView>
    </Scale>
  );
}

const styles = StyleSheet.create({
  header: { position: 'absolute', left: (CANVAS_W - 300) / 2, top: 6 },
  scroll: {
    position: 'absolute',
    left: 0,
    top: PAPER_GRID.ruleY + 24,
    width: CANVAS_W,
    height: CANVAS_H - PAPER_GRID.ruleY - 24,
  },
  content: { paddingHorizontal: space.lg, paddingBottom: space.lg },
  section: { marginBottom: space.md },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: space.sm },
  mono: { color: color.ink, fontFamily: font.body, fontSize: typeScale.xxs, lineHeight: 15 },
});
