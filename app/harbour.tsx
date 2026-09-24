/**
 * Your harbour — part-07 §1.
 *
 * "The board, drawn as your own sea with your ships and defences visible."
 * This is the one raid screen where the full layout is legitimate: it is
 * yours, you drew it, and the server sends it to you and to nobody else.
 *
 * Reused, not rebuilt: `GridBoard` (the same board the placement screen and
 * the battle use), `Paper`, `InkButton`, `InkPanel`, `TitleRibbon`, `Scale`.
 * Nothing here is a new component except the header strip, which is three
 * chips.
 */
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ArsenalItem, Ship } from '@engine/types';

import { GridBoard } from '@/board/GridBoard';
import { BOARD_SIZE } from '@/board/layout';
import { getDefenceLog, getHarbour } from '@/raid/api';
import { UNEDITED_HARBOUR_LINE, raidErrorLine } from '@/raid/ui/captainCopy';
import { logBadge } from '@/raid/ui/defenceLog';
import { harbourBudget } from '@/raid/ui/defenceBudget';
import { harbourLevelsFromCity } from '@/raid/ui/useHarbourEditor';
import { useCity } from '@/city/store';
import { shieldMsLeft, useRaid } from '@/raid/store';
import { RaidApiError } from '@/raid/types';
import { InkButton } from '@/ui/InkButton';
import { Paper } from '@/ui/Paper';
import { Scale } from '@/ui/Scale';
import { SpeechBubble } from '@/ui/SpeechBubble';
import { TitleRibbon } from '@/ui/TitleRibbon';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';
import { useProfile } from '@/state/profile';

const BOARD_X = (CANVAS_W - BOARD_SIZE) / 2 - 90;
const BOARD_Y = 58;
const PANEL_X = BOARD_X + BOARD_SIZE + 44;

/** One ink chip in the header strip. */
function Chip({ label, value, tone = 'ink' }: { label: string; value: string; tone?: 'ink' | 'red' }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipLabel}>{label}</Text>
      <Text style={[styles.chipValue, tone === 'red' && styles.chipValueRed]}>{value}</Text>
    </View>
  );
}

function shieldText(ms: number | null): string | null {
  if (ms === null) return null;
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export default function HarbourScreen() {
  const router = useRouter();
  const name = useProfile((state) => state.name);
  const harbour = useRaid((state) => state.harbour);
  const renown = useRaid((state) => state.renown);
  const log = useRaid((state) => state.log);
  const harbourEdited = useRaid((state) => state.harbourEdited);
  const citySnapshot = useCity((state) => state.snapshot);
  const [error, setError] = useState<string | null>(null);
  const [shield, setShield] = useState<string | null>(null);

  const levels = harbourLevelsFromCity(citySnapshot);

  // ---- load ---------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    void getHarbour()
      .then((response) => {
        if (!cancelled) useRaid.getState().setHarbour(response.layout, response.serverNow);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(raidErrorLine(e instanceof RaidApiError ? e.code : 'internal'));
        }
      });

    // The log is loaded here too, so the badge is right before it is tapped.
    void getDefenceLog()
      .then((response) => {
        if (!cancelled) useRaid.getState().setLog(response.entries, Date.now());
      })
      .catch(() => {
        /* the badge simply stays as it was; the log screen reports its own. */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // The shield timer ticks from the server's clock (Part 1 §5's rule).
  useEffect(() => {
    const update = () => setShield(shieldText(shieldMsLeft()));
    update();
    const timer = setInterval(update, 30_000);
    return () => clearInterval(timer);
  }, []);

  const ships = (harbour?.ships ?? []) as readonly Ship[];
  const arsenal = (harbour?.arsenal ?? []) as readonly ArsenalItem[];
  const budget = harbourBudget(arsenal, levels.coastalCommandLevel);
  const badge = logBadge(log);

  const edit = useCallback(() => router.push('/placement?mode=harbour'), [router]);
  const openLog = useCallback(() => router.push('/harbour-log'), [router]);
  const raid = useCallback(() => router.push('/raid'), [router]);

  return (
    <Scale>
      <Paper variant="full" />

      <View style={styles.back}>
        <InkButton label="↩" size="lg" w={54} h={48} seedKey="harbour-back" onPress={() => router.back()} />
      </View>

      <View style={styles.ribbon}>
        <TitleRibbon title={`${name}'s harbour`} w={300} h={40} size="sm" seedKey="harbour-title" />
      </View>

      <View style={styles.chips}>
        <Chip label="Renown" value={String(renown)} />
        <Chip label="Coastal Cmd" value={`Lv ${levels.coastalCommandLevel}`} />
        <Chip label={budget.label.split(' ').slice(0, 2).join(' ')} value={`${budget.spent} / ${budget.budget}`} />
        {shield ? <Chip label="Shielded" value={shield} tone="red" /> : null}
      </View>

      {/* Your own sea: ships and defences visible, because they are yours. */}
      <GridBoard
        x={BOARD_X}
        y={BOARD_Y}
        ships={ships}
        arsenal={arsenal}
        revealShips
        columnLabels
        seedKey="harbour-board"
      />

      <View style={[styles.panel, { left: PANEL_X }]}>
        <InkButton label="Edit defences" size="md" w={210} h={52} seedKey="harbour-edit" onPress={edit} />
        <View style={styles.logRow}>
          <InkButton label="Defence log" size="md" w={210} h={52} seedKey="harbour-log" onPress={openLog} />
          {badge !== null ? (
            <View style={styles.badge} pointerEvents="none">
              <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
            </View>
          ) : null}
        </View>
        <InkButton
          label="Raid a harbour"
          tone="confirm"
          size="md"
          w={210}
          h={56}
          seedKey="harbour-raid"
          onPress={raid}
        />
      </View>

      {/* §1 — the Captain's line for a harbour the dockyard laid out. */}
      {!harbourEdited && harbour ? (
        <View style={styles.captain}>
          <SpeechBubble text={UNEDITED_HARBOUR_LINE} w={360} tail="left" seedKey="harbour-captain" />
        </View>
      ) : null}

      {error ? (
        <Pressable style={styles.error} onPress={() => setError(null)}>
          <Text style={styles.errorText}>{error}</Text>
        </Pressable>
      ) : null}
    </Scale>
  );
}

const styles = StyleSheet.create({
  back: { position: 'absolute', left: space.sm, top: space.sm },
  ribbon: { position: 'absolute', left: CANVAS_W / 2 - 150, top: 2 },
  chips: {
    position: 'absolute',
    left: BOARD_X,
    top: 34,
    flexDirection: 'row',
    gap: space.md,
  },
  chip: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  chipLabel: { color: color.inkSoft, fontFamily: font.label, fontSize: typeScale.xxs },
  chipValue: { color: color.ink, fontFamily: font.display, fontSize: typeScale.sm },
  chipValueRed: { color: color.inkRed },
  panel: { position: 'absolute', top: 86, gap: space.md },
  logRow: { position: 'relative' },
  badge: {
    position: 'absolute',
    right: -8,
    top: -8,
    minWidth: 24,
    height: 24,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.inkRed,
  },
  badgeText: { color: color.paper, fontFamily: font.display, fontSize: typeScale.xxs },
  captain: { position: 'absolute', left: BOARD_X - 12, top: CANVAS_H - 76 },
  error: {
    position: 'absolute',
    left: CANVAS_W / 2 - 200,
    bottom: 8,
    width: 400,
    paddingVertical: 5,
    alignItems: 'center',
    backgroundColor: color.paper,
    borderWidth: 1.5,
    borderColor: color.inkRed,
  },
  errorText: { color: color.inkRed, fontFamily: font.body, fontSize: typeScale.xs },
});
