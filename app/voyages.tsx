/**
 * The Trade Docks — part-09 §3.
 *
 * "Send merchant ships out on timed routes ... Merchant ships = Trade Docks
 *  level (1 / 2 / 3 slots)."
 *
 * One slot per berth, each either empty (pick a route), sailing (a clock), or
 * back (collect). §3's rewards are "revealed on return", so a sailing slot
 * shows the route and the clock and NOTHING about what is in the hold — the
 * server sends null for both until the ship is home, and this screen has no
 * way to guess.
 *
 * A slot whose voyage was attacked routes to `/skirmish`, which plays the 5x5
 * and submits the log. Collecting is refused by the server while a skirmish is
 * unplayed and inside its 24 hours, so there is no state here that can pay
 * twice.
 */
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ROUTE_TABLE, voyageSlots, type Route } from '@engine/voyages';

import { collectVoyage, listVoyages, sendVoyage, type VoyageDto } from '@/daily/api';
import { useCity } from '@/city/store';
import { InkButton } from '@/ui/InkButton';
import { InkPanel } from '@/ui/InkPanel';
import { InkSpinner } from '@/ui/InkSpinner';
import { Paper } from '@/ui/Paper';
import { Scale } from '@/ui/Scale';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';

/** `3 h 12 m`, and never a negative. */
function countdown(ms: number): string {
  const left = Math.max(0, ms);
  const hours = Math.floor(left / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  if (hours > 0) return `${hours} h ${minutes} m`;
  if (minutes > 0) return `${minutes} m`;
  return 'any moment';
}

function RoutePicker({
  onPick,
  busy,
}: {
  onPick: (route: Route) => void;
  busy: boolean;
}) {
  return (
    <ScrollView style={styles.routes} showsVerticalScrollIndicator={false}>
      {ROUTE_TABLE.map((route) => (
        <Pressable
          key={route.id}
          style={styles.route}
          onPress={() => !busy && onPick(route)}
          disabled={busy}
        >
          <Text style={styles.routeName}>{route.name}</Text>
          <Text style={styles.routeDetail}>
            {`${route.hours} h · ${route.coins}c or ${route.steel}s`}
          </Text>
          {route.risk > 0 ? (
            <Text style={styles.routeRisk}>{`pirates ${Math.round(route.risk * 100)}%`}</Text>
          ) : null}
        </Pressable>
      ))}
    </ScrollView>
  );
}

function Slot({
  index,
  voyage,
  now,
  busy,
  onSend,
  onCollect,
  onFight,
}: {
  index: number;
  voyage: VoyageDto | undefined;
  now: number;
  busy: boolean;
  onSend: (route: Route, slot: number) => void;
  onCollect: (id: string) => void;
  onFight: (id: string, seed: number) => void;
}) {
  const route = voyage ? ROUTE_TABLE.find((r) => r.id === voyage.route) : undefined;

  return (
    <InkPanel w={236} h={214} seedKey={`berth-${index}`}>
      <View style={styles.slotBody}>
        <Text style={styles.slotTitle}>{`Berth ${index + 1}`}</Text>

        {!voyage ? (
          <RoutePicker busy={busy} onPick={(picked) => onSend(picked, index)} />
        ) : !voyage.back ? (
          <View style={styles.slotState}>
            <Text style={styles.slotRoute}>{route?.name ?? voyage.route}</Text>
            <Text style={styles.slotClock}>{countdown(voyage.returnsAt - now)}</Text>
            {/* §3 — "revealed on return". Nothing about the cargo here. */}
            <Text style={styles.slotHint}>at sea</Text>
          </View>
        ) : voyage.pirate && voyage.skirmishSeed !== null && voyage.state !== 'collected' ? (
          <View style={styles.slotState}>
            <Text style={styles.slotRoute}>{route?.name ?? voyage.route}</Text>
            <Text style={styles.slotAlarm}>Pirates!</Text>
            <InkButton
              label="Fight"
              tone="danger"
              onPress={() => onFight(voyage.id, voyage.skirmishSeed ?? 0)}
              w={110}
              h={30}
              seedKey={`fight-${index}`}
              disabled={busy}
            />
          </View>
        ) : (
          <View style={styles.slotState}>
            <Text style={styles.slotRoute}>{route?.name ?? voyage.route}</Text>
            {voyage.reward ? (
              <Text style={styles.slotCargo}>
                {voyage.reward.coins > 0
                  ? `${voyage.reward.coins} coins`
                  : `${voyage.reward.steel} steel`}
                {voyage.reward.gems > 0 ? `  +${voyage.reward.gems}g` : ''}
              </Text>
            ) : null}
            <InkButton
              label="Collect"
              tone="confirm"
              onPress={() => onCollect(voyage.id)}
              w={110}
              h={30}
              seedKey={`collect-${index}`}
              disabled={busy}
            />
          </View>
        )}
      </View>
    </InkPanel>
  );
}

export default function VoyagesScreen() {
  const router = useRouter();
  const snapshot = useCity((store) => store.snapshot);
  const [voyages, setVoyages] = useState<VoyageDto[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // §3 — "Merchant ships = Trade Docks level". The screen reads it only to
  // draw the right number of berths; the SERVER reads it again on every send,
  // so a stale snapshot cannot buy a fourth ship.
  const docksLevel = snapshot?.city.buildings.trade_docks?.level ?? 0;
  const slots = voyageSlots(docksLevel);

  const load = useCallback(async () => {
    try {
      setVoyages(await listVoyages());
      setError(null);
    } catch {
      setError('The dockmaster is not answering.');
      setVoyages([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A minute is plenty: the shortest route is an hour.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const onSend = useCallback(
    async (route: Route, slot: number) => {
      if (busy) return;
      setBusy(true);
      try {
        await sendVoyage(route.id, slot);
        await load();
      } catch {
        setError('That ship did not leave the quay.');
      } finally {
        setBusy(false);
      }
    },
    [busy, load],
  );

  const onCollect = useCallback(
    async (id: string) => {
      // A double tap must not pay twice. The server's claim guarantees it,
      // but the button locks so the player never sees two results either.
      if (busy) return;
      setBusy(true);
      try {
        await collectVoyage(id);
        await load();
      } catch {
        setError('That cargo is not ashore yet.');
      } finally {
        setBusy(false);
      }
    },
    [busy, load],
  );

  const onFight = useCallback(
    (id: string, seed: number) =>
      router.push({ pathname: '/skirmish', params: { id, seed: String(seed) } }),
    [router],
  );

  if (!voyages) {
    return (
      <Scale>
        <Paper>
          <View style={styles.centre}>
            <InkSpinner />
          </View>
        </Paper>
      </Scale>
    );
  }

  return (
    <Scale>
      <Paper>
        <Text style={styles.title}>Trade Docks</Text>
        <Text style={styles.subtitle}>
          {slots > 0
            ? `${slots} ${slots === 1 ? 'berth' : 'berths'}`
            : 'Build the Trade Docks to send a ship.'}
        </Text>

        <View style={styles.berths}>
          {Array.from({ length: Math.max(slots, 1) }, (_, index) => (
            <Slot
              key={index}
              index={index}
              voyage={voyages.find((v) => v.slot === index && v.state !== 'collected')}
              now={now}
              busy={busy || index >= slots}
              onSend={onSend}
              onCollect={onCollect}
              onFight={onFight}
            />
          ))}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable style={styles.back} onPress={() => router.back()}>
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      </Paper>
    </Scale>
  );
}

const styles = StyleSheet.create({
  centre: {
    width: CANVAS_W,
    height: CANVAS_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: font.display,
    fontSize: typeScale.xl,
    color: color.ink,
    textAlign: 'center',
    marginTop: space.sm,
  },
  subtitle: {
    fontFamily: font.body,
    fontSize: typeScale.xs,
    color: color.inkSoft,
    textAlign: 'center',
  },
  berths: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.md,
    marginTop: space.sm,
  },
  slotBody: {
    flex: 1,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  slotTitle: {
    fontFamily: font.label,
    fontSize: typeScale.xs,
    color: color.inkRed,
    marginBottom: 2,
  },
  slotState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
  },
  slotRoute: {
    fontFamily: font.display,
    fontSize: typeScale.md,
    color: color.ink,
  },
  slotClock: {
    fontFamily: font.label,
    fontSize: typeScale.lg,
    color: color.inkSoft,
  },
  slotHint: {
    fontFamily: font.body,
    fontSize: typeScale.xs,
    color: color.inkFaint,
  },
  slotAlarm: {
    fontFamily: font.display,
    fontSize: typeScale.lg,
    color: color.inkRed,
  },
  slotCargo: {
    fontFamily: font.label,
    fontSize: typeScale.sm,
    color: color.inkGreen,
  },
  routes: {
    flex: 1,
  },
  route: {
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: color.gridMinor,
  },
  routeName: {
    fontFamily: font.label,
    fontSize: typeScale.sm,
    color: color.ink,
  },
  routeDetail: {
    fontFamily: font.body,
    fontSize: typeScale.xxs,
    color: color.inkSoft,
  },
  routeRisk: {
    fontFamily: font.body,
    fontSize: typeScale.xxs,
    color: color.inkRed,
  },
  error: {
    fontFamily: font.body,
    fontSize: typeScale.sm,
    color: color.inkRed,
    textAlign: 'center',
    marginTop: space.xs,
  },
  back: {
    position: 'absolute',
    left: space.md,
    top: space.sm,
  },
  backText: {
    fontFamily: font.label,
    fontSize: typeScale.sm,
    color: color.inkSoft,
  },
});
