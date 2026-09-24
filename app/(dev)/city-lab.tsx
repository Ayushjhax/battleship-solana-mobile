/**
 * City lab — part-01 §5's "a button for every endpoint, a clock offset
 * override, and a JSON dump. This is how you test Part 1 before Part 2
 * exists."
 *
 * Dev builds only: app/(dev)/_layout.tsx redirects the whole group away in a
 * release bundle. Deliberately ugly — it is a probe, not a screen. Part 2
 * builds the real thing.
 */
import { CITY_CATALOGUE, type BuildingId } from '@engine/city';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  buildBuilding,
  buyDockWorker,
  cancelBuilding,
  collectAllBuildings,
  collectBuilding,
  getCity,
  speedUpBuilding,
} from '@/city/api';
import { cityEnabled, flags, loadFlags } from '@/city/features';
import { canAfford, secondsLeft, serverNow, useCity } from '@/city/store';
import { CityApiError } from '@/city/types';
import { InkButton } from '@/ui/InkButton';
import { Paper } from '@/ui/Paper';
import { Scale } from '@/ui/Scale';
import { CANVAS_H, CANVAS_W, color, font, space, type as typeScale } from '@/ui/tokens';

/** The buildings worth poking at before the rest of the roster is unlocked. */
const QUICK: BuildingId[] = ['fish_market', 'foundry', 'admiralty', 'scrapyard'];

export default function CityLabScreen() {
  return (
    <Scale>
      <Paper variant="full" seedKey="city-lab">
        <CityLab />
      </Paper>
    </Scale>
  );
}

function CityLab() {
  const store = useCity();
  const [log, setLog] = useState<string[]>([]);
  const [selected, setSelected] = useState<BuildingId>('fish_market');

  const say = useCallback((line: string) => {
    setLog((prev) => [`${new Date().toISOString().slice(11, 19)}  ${line}`, ...prev].slice(0, 8));
  }, []);

  /** Every button funnels through here so errors read the same way. */
  const run = useCallback(
    (label: string, call: () => Promise<{ city: unknown; serverNow: number }>) => async () => {
      useCity.getState().setLoading(true);
      try {
        const response = await call();
        useCity.getState().applyResponse(response as never);
        say(`${label} ok`);
      } catch (error) {
        const code = error instanceof CityApiError ? error.code : 'internal';
        useCity.getState().setError(code);
        say(`${label} -> ${code}`);
      }
    },
    [say],
  );

  useEffect(() => {
    void loadFlags(true).then(() => say(`flags: ${JSON.stringify(flags())}`));
  }, [say]);

  const snapshot = store.snapshot;
  const wallet = snapshot?.wallet;
  const building = snapshot?.city.buildings[selected];

  return (
    <View style={styles.root}>
      <ScrollView style={styles.left} contentContainerStyle={{ paddingBottom: space.md }}>
        <Text style={styles.h1}>City lab</Text>
        <Text style={styles.dim}>
          portCity.core {cityEnabled() ? 'ON' : 'OFF'} · offset {store.serverOffset} ms ·{' '}
          {store.fresh ? 'live' : 'cache'}
        </Text>

        <Text style={styles.h2}>Wallet</Text>
        <Text style={styles.mono}>
          {wallet
            ? `coins ${wallet.coins} · steel ${wallet.steel} · gems ${wallet.gems}`
            : 'no snapshot yet'}
        </Text>
        <Text style={styles.mono}>
          {snapshot
            ? `workers ${snapshot.freeWorkers}/${snapshot.city.workers} free · scrap ${snapshot.city.scrapPile} · collectable ${snapshot.collectable.total}`
            : '—'}
        </Text>

        <Text style={styles.h2}>Target: {CITY_CATALOGUE[selected].name}</Text>
        <View style={styles.row}>
          {QUICK.map((id) => (
            <InkButton
              key={id}
              label={CITY_CATALOGUE[id].name.split(' ')[0] ?? id}
              size="sm"
              w={92}
              h={28}
              tone={id === selected ? 'confirm' : 'ink'}
              seedKey={`lab-pick-${id}`}
              onPress={() => setSelected(id)}
            />
          ))}
        </View>
        {building ? (
          <Text style={styles.mono}>
            level {building.level} · stored {building.stored} ·{' '}
            {building.upgrading
              ? `building -> L${building.upgrading.toLevel}, ${secondsLeft(store, selected)}s left`
              : 'idle'}
            {'\n'}
            {(() => {
              const afford = canAfford(store, selected);
              return afford.ok
                ? 'affordable'
                : `short ${afford.shortSteel} steel / ${afford.shortCoins} coins`;
            })()}
          </Text>
        ) : null}

        <Text style={styles.h2}>Endpoints</Text>
        <View style={styles.row}>
          <InkButton label="GET /city" size="sm" w={110} h={30} seedKey="lab-get" onPress={run('GET /city', getCity)} />
          <InkButton
            label="build"
            size="sm"
            w={90}
            h={30}
            seedKey="lab-build"
            onPress={run('build', () => buildBuilding(selected))}
          />
          <InkButton
            label="speedup"
            size="sm"
            w={90}
            h={30}
            seedKey="lab-speed"
            onPress={run('speedup', () => speedUpBuilding(selected))}
          />
        </View>
        <View style={styles.row}>
          <InkButton
            label="cancel"
            size="sm"
            w={90}
            h={30}
            seedKey="lab-cancel"
            onPress={run('cancel', () => cancelBuilding(selected))}
          />
          <InkButton
            label="collect"
            size="sm"
            w={90}
            h={30}
            seedKey="lab-collect"
            onPress={run('collect', () => collectBuilding(selected))}
          />
          <InkButton
            label="collect all"
            size="sm"
            w={110}
            h={30}
            seedKey="lab-collect-all"
            onPress={run('collect-all', () => collectAllBuildings())}
          />
        </View>
        <View style={styles.row}>
          <InkButton
            label="buy worker"
            size="sm"
            w={110}
            h={30}
            seedKey="lab-worker"
            onPress={run('buy worker', () => buyDockWorker())}
          />
          <InkButton
            label="scrapyard collect"
            size="sm"
            w={150}
            h={30}
            seedKey="lab-scrap"
            onPress={run('collect scrap', () => collectBuilding('scrapyard'))}
          />
        </View>

        <Text style={styles.h2}>Idempotency</Text>
        <InkButton
          label="send the same requestId twice"
          size="sm"
          w={240}
          h={30}
          seedKey="lab-idem"
          onPress={run('double build', async () => {
            const id = `${Date.now()}-0000-4000-8000-000000000000`.slice(0, 36);
            await buildBuilding(selected, id).catch(() => undefined);
            return buildBuilding(selected, id);
          })}
        />

        <Text style={styles.h2}>Log</Text>
        {log.map((line, i) => (
          <Text key={i} style={styles.mono}>
            {line}
          </Text>
        ))}
      </ScrollView>

      <ScrollView style={styles.right}>
        <Text style={styles.h2}>Snapshot</Text>
        <Text style={styles.mono}>
          serverNow {serverNow(store)}
          {'\n\n'}
          {snapshot ? JSON.stringify(snapshot, null, 1) : '(nothing yet — press GET /city)'}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: CANVAS_W, height: CANVAS_H, flexDirection: 'row', padding: space.xs, gap: space.xs },
  left: { flex: 1 },
  right: { width: 300, borderLeftWidth: 1, borderLeftColor: color.inkFaint, paddingLeft: space.xs },
  h1: { fontFamily: font.display, fontSize: typeScale.md, color: color.ink },
  h2: { fontFamily: font.label, fontSize: typeScale.xs, color: color.ink, marginTop: space.xs },
  dim: { fontFamily: font.body, fontSize: typeScale.xxs, color: color.inkSoft },
  mono: { fontFamily: font.body, fontSize: typeScale.xxs, color: color.ink },
  row: { flexDirection: 'row', gap: space.xxs, flexWrap: 'wrap', marginTop: 2 },
});
