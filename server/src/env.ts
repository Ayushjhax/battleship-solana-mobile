/**
 * Test-overridable timing constants. Room and matchmaker timers are real
 * seconds in production (90s layouts, 45s disconnects, ...) — far too slow
 * for an automated test to wait out. Reading each through `envMs` lets
 * room.test.ts shrink them to milliseconds without touching the production
 * defaults or exposing a runtime config surface nobody else needs.
 */
export function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw !== undefined ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
