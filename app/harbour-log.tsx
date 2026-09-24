/**
 * The defence log — part-07 §4.
 *
 * "A list of ink notes, newest first: attacker card, when, stars, destruction,
 * what they took, renown change, and Replay / Revenge. Unread entries are
 * dog-eared. Keep the last 30."
 *
 * Every decision — the order, the badge, the dog ear, whether revenge is
 * available and whether it is free — is `src/raid/ui/defenceLog.ts`. This
 * file draws notes.
 */
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getDefenceLog, markLogRead } from '@/raid/api';
import { raidErrorLine } from '@/raid/ui/captainCopy';
import {
  applyRevengeTaken,
  canTakeRevenge,
  destructionLine,
  orderLog,
  renownLine,
  tookLine,
  whenLine,
} from '@/raid/ui/defenceLog';
import { raidNow, useRaid } from '@/raid/store';
import { RaidApiError, type DefenceLogEntry } from '@/raid/types';
import { InkButton } from '@/ui/InkButton';
import { InkPanel } from '@/ui/InkPanel';
import { Paper } from '@/ui/Paper';
import { Scale } from '@/ui/Scale';
import { TitleRibbon } from '@/ui/TitleRibbon';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';

const NOTE_W = 740;
const NOTE_H = 78;

/** The dog ear on an unread note: a folded corner, drawn as two strokes. */
function DogEar() {
  return <View style={styles.dogEar} pointerEvents="none" />;
}

function Note({
  entry,
  now,
  onReplay,
  onRevenge,
}: {
  entry: DefenceLogEntry;
  now: number;
  onReplay: () => void;
  onRevenge: () => void;
}) {
  const revenge = canTakeRevenge(entry);
  const stars = '★'.repeat(entry.stars) + '☆'.repeat(3 - entry.stars);

  return (
    <View style={styles.note}>
      <InkPanel w={NOTE_W} h={NOTE_H} seedKey={`note-${entry.raidId.slice(0, 6)}`}>
        <View style={styles.noteBody}>
          <View style={styles.noteLeft}>
            <Text style={styles.noteName}>{entry.attackerName}</Text>
            <Text style={styles.noteWhen}>{whenLine(entry.at, now)}</Text>
          </View>

          <View style={styles.noteMiddle}>
            <Text style={styles.noteStars}>{stars}</Text>
            <Text style={styles.noteDetail}>{destructionLine(entry)}</Text>
          </View>

          <View style={styles.noteMiddle}>
            <Text style={styles.noteDetail}>{tookLine(entry)}</Text>
            <Text
              style={[
                styles.noteDetail,
                entry.renownDelta < 0 ? styles.noteBad : styles.noteGood,
              ]}
            >
              {renownLine(entry)}
            </Text>
          </View>

          <View style={styles.noteButtons}>
            <InkButton
              label="Replay"
              size="sm"
              w={112}
              h={38}
              seedKey={`note-replay-${entry.raidId.slice(0, 4)}`}
              onPress={onReplay}
            />
            <InkButton
              label="Revenge"
              tone={revenge.ok ? 'confirm' : 'ink'}
              size="sm"
              w={112}
              h={38}
              seedKey={`note-revenge-${entry.raidId.slice(0, 4)}`}
              disabled={!revenge.ok}
              onPress={onRevenge}
            />
          </View>
        </View>
      </InkPanel>
      {!entry.read ? <DogEar /> : null}
    </View>
  );
}

export default function DefenceLogScreen() {
  const router = useRouter();
  const log = useRaid((state) => state.log);
  const [error, setError] = useState<string | null>(null);
  const entries = orderLog(log);

  useEffect(() => {
    let cancelled = false;
    void getDefenceLog()
      .then((response) => {
        if (cancelled) return;
        useRaid.getState().setLog(response.entries, Date.now());

        // Opening the log reads it. Fire and forget: a failed mark just means
        // the dog ears come back next time, which is the safe direction.
        const unread = response.entries.filter((entry) => !entry.read).map((entry) => entry.raidId);
        if (unread.length > 0) {
          useRaid.getState().markRead(unread);
          void markLogRead(unread).catch(() => undefined);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(raidErrorLine(e instanceof RaidApiError ? e.code : 'internal'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const takeRevenge = useCallback(
    (entry: DefenceLogEntry) => {
      const check = canTakeRevenge(entry);
      if (!check.ok) {
        setError(check.reason);
        return;
      }
      // Optimistic, and correct: the server enforces it too, and the client's
      // own `markRevengeTaken` runs when the raid actually opens.
      useRaid.getState().setLog(applyRevengeTaken(log, entry.raidId), Date.now());
      router.push(`/raid?revenge=${entry.raidId}&target=${entry.attackerId ?? ''}`);
    },
    [log, router],
  );

  return (
    <Scale>
      <Paper variant="full" />

      <View style={styles.back}>
        <InkButton label="↩" size="lg" w={54} h={48} seedKey="log-back" onPress={() => router.back()} />
      </View>
      <View style={styles.ribbon}>
        <TitleRibbon title="Defence log" w={280} h={40} size="sm" seedKey="log-title" />
      </View>

      {entries.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Nobody has come for you yet.</Text>
        </View>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {entries.map((entry) => (
            <Note
              key={entry.raidId}
              entry={entry}
              now={raidNow()}
              onReplay={() => router.push(`/raid-replay?raidId=${entry.raidId}`)}
              onRevenge={() => takeRevenge(entry)}
            />
          ))}
        </ScrollView>
      )}

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
  ribbon: { position: 'absolute', left: CANVAS_W / 2 - 140, top: 2 },
  list: { position: 'absolute', left: (CANVAS_W - NOTE_W) / 2, top: 50, width: NOTE_W, height: CANVAS_H - 58 },
  listContent: { gap: space.sm, paddingBottom: space.md },
  note: { position: 'relative' },
  noteBody: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    height: NOTE_H,
    gap: space.md,
  },
  noteLeft: { width: 170 },
  noteName: { color: color.ink, fontFamily: font.display, fontSize: typeScale.md },
  noteWhen: { color: color.inkFaint, fontFamily: font.body, fontSize: typeScale.xxs },
  noteMiddle: { width: 160, gap: 2 },
  noteStars: { color: color.ink, fontFamily: font.display, fontSize: typeScale.md },
  noteDetail: { color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.xs },
  noteGood: { color: color.inkGreen },
  noteBad: { color: color.inkRed },
  noteButtons: { flexDirection: 'row', gap: space.sm, marginLeft: 'auto' },
  dogEar: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: 0,
    height: 0,
    borderTopWidth: 16,
    borderTopColor: color.inkRed,
    borderLeftWidth: 16,
    borderLeftColor: 'transparent',
  },
  empty: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: CANVAS_W,
    height: CANVAS_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: { color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.md },
  error: {
    position: 'absolute',
    left: CANVAS_W / 2 - 200,
    bottom: 6,
    width: 400,
    paddingVertical: 5,
    alignItems: 'center',
    backgroundColor: color.paper,
    borderWidth: 1.5,
    borderColor: color.inkRed,
  },
  errorText: { color: color.inkRed, fontFamily: font.body, fontSize: typeScale.xs },
});
