/**
 * Every plot, mounted inside the map's transformed view — part-02 §2, §10.
 *
 * Two performance rules from §10 live here:
 *   - "Plot overlays are memoised per state" — <Plot> is memo'd and its props
 *     are primitives, so a pan or a zoom re-renders nothing;
 *   - "only the building under construction re-renders on the 1 s tick" — the
 *     tick is subscribed ONLY when at least one job is running, and at most
 *     four can be (four dock workers). It is not a blanket 1 Hz re-render of
 *     fifteen plots.
 */
import { CITY_CATALOGUE, type BuildingId } from '@engine/city';
import { useEffect, useMemo, useState } from 'react';
import type { SharedValue } from 'react-native-reanimated';

import { serverNow, useCity } from '../store';
import { Plot } from './Plot';
import { PLOTS } from './plots';
import { plotStateFor } from './plotState';
import { runningJobCount } from './budgets';

export { runningJobCount };

export interface PlotLayerProps {
  readonly zoom: SharedValue<number>;
  readonly onOpen: (id: BuildingId) => void;
  readonly onCollect: (id: BuildingId) => void;
  /** Feature names the server has switched on, for hiding gated plots. */
  readonly features: readonly string[];
}

export function PlotLayer({ zoom, onOpen, onCollect, features }: PlotLayerProps) {
  const snapshot = useCity((s) => s.snapshot);
  const offset = useCity((s) => s.serverOffset);
  const [celebrated, setCelebrated] = useState<ReadonlySet<string>>(new Set());
  const [tick, setTick] = useState(0);

  const running = snapshot ? runningJobCount(snapshot.city.buildings) : 0;

  // §10 — subscribe to the clock only while something is actually being built.
  useEffect(() => {
    if (running === 0) return;
    const timer = setInterval(() => setTick((n) => n + 1), 1_000);
    return () => clearInterval(timer);
  }, [running]);

  const now = serverNow({ serverOffset: offset });

  const views = useMemo(
    () =>
      PLOTS.filter((plot) => {
        const feature = CITY_CATALOGUE[plot.id].feature;
        return !feature || features.includes(feature);
      }).map((plot) => ({ plot, view: plotStateFor(snapshot, plot.id, now) })),
    // `tick` is deliberately a dependency and `now` deliberately is not: the
    // tick is what advances the pen while a job runs, and `now` is derived
    // from it. Recomputing on `now` alone would re-render every frame.
    [snapshot, features, tick, now],
  );

  if (!snapshot) return null;

  return (
    <>
      {views.map(({ plot, view }) => (
        <Plot
          key={plot.id}
          spec={plot}
          view={view}
          zoom={zoom}
          onOpen={onOpen}
          onCollect={onCollect}
          celebrated={celebrated.has(`${plot.id}:${view.level}`)}
          onCelebrated={(key) =>
            setCelebrated((prev) => {
              const next = new Set(prev);
              next.add(key);
              return next;
            })
          }
        />
      ))}
    </>
  );
}
