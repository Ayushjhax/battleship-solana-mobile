/**
 * City telemetry — part-01 §7, DECISIONS.md D3.
 *
 * There is no analytics backend in this repo, so the transport is a stub. The
 * event names and payloads are the real ones from §7, and every call site is
 * real, so pointing this at a sink later is a one-file change.
 *
 * Silent under vitest: the suites assert behaviour, not log noise.
 */
import type { CityTelemetryEvent } from '@engine/city';

export type CitySink = (event: CityTelemetryEvent & { userId: string }) => void;

const defaultSink: CitySink = (event) => {
  if (process.env.VITEST) return;
  console.log(`[city] ${event.type}`, JSON.stringify(event));
};

let sink: CitySink = defaultSink;

export function emitCity(event: CityTelemetryEvent, userId: string): void {
  try {
    sink({ ...event, userId });
  } catch {
    /* telemetry must never break a request */
  }
}

/** Test-only: capture events instead of logging them. */
export function __setCitySinkForTests(next: CitySink | null): void {
  sink = next ?? defaultSink;
}
