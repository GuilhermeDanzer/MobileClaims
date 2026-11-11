# Failure Scenarios

The local environment exists to prove resilience claims, not just to demo happy paths.
Each scenario below has:

1. **Control** — how to trigger it (deterministic, repeatable).
2. **Expected behaviour** — what the system must do.
3. **Proof** — the automated test(s) and/or manual demo step that verifies it.

Backend tests live in `apps/api/test/*.test.ts`; mobile logic/UI tests live under
`apps/mobile/src/`, SQLite integration tests under `apps/mobile/test-db/`. Scenario controls
are design/demo descriptions unless explicitly backed by these actual files. Phase 6
validation is recorded in PHASE_6_AUDIT.md.

## Scenario table

| # | Scenario | Control | Expected behaviour | Proof |
|---|---|---|---|---|
| F1 | Legacy claims system down | `POST :4000/dev/faults {mode:'down'}` | Claim is still accepted; outbox retries with backoff; status shows "waiting on claims team"; no data loss | Integration test `legacy-down` + manual demo (restart stub to drain) |
| F2 | Legacy slow → timeout | `{mode:'slow', latencyMs:30000}` | Client timeout fires; circuit breaker opens; worker stays healthy; subsequent calls are short-circuited until half-open | Unit test for the breaker; integration test `legacy-slow` |
| F3 | Duplicate legacy delivery | `{mode:'duplicate'}` | Fault intentionally bypasses stub dedupe; no automatic twin detection exists; pause ambiguous resend for operator lookup | `deliver.integration.test.ts` covers duplicate/retry semantics with deduping fake; duplicate fault needs manual review |
| F4 | Duplicate mobile submission | Replay identical POST/clientClaimId | Second response is `200` with the identical reference; one row in the DB | Integration test `idempotent-replay` |
| F5 | Queue consumer unavailable | Stop the `npm run worker` process | Messages accumulate; the API keeps accepting submissions; restart drains eligible messages; retries may reorder | Integration test `consumer-stopped` + manual demo |
| F6 | Queue paused mid-storm | `/dev/flags {flag:"queuePaused",value:true}` | Backlog is visible in `/dev/metrics`; an alert rule fires; unpausing drains | Integration test `queue-paused` + manual demo |
| F7 | Upload interrupted | Abort upload from the diagnostics screen; toggle "drop next upload" | Item returns to `queued` and retries from scratch; claim stays `media_pending`; never shown as complete | Mobile test `upload-interrupted` |
| F8 | Network lost on device | Diagnostics toggle "force offline" (plus airplane-mode manual check) | Nothing leaves the device; copy reads "Saved on this device"; recovery resends automatically | Mobile test `offline-reconnect` |
| F9 | Retry exhaustion | Inject a permanent mobile submission error | Item moves to `needs_attention`; the draft is preserved; a readable reason is shown | Mobile test `retry-exhaustion` |
| F10 | Poison message → DLQ | `{mode:'reject'}` (legacy rejects permanently) | 422 is a permanent rejection recorded without retry; transient/poison failures exhaust to DLQ; /dev/metrics shows count | Integration test `dead-letter` |
| F11 | Recovery after dependency failure | Restore `{mode:'ok'}` / unpause / restart worker | Backlog drains without duplicates and without user intervention | Integration tests `F1`, `F5`, `F6` end-state assertions |
| F12 | 5xx storm on the API | Design only: no local API shedding flag or load script | API sheds load with `429 + Retry-After`; the mobile outbox treats it as "retry later", not as user error | Mobile transient-failure test; production throttling not validated |

## How the controls work

- **On-prem faults** live only in `apps/onprem-stub` under `/dev/faults` and are registered
  only when `APP_ENV=local`. They mutate a per-process fault table consumed by the stub's
  claim/policy handlers.
- **API flags** live under `/dev/flags` and are gated identically. They mutate a
  `runtime_flags` table that the worker and API read on each operation.
- **Mobile toggles** live in the Settings tab (`apps/mobile/src/app/(tabs)/settings.tsx`),
  not a diagnostics route. They are currently present in the local app; no release gating
  has been implemented. This app is a local demonstrator.
- **Concurrency**: `phase6.integration.test.ts` issues 20 concurrent keyed submissions and
  checks one claim/outbox response, not production throughput or rate limiting.
- **Smoke**: `smoke.integration.test.ts` exercises health, dev auth, policy list, claim,
  direct LocalStack upload, completion, local queue, real HTTP adapter/stub and reconciliation.

## Not reproducible locally (documented, not tested)

These scenarios depend on real infrastructure and are **designed but not demonstrated**:

- APNs/FCM delivery latency and silent notification loss.
- S3 Cross-Region Replication lag and regional failover (RPO/RTO).
- RDS Multi-AZ failover timing.
- WAF/API Gateway rate limiting at the edge (approximated locally by the `429` path).
- Real Entra ID/Cognito federation and MFA flows.

Each is covered by a design statement and runbook in `ARCHITECTURE.md`, and is **explicitly
excluded from the validation report** rather than reported as passing.

## Phase 6.5 mobile validation (2026-11-07)

| Requested scenario | Automated evidence | Simulator evidence and exact boundary |
|---|---|---|
| A — offline cold start | **Automated and passed:** response-hook unmount/new QueryClient/offline mount for list/detail/history; policy expiry/selection/reconnect; real SQLite close/reopen preserves all four snapshots, original timestamps and pending attachment records | **Partially validated:** stopped/reopened Expo Go with an unreachable API URL; Saved claims and queued work were visible. A separate passing Maestro flow opened an online detail/history, enabled diagnostic offline, verified Saved information + Saved status history and cached policies, then restored online mode. OS airplane-mode restart was not executed; backend failure and diagnostic offline are explicitly different controls |
| B — offline submission | **Automated and passed:** no-send while offline, durable queue/migration/reopen, stable clientClaimId, reconnect sync and isolated B database cannot drain A | **Partially validated:** diagnostic-offline draft creation/save, reopening with incident retained, queueing, actual Expo Go process restart with unreachable API and foreground recovery passed. This simulator submission had no attachments; attachment persistence/retry has separate test evidence. Device SQLite ended complete with NW-2026-000006; local Postgres contained exactly one original clientClaimId |
| C — backend unavailable | **Automated and passed:** transient failures retain the operation/backoff and reuse the same ID; foreground timer resumes | **Manually executed through Maestro and passed:** API URL temporarily set to `http://127.0.0.1:1`, claim queued, process restarted, original `http://localhost:3000` restored; automatic retry completed. This exercises client-visible connection failure, not stopping/provisioning cloud services |
| D — interrupted photo upload | **Automated and passed:** partial upload progress, fresh URL, server-completion reconciliation after a lost response, post-acceptance lookup failure, permanent missing-file failure and accepted-media manual retry. Real API/LocalStack suite also PUTs bytes and confirms completion | **Manually executed through Maestro and passed:** native library selection → durable file → accepted/photos pending after diagnostic drop → actual Expo Go stop/reopen → real native PUT to local storage → detail shows Received · Not scanned (NW-2026-000008). The diagnostic failure is injected before PUT; no OS mid-byte interruption is claimed |
| E — account switching | **Automated and passed:** issuer/subject namespace, real A/B database isolation, A queue remains intact while B runs, return to A resumes; query state never exposes A to B; logout clears memory, old-token 401 cannot sign out B, old sync stops before its next operation | **Not executed with two real simulator accounts:** the existing sign-in screen only issues one seeded demo identity. No new production authentication or second dev-login mode was introduced |

Additional passing regressions: unaccepted policy rejection preserves the draft/attachments;
accepted replay succeeds after policy deactivation; old SQLite responses cannot overwrite
newer snapshots; delayed hydration cannot replace live query data; v1→v2 upgrade preserves
pending operations; double enqueue cannot turn a completed claim back into queued; wizard
entry params disappearing between steps no longer discard a reopened draft.

Maestro supplementary commands actually used:

```sh
maestro test /tmp/phase65-save.yaml --debug-output /tmp/phase65-maestro-save
maestro test /tmp/phase65-queue.yaml --debug-output /tmp/phase65-maestro-queue
maestro test /tmp/phase65-detail.yaml --debug-output /tmp/phase65-maestro-detail
maestro test /tmp/phase65-native-recovery.yaml --debug-output /tmp/phase65-maestro-native-final
maestro test /tmp/phase65-native-final.yaml --debug-output /tmp/phase65-maestro-verified
```

These temporary flow/debug artifacts belong to this validation session. A portable manual
procedure is in MOBILE_OFFLINE.md; the normal test suites are the durable regression tests.
Earlier exploratory Maestro attempts failed on selectors, screenshot-path restrictions and
its number-pad dismissal command. Those are not counted as passing flows. The reopening
attempt also revealed a real wizard-key regression; after the fix, its saved incident was
explicitly asserted before queueing. Native progress also exposed a bigint-render regression;
numeric conversion fixed it and uploader tests cover it. The final native rerun, including
idle-upload cancellation support, passed on NW-2026-000009. A separate fake-timer test verifies
that 60 seconds without advancing bytes aborts a stalled upload and clears its timer.
No tests were skipped or weakened to claim success.

Screenshot/visual review covered the running iPhone 16e/iOS 26.0 simulator only. Android,
physical-device upload, OS airplane-mode interruption, screen-reader/dynamic-type matrix,
background execution, real federation and AWS behavior were not executed. No AWS
infrastructure was deployed or tested.
