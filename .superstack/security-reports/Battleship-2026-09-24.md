# Port City targeted release-security review — 2026-09-24

Scope: feature gating, rollback safety, protocol compatibility and authoritative persistence. This was a targeted release review, not a comprehensive infrastructure or dependency audit. The complete operational result is in `docs/port-city/progress/release-readiness.md`.

## Findings

1. **HIGH (10/10) — World Boss authority is process-local.** A restart loses event state and multiple instances do not share the serialized writer. Keep `portCity.worldBoss` off until the locked SQL writer is authoritative and restart/collision tests pass.
2. **HIGH (10/10) — Empire authority is process-local.** A restart loses progress/tribute state and idempotency is not shared across instances. Keep `portCity.empire` off until its SQL repository is authoritative and restart tests pass.
3. **HIGH (10/10) — adversarial HTTP suite has 29 failures.** Reproduction: `cd server && npm test -- --reporter=dot`; 29 failures in `tests/hardening/port-city-http.test.ts`, including internal 503 responses and concurrency/gating expectations. Keep all external flags off until fixed and green twice from clean databases.
4. **MEDIUM (10/10) — kill switches conflate admission with continuation.** Raids, voyages and wars need gateway drains to avoid stranding active work. Add independent admission controls.
5. **MEDIUM (10/10) — analytics transport is a stub.** External staged rollout cannot enforce pull thresholds. Connect the sink and alerts first.
6. **LOW (10/10) — old-client presentation offered retry.** Fixed: `upgrade_required` now renders a terminal Update required screen; protocol/presentation regression tests pass.

## Remediation roadmap

- **P0 (2–5 days):** fix the 29 HTTP failures; SQL-back World Boss and Empire; connect integrity/crash/latency telemetry.
- **P1 (1–2 days):** implement separate admission/drain controls and automated dependency validation.
- **P2 (0.5–1 day):** rehearse migrations on an access-controlled production snapshot and archive lock/query timings.

Invariant-class work—World Boss one-shot serialization, ledger conservation and lifecycle transitions—should receive formal/property verification in addition to the existing concurrency tests.

## Confidence Calibration

- Total findings: 6
- CRITICAL: 0
- HIGH: 3 (avg confidence: 10/10)
- MEDIUM: 2 (avg confidence: 10/10)
- LOW: 1 (avg confidence: 10/10)
- INFO: 0
- False positives filtered: 0
- Mode: Custom targeted review (8/10 gate)
