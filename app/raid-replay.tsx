/**
 * The replay viewer — part-07 §5.
 *
 * "Plays the stored actions through the engine at the original pace, with
 * Play/Pause, 1x / 2x / 4x, a scrub bar ticked per action, and a shell/star
 * strip that updates."
 *
 * THE RULE: **"Skipping and scrubbing must never desync: rebuild the state
 * from action 0 to the target index rather than trying to rewind."** That is
 * `createScrubber()` in `src/raid/ui/replayScrub.ts`, which calls the engine's
 * own `replayRaid` over `actions.slice(0, index)`. There is no rewind here to
 * get wrong.
 *
 * Reused: `GridBoard`, `ShellRow`, `StarStrip`, the ink kit.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ArsenalItem, Coord, Ship } from '@engine/types';

import { GridBoard } from '@/board/GridBoard';
import { BOARD_SIZE } from '@/board/layout';
import { getReplay } from '@/raid/api';
import {
  REPLAY_AS_RECORDED_LINE,
  REPLAY_DEFENDER_LINE,
  REPLAY_UNAVAILABLE_LINE,
  raidErrorLine,
} from '@/raid/ui/captainCopy';
import {
  INITIAL_TRANSPORT,
  REPLAY_SPEEDS,
  beatMs,
  createScrubber,
  layoutVisible,
  transportReducer,
  type ReplaySource,
  type ReplaySpeed,
} from '@/raid/ui/replayScrub';
import { ShellRow, StarStrip } from '@/raid/ui/ShellRow';
import { RaidApiError, type Replay } from '@/raid/types';
import { InkButton } from '@/ui/InkButton';
import { Paper } from '@/ui/Paper';
import { Scale } from '@/ui/Scale';
import { SpeechBubble } from '@/ui/SpeechBubble';
import { CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';

const BOARD_X = (CANVAS_W - BOARD_SIZE) / 2;
const BOARD_Y = 62;
const SCRUB_W = 520;

export default function ReplayScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ raidId?: string | string[] }>();
  const raidId = Array.isArray(params.raidId) ? params.raidId[0] : params.raidId;

  const [replay, setReplay] = useState<Replay | null>(null);
  const [error, setError] = useState<string | null>(null);

  const length = replay?.actions.length ?? 0;
  const [transport, dispatch] = useReducer(
    (state: typeof INITIAL_TRANSPORT, action: Parameters<typeof transportReducer>[1]) =>
      transportReducer(state, action, length),
    INITIAL_TRANSPORT,
  );

  // ---- load ---------------------------------------------------------------
  useEffect(() => {
    if (!raidId) {
      setError(REPLAY_UNAVAILABLE_LINE);
      return;
    }
    let cancelled = false;
    void getReplay(raidId)
      .then((response) => {
        if (!cancelled) setReplay(response);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // §8.5 — "an unavailable replay shows a note instead of crashing".
        setError(
          e instanceof RaidApiError && e.code === 'not-found'
            ? REPLAY_UNAVAILABLE_LINE
            : raidErrorLine(e instanceof RaidApiError ? e.code : 'internal'),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [raidId]);

  // ---- the scrubber -------------------------------------------------------
  const source: ReplaySource | null = useMemo(() => {
    if (!replay) return null;
    return {
      layout: replay.layout as ReplaySource['layout'],
      kit: replay.kit as ReplaySource['kit'],
      actions: replay.actions as ReplaySource['actions'],
      config: replay.config,
    };
  }, [replay]);

  const scrubber = useMemo(() => (source ? createScrubber(source) : null), [source]);

  // ---- playback -----------------------------------------------------------
  useEffect(() => {
    if (!transport.playing || length === 0) return;
    const timer = setTimeout(() => dispatch({ kind: 'tick' }), beatMs(transport.speed));
    return () => clearTimeout(timer);
  }, [length, transport.index, transport.playing, transport.speed]);

  const scrubTo = useCallback((index: number) => dispatch({ kind: 'scrub', index }), []);

  // ---- render -------------------------------------------------------------
  if (error) {
    return (
      <Scale>
        <Paper variant="full" />
        <View style={styles.back}>
          <InkButton label="↩" size="lg" w={54} h={48} seedKey="rp-back" onPress={() => router.back()} />
        </View>
        <View style={styles.centre}>
          <SpeechBubble text={error} w={420} tail="bottom" seedKey="replay-error" />
        </View>
      </Scale>
    );
  }

  if (!replay || !scrubber) {
    return (
      <Scale>
        <Paper variant="full" />
        <View style={styles.centre}>
          <Text style={styles.loading}>Unrolling the log…</Text>
        </View>
      </Scale>
    );
  }

  const view = scrubber.viewAt(transport.index);
  const showLayout = layoutVisible(replay.viewer, transport.index, length);
  const ships = showLayout
    ? (replay.layout.ships as readonly Ship[])
    : ((view.sunkShips ?? []) as unknown as readonly Ship[]);
  const arsenal = showLayout
    ? (replay.layout.arsenal as readonly ArsenalItem[])
    : ((view.revealedItems ?? []) as unknown as readonly ArsenalItem[]);

  return (
    <Scale>
      <Paper variant="full" />

      <View style={styles.back}>
        <InkButton label="↩" size="lg" w={54} h={48} seedKey="rp-back" onPress={() => router.back()} />
      </View>

      <View style={styles.hudLeft}>
        <ShellRow shells={view.shells} budget={replay.config.shells} feedback={null} nonce={0} />
      </View>
      <View style={styles.hudCentre}>
        <StarStrip stars={view.stars} destruction={view.destruction} landed={null} />
      </View>
      <View style={styles.hudRight}>
        <Text style={styles.counter}>{`${transport.index} / ${length}`}</Text>
        {replay.mode === 'as-recorded' ? <Text style={styles.asRecorded}>as recorded</Text> : null}
      </View>

      <GridBoard
        x={BOARD_X}
        y={BOARD_Y}
        cells={view.marks as Record<string, never>}
        ships={ships}
        arsenal={arsenal}
        revealShips={showLayout}
        columnLabels
        seedKey="replay-board"
      />

      {/* The scrub bar: one tick per action (§5). */}
      <View style={styles.scrub}>
        <View style={styles.scrubTrack}>
          {Array.from({ length: Math.max(1, length) }, (_, i) => (
            <Pressable
              key={i}
              style={[styles.tick, i < transport.index && styles.tickDone]}
              onPress={() => scrubTo(i + 1)}
              accessibilityRole="button"
              accessibilityLabel={`Action ${i + 1} of ${length}`}
            />
          ))}
        </View>
      </View>

      <View style={styles.controls}>
        <InkButton
          label={transport.playing ? 'Pause' : 'Play'}
          size="sm"
          w={110}
          h={44}
          seedKey="rp-play"
          onPress={() => dispatch({ kind: 'toggle' })}
        />
        {REPLAY_SPEEDS.map((speed) => (
          <InkButton
            key={speed}
            label={`${speed}×`}
            tone={transport.speed === speed ? 'confirm' : 'ink'}
            size="sm"
            w={62}
            h={44}
            seedKey={`rp-speed-${speed}`}
            onPress={() => dispatch({ kind: 'speed', speed: speed as ReplaySpeed })}
          />
        ))}
        <InkButton
          label="Restart"
          size="sm"
          w={110}
          h={44}
          seedKey="rp-restart"
          onPress={() => dispatch({ kind: 'restart' })}
        />
      </View>

      {/* §8 — the Captain warns the defender their board has been seen. */}
      {replay.viewer === 'defender' ? (
        <View style={styles.captain}>
          <SpeechBubble text={REPLAY_DEFENDER_LINE} w={380} tail="left" seedKey="rp-captain" />
        </View>
      ) : replay.mode === 'as-recorded' ? (
        <View style={styles.captain}>
          <SpeechBubble text={REPLAY_AS_RECORDED_LINE} w={380} tail="left" seedKey="rp-recorded" />
        </View>
      ) : null}
    </Scale>
  );
}

const styles = StyleSheet.create({
  back: { position: 'absolute', left: space.sm, top: space.sm },
  centre: {
    position: 'absolute',
    left: CANVAS_W / 2 - 210,
    top: 130,
    width: 420,
    alignItems: 'center',
  },
  loading: { color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.md },
  hudLeft: { position: 'absolute', left: space.md, top: 8 },
  hudCentre: { position: 'absolute', left: CANVAS_W / 2 - 40, top: 4 },
  hudRight: { position: 'absolute', right: space.md, top: 10, alignItems: 'flex-end' },
  counter: { color: color.ink, fontFamily: font.display, fontSize: typeScale.md },
  asRecorded: { color: color.inkRed, fontFamily: font.label, fontSize: typeScale.xxs },

  scrub: { position: 'absolute', left: CANVAS_W / 2 - SCRUB_W / 2, bottom: 62, width: SCRUB_W },
  scrubTrack: { flexDirection: 'row', gap: 2, height: 18, alignItems: 'center' },
  tick: { flex: 1, height: 10, backgroundColor: color.inkFaint },
  tickDone: { backgroundColor: color.ink, height: 16 },

  controls: {
    position: 'absolute',
    left: CANVAS_W / 2 - 240,
    bottom: 10,
    flexDirection: 'row',
    gap: space.sm,
  },
  captain: { position: 'absolute', left: 8, top: 96 },
});
