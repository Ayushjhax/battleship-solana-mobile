/**
 * The raid — part-07 §3, all four steps in one route.
 *
 * ONE ROUTE, FOUR STEPS, on purpose. The kit and the search are thrown away
 * if the player backs out, and a raid must not survive a route change it did
 * not settle — §9.3, "a raid never ends without a result the player can see".
 * Four routes would have made "back" a way to abandon a live raid silently.
 *
 * Reused wholesale, not rebuilt:
 *   GridBoard            the same board the battle and placement draw
 *   FxLayer + useFx      every animation from §13.2, unchanged
 *   ArsenalTab           the red tab, as in a match
 *   ShopPanel            the kit step is the same shop, filtered
 *   InkButton/Panel/...  the ink kit
 *
 * The state machine is `src/raid/ui/raidFlow.ts` and the HUD's decisions are
 * `src/raid/ui/shellHud.ts`. This file renders them; it decides nothing.
 */
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Alert, AppState, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Terrain } from '@engine/terrain';
import type { ArsenalItem, Coord, Ship } from '@engine/types';

import { GridBoard } from '@/board/GridBoard';
import { BOARD_SIZE } from '@/board/layout';
import { ShopPanel } from '@/features/arsenal/ShopPanel';
import {
  getRaidStatus,
  openRaid as openRaidApi,
  searchTarget,
  sendRaidAction,
  settleRaid as settleRaidApi,
} from '@/raid/api';
import {
  CLEARED_HOLD_MS,
  CLEARED_LINE,
  COVE_RIBBON,
  RETREAT_BODY,
  RETREAT_TITLE,
  raidErrorLine,
} from '@/raid/ui/captainCopy';
import { kitBudget, kitShopKinds } from '@/raid/ui/defenceBudget';
import { markRevengeTaken } from '@/raid/ui/defenceLog';
import {
  firstRaidBeat,
  firstRaidCard,
  shouldRunFirstRaid,
  shouldShowBeats,
  type FirstRaidBeatId,
} from '@/raid/ui/firstRaid';
import {
  INITIAL_FLOW,
  boardInteractive,
  reduceFlow,
  searchButtonLabel,
  shouldIgnoreTap,
  type FlowEvent,
  type RaidFlow,
} from '@/raid/ui/raidFlow';
import { ShellRow, StarStrip } from '@/raid/ui/ShellRow';
import {
  clockText,
  lootTally,
  shellFeedback,
  starEarned,
  type ShellFeedback,
} from '@/raid/ui/shellHud';
import { useRaid } from '@/raid/store';
import { RaidApiError, type RaidView, type TargetCard } from '@/raid/types';
import { useCity } from '@/city/store';
import { usePlacement } from '@/state/placement';
import { useProfile } from '@/state/profile';
import { InkButton } from '@/ui/InkButton';
import { InkPanel } from '@/ui/InkPanel';
import { InkSpinner } from '@/ui/InkSpinner';
import { Paper } from '@/ui/Paper';
import { Scale } from '@/ui/Scale';
import { SpeechBubble } from '@/ui/SpeechBubble';
import { TitleRibbon } from '@/ui/TitleRibbon';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';
import { randomUuid } from '@/util/uuid';

/** §3 — "One enemy board, centred and larger than in a match". */
const RAID_BOARD_SCALE = 1.16;
const BOARD_X = (CANVAS_W - BOARD_SIZE) / 2;
const BOARD_Y = 64;

// ---------------------------------------------------------------------------

export default function RaidScreen() {
  const router = useRouter();
  const [flow, dispatch] = useReducer(
    (state: RaidFlow, event: FlowEvent) => reduceFlow(state, event),
    INITIAL_FLOW,
  );
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<ShellFeedback | null>(null);
  const [nonce, setNonce] = useState(0);
  const [landed, setLanded] = useState<number | null>(null);
  const [cleared, setCleared] = useState(false);
  const [beatSeen, setBeatSeen] = useState<Set<FirstRaidBeatId>>(new Set());
  const [skippedScript, setSkippedScript] = useState(false);
  const shotsRef = useRef(0);
  const previousRef = useRef<RaidView | null>(null);

  const hasRaided = useProfile((state) => state.hasRaided);
  const citySnapshot = useCity((state) => state.snapshot);
  const armoryLevel = armoryFrom(citySnapshot);

  const taught = shouldRunFirstRaid({ hasRaided, skipped: skippedScript });
  const talking = shouldShowBeats({ hasRaided, skipped: skippedScript });

  // ---- the kit step uses the placement store's shop ------------------------
  useEffect(() => {
    if (flow.step !== 'kit') return;
    usePlacement.getState().initialize('harbour', Date.now() >>> 0, 'advanced', {
      fuelBudget: kitBudget({}, armoryLevel).budget,
      allowedKinds: kitShopKinds(),
      fuelLabel: 'Raid fuel',
    });
  }, [armoryLevel, flow.step]);

  const kitArsenal = usePlacement((state) => state.arsenal);
  const kit = useMemo(() => countKit(kitArsenal), [kitArsenal]);

  // ---- §4 of the plan: the status probe -----------------------------------
  const probe = useCallback(() => {
    dispatch({ kind: 'probe' });
    void getRaidStatus()
      .then((status) => {
        if (status.active && status.raidId && status.view) {
          dispatch({ kind: 'probe-active', raidId: status.raidId, view: status.view });
        } else {
          dispatch({ kind: 'probe-idle' });
        }
      })
      .catch(() => dispatch({ kind: 'probe-idle' }));
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      // Coming back from the background: ask the server what happened while
      // we were gone. §8.4 — 90 s away settles the raid, and the player must
      // land on the outcome rather than a dead board.
      if (next === 'active' && flow.raidId) probe();
    });
    return () => sub.remove();
  }, [flow.raidId, probe]);

  // ---- settling ------------------------------------------------------------
  useEffect(() => {
    if (flow.step !== 'settling' || !flow.raidId || pending) return;
    setPending(true);
    void settleRaidApi(flow.raidId)
      .then((settlement) => {
        useRaid.getState().setSettlement(settlement);
        useProfile.getState().markRaided();
        dispatch({ kind: 'settled', settlement });
      })
      .catch(() => dispatch({ kind: 'settle-failed' }))
      .finally(() => setPending(false));
  }, [flow.raidId, flow.step, pending]);

  // ---- the cleared flourish (§3, 900 ms hold) ------------------------------
  useEffect(() => {
    if (!flow.view?.over || flow.view.endReason !== 'cleared') return;
    setCleared(true);
    const timer = setTimeout(() => setCleared(false), CLEARED_HOLD_MS);
    return () => clearTimeout(timer);
  }, [flow.view?.endReason, flow.view?.over]);

  // ---- back ----------------------------------------------------------------
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (flow.step === 'raiding') {
        confirmRetreat();
        return true;
      }
      if (flow.step === 'settling' || flow.step === 'opening') return true;
      router.back();
      return true;
    });
    return () => sub.remove();
  });

  // ---- actions -------------------------------------------------------------
  const runSearch = useCallback(() => {
    if (shouldIgnoreTap(flow, pending)) return;
    dispatch({ kind: 'search' });

    // §7 — the first raid is forced to the scripted cove, and it is free.
    if (taught) {
      setTimeout(() => dispatch({ kind: 'card-found', card: firstRaidCard() as TargetCard }), 1_200);
      return;
    }

    setPending(true);
    void searchTarget(flow.searches)
      .then((response) => dispatch({ kind: 'card-found', card: response.card }))
      .catch((e: unknown) => dispatch({ kind: 'error', code: codeOf(e) }))
      .finally(() => setPending(false));
  }, [flow, pending, taught]);

  const beginRaid = useCallback(
    (card: TargetCard, revengeOf?: string) => {
      if (shouldIgnoreTap(flow, pending)) return;
      const raidId = randomUuid();
      dispatch({ kind: 'open', raidId });
      setPending(true);

      void openRaidApi({ raidId, card, kit })
        .then((response) => {
          if (revengeOf) markRevengeTaken(revengeOf);
          useRaid.getState().openedRaid(raidId, response.target, response.view, response.serverNow);
          previousRef.current = response.view;
          shotsRef.current = 0;
          dispatch({ kind: 'opened', raidId, view: response.view, card });
        })
        .catch((e: unknown) => dispatch({ kind: 'error', code: codeOf(e) }))
        .finally(() => setPending(false));
    },
    [flow, kit, pending],
  );

  /** One action, and the only place the HUD's feedback is computed. */
  const act = useCallback(
    (body: Parameters<typeof sendRaidAction>[0]) => {
      if (!boardInteractive(flow, pending)) return;
      setPending(true);
      const before = flow.view;

      void sendRaidAction(body)
        .then((response) => {
          const hit = response.events.some((e) => e.type === 'HIT' || e.type === 'SUNK');
          const mine = response.events.some((e) => e.type === 'MINE_TRIGGERED');

          if (before) {
            setFeedback(shellFeedback(before.shells, response.view.shells, { hit, mine }));
            setLanded(starEarned(before.stars, response.view.stars));
          }
          setNonce((n) => n + 1);
          if (body.kind === 'fire') shotsRef.current += 1;

          previousRef.current = before;
          useRaid.getState().setView(response.view, response.serverNow);
          dispatch({ kind: 'view', view: response.view });
        })
        .catch((e: unknown) => {
          // A network failure mid-raid is not a lost raid: probe and recover.
          if (e instanceof RaidApiError && e.code === 'no-session') probe();
          else dispatch({ kind: 'error', code: codeOf(e) });
        })
        .finally(() => setPending(false));
    },
    [flow, pending, probe],
  );

  const confirmRetreat = useCallback(() => {
    Alert.alert(RETREAT_TITLE, RETREAT_BODY, [
      { text: 'Keep firing', style: 'cancel' },
      {
        text: 'Retreat',
        onPress: () => {
          if (!flow.raidId) return;
          act({ kind: 'retreat', raidId: flow.raidId });
        },
      },
    ]);
  }, [act, flow.raidId]);

  // ---- the taught raid's beats --------------------------------------------
  const beat = talking && flow.view
    ? firstRaidBeat(
        {
          view: flow.view,
          previous: previousRef.current,
          mineTriggered: feedback?.kind === 'mine',
          shotsResolved: shotsRef.current,
        },
        beatSeen,
      )
    : null;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const view = flow.view;
  const marks = (view?.marks ?? {}) as Record<string, never>;
  const wrecks = (view?.sunkShips ?? []) as unknown as readonly Ship[];
  const revealed = (view?.revealedItems ?? []) as unknown as readonly ArsenalItem[];
  // The schema is loose about cells (the engine owns the types); same cast
  // the marks/wrecks above already use.
  const terrain = view?.terrain as unknown as Terrain | undefined;

  return (
    <Scale>
      <Paper variant="full" />

      {flow.step === 'kit' ? (
        <KitStep
          armoryLevel={armoryLevel}
          onSail={runSearch}
          onBack={() => router.back()}
          taught={taught}
        />
      ) : null}

      {flow.step === 'searching' ? <SearchingStep /> : null}

      {flow.step === 'card' && flow.card ? (
        <CardStep
          card={flow.card}
          costLabel={searchButtonLabel(taught ? 0 : flow.card.costCoins)}
          onNext={runSearch}
          onRaid={() => beginRaid(flow.card as TargetCard)}
          busy={pending}
        />
      ) : null}

      {(flow.step === 'raiding' || flow.step === 'opening') && view ? (
        <>
          <View style={styles.hudLeft}>
            <ShellRow shells={view.shells} budget={flow.budget} feedback={feedback} nonce={nonce} />
          </View>
          <View style={styles.hudCentre}>
            <StarStrip stars={view.stars} destruction={view.destruction} landed={landed} />
          </View>
          <View style={styles.hudRight}>
            <Text style={styles.clock}>{clockText(view.msLeft)}</Text>
            <LootTally card={flow.card} destruction={view.destruction} />
          </View>

          <View style={styles.board}>
            <GridBoard
              x={0}
              y={0}
              cells={marks}
              ships={wrecks}
              arsenal={revealed}
              columnLabels
              animateMarks
              seedKey="raid-board"
              terrain={terrain}
              interactive={boardInteractive(flow, pending)}
              onCellPress={(at: Coord) =>
                flow.raidId ? act({ kind: 'fire', raidId: flow.raidId, at }) : undefined
              }
            />
          </View>

          <View style={styles.retreat}>
            <InkButton
              label="Retreat"
              size="sm"
              w={120}
              h={44}
              seedKey="raid-retreat"
              onPress={confirmRetreat}
            />
          </View>

          {cleared ? (
            <View style={styles.cleared} pointerEvents="none">
              <TitleRibbon title={CLEARED_LINE} w={320} h={46} seedKey="raid-cleared" />
            </View>
          ) : null}

          {beat ? (
            <Pressable
              style={styles.beat}
              onPress={() => setBeatSeen((seen) => new Set(seen).add(beat.id))}
              onLongPress={() => setSkippedScript(true)}
            >
              <SpeechBubble text={beat.line} w={400} tail="bottom" seedKey={`beat-${beat.id}`} />
              <Text style={styles.beatSkip}>Tap to go on · hold to skip the lesson</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}

      {flow.step === 'settling' || flow.step === 'recovering' ? (
        <SettlingStep retrying={flow.retrying} onRetry={probe} />
      ) : null}

      {flow.step === 'result' && flow.settlement ? (
        <ResultStep
          settlement={flow.settlement}
          onReplay={() => router.push(`/raid-replay?raidId=${flow.settlement?.raidId ?? ''}`)}
          onAgain={() => dispatch({ kind: 'raid-again' })}
          onCity={() => router.replace('/city')}
        />
      ) : null}

      {flow.error ? (
        <Pressable style={styles.error} onPress={() => dispatch({ kind: 'error', code: '' })}>
          <Text style={styles.errorText}>{raidErrorLine(flow.error as never)}</Text>
        </Pressable>
      ) : null}
    </Scale>
  );
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

function KitStep({
  armoryLevel,
  onSail,
  onBack,
  taught,
}: {
  armoryLevel: number;
  onSail: () => void;
  onBack: () => void;
  taught: boolean;
}) {
  const arsenal = usePlacement((state) => state.arsenal);
  const budget = kitBudget(countKit(arsenal), armoryLevel);
  // §3 step 1 — "Sail is disabled until the kit is legal (it may be empty)".
  const legal = budget.spent <= budget.budget;

  return (
    <>
      <View style={styles.back}>
        <InkButton label="↩" size="lg" w={54} h={48} seedKey="kit-back" onPress={onBack} />
      </View>
      <View style={styles.ribbon}>
        <TitleRibbon title="Load the kit" w={280} h={40} size="sm" seedKey="kit-title" />
      </View>
      <Text style={styles.kitFuel}>{budget.label}</Text>

      <View style={styles.kitShop}>
        <ShopPanel onUnaffordable={() => undefined} />
      </View>

      {taught ? (
        <View style={styles.kitCaptain}>
          <SpeechBubble
            text="Your first run. Take nothing if you like — the cove is a soft target."
            w={380}
            tail="bottom"
            seedKey="kit-captain"
          />
        </View>
      ) : null}

      <View style={styles.sail}>
        <InkButton
          label="Sail"
          tone="confirm"
          size="md"
          w={170}
          h={54}
          seedKey="kit-sail"
          disabled={!legal}
          onPress={onSail}
        />
      </View>
    </>
  );
}

/** §3 step 2 — "A pen draws a course across a small chart, 1.2 s". */
function SearchingStep() {
  return (
    <View style={styles.centre}>
      <InkSpinner size={54} />
      <Text style={styles.searching}>Reading the charts…</Text>
    </View>
  );
}

function CardStep({
  card,
  costLabel,
  onNext,
  onRaid,
  busy,
}: {
  card: TargetCard;
  costLabel: string;
  onNext: () => void;
  onRaid: () => void;
  busy: boolean;
}) {
  return (
    <View style={styles.centre}>
      <InkPanel w={420} h={218} seedKey="target-card">
        <View style={styles.cardBody}>
          <Text style={styles.cardName}>{card.name}</Text>
          {card.kind === 'cove' ? (
            <View style={styles.coveRibbon}>
              <Text style={styles.coveText}>{COVE_RIBBON}</Text>
            </View>
          ) : (
            <Text style={styles.cardSub}>
              {`Admiralty ${card.admiraltyLevel} · ${card.renown} renown`}
            </Text>
          )}

          <View style={styles.lootRow}>
            <Text style={styles.lootChip}>{`${card.loot.coins} coins`}</Text>
            <Text style={styles.lootChip}>{`${card.loot.steel} steel`}</Text>
          </View>

          <Text style={styles.offer}>
            {card.kind === 'cove'
              ? 'No renown either way'
              : `+${card.renownOffer.best} for 3★ · ${card.renownOffer.worst} for 0★`}
          </Text>
        </View>
      </InkPanel>

      <View style={styles.cardButtons}>
        <InkButton
          label={costLabel}
          size="sm"
          w={170}
          h={48}
          seedKey="card-next"
          disabled={busy}
          onPress={onNext}
        />
        <InkButton
          label="Raid"
          tone="confirm"
          size="md"
          w={170}
          h={52}
          seedKey="card-raid"
          disabled={busy}
          onPress={onRaid}
        />
      </View>
    </View>
  );
}

/**
 * §9.3 — the raid is over and the result is on its way. If it does not come,
 * the player gets a button that asks again. There is no path from here to a
 * blank screen.
 */
function SettlingStep({ retrying, onRetry }: { retrying: boolean; onRetry: () => void }) {
  return (
    <View style={styles.centre}>
      <InkSpinner size={54} />
      <Text style={styles.searching}>Counting the damage…</Text>
      {retrying ? (
        <View style={{ marginTop: space.md }}>
          <InkButton
            label="See the outcome"
            size="sm"
            w={200}
            h={48}
            seedKey="settle-retry"
            onPress={onRetry}
          />
        </View>
      ) : null}
    </View>
  );
}

function ResultStep({
  settlement,
  onReplay,
  onAgain,
  onCity,
}: {
  settlement: { stars: number; destruction: number; earned: { coins: number; steel: number }; renown: { delta: number } };
  onReplay: () => void;
  onAgain: () => void;
  onCity: () => void;
}) {
  return (
    <View style={styles.centre}>
      <TitleRibbon
        title={settlement.stars > 0 ? 'Raid complete' : 'Driven off'}
        w={320}
        h={46}
        seedKey="raid-result"
      />
      <View style={{ marginTop: space.md }}>
        <StarStrip stars={settlement.stars} destruction={settlement.destruction} landed={null} />
      </View>
      <View style={styles.lootRow}>
        <Text style={styles.lootChip}>{`+${settlement.earned.coins} coins`}</Text>
        <Text style={styles.lootChip}>{`+${settlement.earned.steel} steel`}</Text>
        <Text style={styles.lootChip}>
          {settlement.renown.delta >= 0
            ? `+${settlement.renown.delta} renown`
            : `${settlement.renown.delta} renown`}
        </Text>
      </View>
      <View style={styles.cardButtons}>
        <InkButton label="Replay" size="sm" w={150} h={48} seedKey="res-replay" onPress={onReplay} />
        <InkButton label="Raid again" size="sm" w={170} h={48} seedKey="res-again" onPress={onAgain} />
        <InkButton label="Back to city" size="sm" w={180} h={48} seedKey="res-city" onPress={onCity} />
      </View>
    </View>
  );
}

function LootTally({ card, destruction }: { card: TargetCard | null; destruction: number }) {
  if (!card) return null;
  const tally = lootTally(card.loot, destruction);
  return (
    <Text style={styles.loot}>{`${tally.coins}c · ${tally.steel}s`}</Text>
  );
}

// ---------------------------------------------------------------------------

function countKit(arsenal: readonly ArsenalItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of arsenal) out[item.kind] = (out[item.kind] ?? 0) + 1;
  return out;
}

function armoryFrom(snapshot: unknown): number {
  const buildings = (snapshot as { city?: { buildings?: Record<string, { level?: number }> } })?.city
    ?.buildings;
  return buildings?.armory?.level ?? 0;
}

function codeOf(error: unknown): string {
  return error instanceof RaidApiError ? error.code : 'internal';
}

const styles = StyleSheet.create({
  back: { position: 'absolute', left: space.sm, top: space.sm },
  ribbon: { position: 'absolute', left: CANVAS_W / 2 - 140, top: 2 },
  centre: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: CANVAS_W,
    height: CANVAS_H,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  searching: { color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.sm },

  hudLeft: { position: 'absolute', left: space.md, top: 10 },
  hudCentre: { position: 'absolute', left: CANVAS_W / 2 - 40, top: 6 },
  hudRight: { position: 'absolute', right: space.md, top: 10, alignItems: 'flex-end' },
  clock: { color: color.ink, fontFamily: font.display, fontSize: typeScale.lg },
  loot: { color: color.inkSoft, fontFamily: font.label, fontSize: typeScale.xs },

  board: {
    position: 'absolute',
    left: BOARD_X,
    top: BOARD_Y,
    transform: [{ scale: RAID_BOARD_SCALE }],
  },
  retreat: { position: 'absolute', right: space.md, bottom: space.md },
  cleared: { position: 'absolute', left: CANVAS_W / 2 - 160, top: CANVAS_H / 2 - 23 },

  beat: { position: 'absolute', left: CANVAS_W / 2 - 200, bottom: 10, alignItems: 'center' },
  beatSkip: { color: color.inkFaint, fontFamily: font.label, fontSize: typeScale.xxs, marginTop: 2 },

  kitFuel: {
    position: 'absolute',
    left: space.md,
    top: 52,
    color: color.ink,
    fontFamily: font.display,
    fontSize: typeScale.md,
  },
  kitShop: { position: 'absolute', left: CANVAS_W / 2 - 200, top: 62 },
  kitCaptain: { position: 'absolute', left: 20, bottom: 74 },
  sail: { position: 'absolute', right: space.md, bottom: space.md },

  cardBody: { padding: space.md, gap: 6, alignItems: 'center' },
  cardName: { color: color.ink, fontFamily: font.display, fontSize: typeScale.lg },
  cardSub: { color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.sm },
  coveRibbon: {
    backgroundColor: color.ink,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  coveText: { color: color.paper, fontFamily: font.label, fontSize: typeScale.xs },
  lootRow: { flexDirection: 'row', gap: space.md, marginTop: 4 },
  lootChip: { color: color.ink, fontFamily: font.label, fontSize: typeScale.sm },
  offer: { color: color.inkSoft, fontFamily: font.body, fontSize: typeScale.xs },
  cardButtons: { flexDirection: 'row', gap: space.md, marginTop: space.md },

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
