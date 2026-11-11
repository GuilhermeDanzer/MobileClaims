> Phase 5 historical snapshot. Current findings, remediation and executed results are in
> `PHASE_6_AUDIT.md`; older test counts below are not Phase 6 results.

# Implementation Status

A snapshot of what is implemented, tested, and pending, in one place. Classification follows
`IMPLEMENTATION_MATRIX.md`: **A** = implemented and tested locally, **B** = real code against
a local substitute, **C** = designed and documented only. This document is updated as work
lands; never describe something as done here that has not been executed.

> Last updated: end of Phase 5 (architecture, security, and reliability documentation).

## Phase status

| Phase | Status |
|---|---|
| 1 — Documentation & diagrams | ✅ Complete |
| 2 — Foundation (monorepo, contracts, schema, local env, auth) | ✅ Complete |
| 3 — Core backend | ✅ Complete (claims, idempotency, documents, outbox, queue, worker, legacy gateway, reconciliation) |
| 4 — Mobile experience | ✅ Complete (wizard, SQLite drafts/outbox, sync engine, uploads, timeline, diagnostics) |
| 5 — Local environment & reliability | 🟡 Partially done (compose; load script pending) |
| 6 — Testing & validation report | 🟡 In progress (API + mobile suites green; `TESTING_AND_VALIDATION.md` pending) |
| 7 — Final docs & presentation | ⏳ Not started |

## Backend feature status

| Feature | Level | Tested? |
|---|---|---|
| Claims create / get / list / status events | A | ✅ `claims.integration.test.ts` |
| Idempotency (`clientClaimId` + `Idempotency-Key`) | A | ✅ replay + concurrent-duplicate tests |
| Document presign + upload + complete | A | ✅ presigned PUT → complete test (LocalStack) |
| **Document upload URL re-issue (Phase 4 G2)** | A | ✅ `claims.integration.test.ts` (2 tests) |
| **Policy list (Phase 4 G1)** | A | ✅ `policies.integration.test.ts` (2 tests) |
| Transactional outbox → queue | A | ✅ queue + deliver tests |
| Message queue (visibility timeout, DLQ, redrive) | B | ✅ `queue.integration.test.ts` |
| Legacy delivery (`deliverClaim`) | A | ✅ `deliver.integration.test.ts` |
| Circuit breaker (pause-while-open) | A | ✅ breaker test + outage smoke |
| Status reconciliation | A | ✅ `reconcile.integration.test.ts` (10 tests) |
| Notification inbox | A | ✅ via deliver tests |
| `/dev` metrics, flags, redrive, status controls | B | ✅ smoke-tested |
| Customer/employee JWT (local issuers) | B | ✅ `auth.test.ts` |

## Mobile feature status (Phase 4)

| Feature | Level | Tested? |
|---|---|---|
| Session (dev login, SecureStore, 401 → re-auth) | B | typecheck + lint |
| Route shell (guards, tabs, wizard stack) | A | `expo export` bundles |
| SQLite drafts / attachments / queue / cache | A | ✅ `test-db/db.test.ts` + `cache.test.ts` |
| Status → copy mapping (incl. unknown statuses) | A | ✅ `status-copy.test.ts` |
| New-claim wizard + validation | A | ✅ `validate.test.ts` |
| Sync engine (claim-first, retry/backoff, uploads) | A | ✅ `sync-engine*.test.ts` |
| Timeline rendering + unknown status | A | ✅ `timeline.test.tsx` |
| Dashboard, photo capture, settings/diagnostics | A | manual simulator (logic/SQL covered by suites) |

## Verification commands (all executed)

```bash
npm run typecheck                    # api, mobile, onprem-stub, contracts — clean
npm run lint                         # 4 workspaces — clean
npm test                             # api 29/29 · mobile logic 21/21 · mobile db 24/24
npx expo export --platform ios       # bundles cleanly (apps/mobile)
```

Live smoke (executed against running Postgres + LocalStack):

- `GET /health` → `{status:"ok",database:"up",storage:"up"}`
- `GET /v1/policies` (customer token) → the two seeded policies
- `POST /v1/claims/:id/documents/:id/upload-url` on a missing claim → `404 NOT_FOUND`

## Known gaps / deferred

- Real APNs/FCM device push (B inbox only).
- Real Cognito / Entra ID tenants (local issuers only).
- Malware scanning (documents flagged `not_scanned`).
- S3 Cross-Region Replication / Multi-AZ failover (single local Postgres + LocalStack).
- Legacy `getStatus` is polled by platform reference; a legacy system keyed only by its own
  claim number needs a verified real contract; Phase 6 persists legacy_claim_number but retains local reference lookup.
- `Idempotency-Key` now scopes by customer and checks the body hash; clientClaimId remains the authoritative intake identity.
- In-memory API metrics reset on restart (worker state persists to `runtime_flags`).
- Mobile: presigned URLs target `localhost:4566`, so photo upload works on the simulator;
  a physical device needs LAN config + real S3 (see `MOBILE_OFFLINE.md`).
- Mobile: tapping through the wizard on a simulator is a manual step; the automated suites
  cover the logic and SQL, and `expo export` proves the bundle builds.

## Phase 6.5 — mobile hardening (2026-11-07)

This section supersedes the historical Phase 4–6 mobile cache/account limitations above
and in ARCHITECTURE.md's historical Phase 6 boundary notes. Architecture and insurance rules
were preserved; the targeted backend change enforces the existing owned/active policy fields
at intake, without inventing coverage rules.

### Current implementation and file manifest

All mobile paths below are relative to `apps/mobile/`:

| Files changed/added | Reason and visible improvement |
|---|---|
| `src/db/schema.ts`, `database.ts`, `ownership.ts`, `snapshots-repo.ts` | Add v2 response snapshots and bounded hashed customer database names; offline restart reads and safe account isolation; leave historical DB quarantined |
| `src/features/cache/use-snapshot-query.ts`, `.test.tsx` | One validated hydration path with original timestamps, monotonic snapshot writes, reconnect refresh and policy TTL; late cache hydration cannot overwrite a live result |
| `src/features/claims/use-claims.ts`, `use-local-submissions.ts` | Scoped query keys/database reads; cached list/detail/history after restart |
| `src/app/claims/[claimId].tsx`, `src/app/(tabs)/index.tsx` | Remove competing screen fallback; label saved information/history; retain pending evidence cards alongside server claims |
| `src/features/policies/use-policies.ts`, `src/app/new-claim/index.tsx` | Durable policy snapshot, 15-minute freshness and retained stale selection, refresh timestamp, selected/disabled accessibility states and retry/empty copy |
| `src/features/session/session-context.tsx`, `.test.tsx`, `src/lib/api-client.ts` | Logout clears memory, preserved per-owner data, unavailable token storage falls back to login, late old-token 401 cannot sign out a new account |
| `src/features/sync/sync-engine.ts`, `use-sync.tsx`, `use-sync.test.tsx`, `upload.ts`, `upload.test.ts` | Durable acceptance before lookup; recover document mapping on upload retry; session fences and owner-scoped progress; native bigint progress is converted to numeric byte counts; stalled uploads abort after 60 seconds without advancing bytes; permanent/missing-file failures park; idle sync no longer invalidates server reads every five seconds |
| `src/features/sync/network.ts`, `dev-flags.ts` | Diagnostic offline toggle now updates read availability/UI as well as sending |
| `src/db/queue-repo.ts`, `src/features/claims/submission-card.tsx`, `status-copy.ts`, `status-copy.test.ts` | Guard enqueue; accepted-media-only manual retry; pending filenames/transfer percentages/retry time; distinguish sending from waiting; reopen rejected unaccepted drafts |
| `src/features/new-claim/new-claim-context.tsx`, `src/app/new-claim/_layout.tsx`, `src/features/new-claim/draft-navigation.test.tsx` | Serialize draft persistence, validate before enqueue, prevent queued/accepted mutation, useful missing-draft error; preserve a reopened draft as entry route params disappear during step navigation |
| `src/features/new-claim/photo-capture.ts`, `.test.ts`, `validate.ts`, `validate.test.ts` | Permission denial recovery, size validation before hashing, reject empty files; preserve durable copy/checksum association and size/type limits |
| `src/components/primary-button.tsx`, `screen-header.tsx`, `src/app/new-claim/details.tsx`, `photos.tsx`, `src/app/(tabs)/settings.tsx` | Touch targets, disabled/accessibility labels, keyboard avoidance/dismissal, wrapping actions, manual upload retry and stable automation selectors |
| `test-db/snapshots.test.ts`, `db.test.ts`, `sync-engine-failures.test.ts` | Real SQLite reopen/migration/owner isolation, stale writes, TTL, unchanged pending data, policy rejection recovery, post-acceptance lookup failure, media retry and session-switch regression coverage |

Backend changes: `apps/api/src/modules/claims/service.ts` and
`apps/api/test/{helpers,claims.integration.test,phase6.integration.test}.ts` enforce/test the
local owned/active policy boundary, atomic rejection and replay after policy deactivation.
No contracts, AWS resources, infrastructure or paid services changed. Documentation updated:
MOBILE_OFFLINE.md, PHASE_6_AUDIT.md, IMPLEMENTATION_MATRIX.md, IMPLEMENTATION_STATUS.md,
FAILURE_SCENARIOS.md and ARCHITECTURE_DECISIONS.md (ADR-018).

### Executed verification

| Command | Result |
|---|---|
| `npm run typecheck` | Passed across workspaces, including mobile SQLite-test TypeScript project |
| `npm run lint` | Passed across workspaces |
| `npm --workspace @northwind/mobile test` | Final run passed: Jest 45/45 (10 suites), SQLite/sync 34/34; no skips |
| `npm --workspace @northwind/api test` | 50 passed, including local Postgres/LocalStack HTTP integration |
| `npm test` | Passed: API 50/50, mobile Jest 44/44 and SQLite/sync 34/34; the final upload-stall regression was then added and the mobile command above passed 45/45 |
| `cd apps/mobile && npx expo export --platform ios --output-dir /tmp/mobile-claims-phase65-ios-final` | Passed; Hermes bundle and assets exported, not a signed native build |

The first sandboxed full-suite attempt could not connect to local Postgres (`EPERM`); rerun
with localhost permission passed. Earlier assertions expecting the old submitting copy and
SQLite schema version were updated to the deliberate new behavior. A policy TTL test initially
used an unsupported Jest dynamic import; replaced with a normal import. No assertion or test
was removed. `git diff --check` reported the pre-existing extra blank line at the end of
the root package.json; that unrelated user change was left untouched. Maestro initially needed combined-card selectors, field IDs and relative screenshot
paths; its number-pad `hideKeyboard` command is unsupported, so the visible Next action was used.
A real wizard-reset regression found during simulator recovery was fixed and covered by
`draft-navigation.test.tsx`, then reopening/queueing/restart/recovery passed.

Simulator: iPhone 16e, iOS 26.0, Expo Go against local Metro/API. Screenshots were actually
inspected for dashboard, policy selection, incident fields/number pad and recovery. The
`maestro test /tmp/phase65-save.yaml --debug-output /tmp/phase65-maestro-save` flow passed
saving an offline diagnostic draft. The
`maestro test /tmp/phase65-queue.yaml --debug-output /tmp/phase65-maestro-queue` flow passed
reopening the draft (checking its saved incident), queueing, stopping/reopening Expo Go with
an unreachable API URL, displaying Saved claims + Waiting to send, restoring the original
localhost API URL and automatic foreground recovery. Read-only simulator SQLite verified
`complete`, reference `NW-2026-000006`, original clientClaimId
`db265d5c-12e6-4435-90b0-3df3116c663f`; read-only local Postgres verified exactly **one** matching
claim. The API URL was restored to `http://localhost:3000`. This was not OS airplane mode.

`maestro test /tmp/phase65-detail.yaml --debug-output /tmp/phase65-maestro-detail` also passed:
load detail/history online, diagnostic offline, saved detail/history notices, cached policy
selection and restore online mode. Native library selection and upload recovery passed via
`maestro test /tmp/phase65-native-recovery.yaml --debug-output /tmp/phase65-maestro-native-final`:
selected a sample image, observed accepted/media-pending and the injected dropped-upload error,
stopped/reopened Expo Go, then opened NW-2026-000008 and asserted **Received · Not scanned**.
This performs a real file copy, SHA-256, native PUT to local storage and API completion after
restart. The failure is a diagnostic exception before PUT, not a real OS mid-byte interruption.
A first native run completed its upload but exposed a bigint progress render crash; explicit
numeric conversion and uploader regression tests fixed it, and the complete rerun passed.
After adding the 60-second idle cancellation, a further full native rerun passed using
`maestro test /tmp/phase65-native-final.yaml --debug-output /tmp/phase65-maestro-verified`,
with accepted claim NW-2026-000009 and confirmed document receipt after process restart.
Visual review also found duplicate server/local cards for accepted pending media; the dashboard
now gives the local recovery card precedence until completion, retaining one navigable entry.


### Remaining boundaries and assessment demonstration

- Offline reads require an existing unexpired stored session; first login or expired-token reauthentication needs the API.
- The dev sign-in still issues one seeded identity. Automated tests exercise A/B identity
  isolation, logout/login, old-token 401 and stopping an old sync run; no real second-account
  simulator login, Cognito, Entra or refresh-token flow is claimed.
- Historical unscoped DB/files are retained but unavailable to the new UI pending verified
  ownership recovery. Customer database/snapshot retention and storage encryption policy remain
  production requirements; hashing filenames does not encrypt customer data.
- The API checks local policy ownership/active status, not live policy coverage/incident-date
  eligibility. Offline snapshots never authorize coverage.
- Physical-device/LAN uploads, Android UI, VoiceOver/Dynamic Type matrix, signed native builds,
  OS background execution and production-scale pagination/performance remain unvalidated.
- The library picker is for photos; PDF is supported by manifest/storage validation but there
  is no new PDF picker. Files required for recovery are retained; no cleanup policy was added.
- No AWS infrastructure was deployed or tested. LocalStack and test fakes are labeled local
  substitutes throughout.

Demonstrate saved policy selection → offline draft → queued state → process restart with
unavailable backend → foreground recovery → accepted reference. For media recovery and status
tracking use MOBILE_OFFLINE.md's demo procedure and the exact validation boundaries in
FAILURE_SCENARIOS.md. The interview design table there and ADR-018 cover the problem,
choice, alternatives, benefits, trade-offs and failure behavior for each major decision.
