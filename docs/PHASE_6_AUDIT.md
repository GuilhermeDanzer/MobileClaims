# Phase 6 engineering audit

Baseline inspected before remediation: Phase 5 architecture/security documents, implementation
matrix, ADRs, failure scenarios, API/worker repositories and adapters, migrations, mobile
SQLite outbox/session/UI, stub and existing tests. Existing uncommitted work is preserved.

Backend evidence paths in the findings table are relative to `apps/api/src/`; mobile paths
are explicit. Function names identify relevant code locations.

## Findings (initial audit; disposition updated after validation)

| ID | Severity | Type | Evidence and defect | Remediation / disposition |
|---|---|---|---|---|
| P6-01 | Critical | Implementation | `db/idempotency-repo.ts:getIdempotency`, claims POST replay by globally keyed header without customer scope or body comparison; leaks another customer's response/upload URLs | Scope unique key and lookup by customer, reject changed body, serialize same-key requests |
| P6-02 | High | Implementation | `modules/claims/service.ts:createClaim` immediately publishes before documents complete; `worker/deliver.ts` has no readiness guard | Hold outbox until metadata validation completes; maintain media_pending and guard worker |
| P6-03 | High | Implementation | `worker/deliver.ts` redelivery repeats external call, timeline and notifications; success writes are separate | Per-claim lock, skip finalized delivery, commit outcome atomically; preserve external dedupe requirement for crash ambiguity |
| P6-04 | High | Implementation | `worker/reconcile.ts` event/status/parking separate, batch lease can expire while processing; stale poll may overwrite terminal state | Lease generation fencing and atomic status/event writes; stale response regression |
| P6-05 | Medium | Implementation / contract | Legacy identifier only in timeline label; adapter and stub query by reference | Persist returned number, retain verified local reference contract; real contract and dedupe unresolved |
| P6-06 | Medium | Documentation / limitation | Architecture/security imply scan/download gate implemented; local has no download endpoint or scanner | Document private quarantine, production clean-only gate and immutable-version requirement; retain not_scanned |
| P6-07 | Medium | Documentation | DR lacks queue reconstruction, assumes replication RPO and already available objects | Operator runbook, DB-based reconstruction, in-flight ambiguity, lag/consistency checks, targets only |
| P6-08 | Medium | Documentation | 99.9% SLO vs 99% five-minute alarm; ALB retries; 50 claims/s treated as capacity | Define windows/denominator, operational alarm, retry ownership, capacity assumptions |
| P6-09 | Medium | Documentation / limitation | Strangler percentage routing and rollback lack stable operation ownership | Sticky claim ownership, no dual writes, shadow read-only, drain existing accepted work |
| P6-10 | Medium | Implementation | Dashboard hides local media_pending once server lists claim; submission card omits detail; restart after completion response loss retries completed upload URL | Display pending evidence; reconcile authoritative document completion before retry |
| P6-11 | High | Implementation | `server.ts` creates local issuers even with AUTH_MODE=real/production | Fail closed for unsupported production/real mode; no false federation claim |
| P6-12 | Medium | Implementation | Zod validation errors return 500; JWT exp/sub not required | Return safe 400, require exp/sub claims |
| P6-13 | High | Implementation | `db/queue-repo.ts:failMessage` inserts DLQ then deletes separately; stale consumers can acknowledge new leases | Atomic DLQ movement and attempt fencing for worker acknowledgments |
| P6-14 | Medium | Implementation | Object keys use filename; duplicate names alias bytes and mobile matching | Unique object keys; reject duplicate names rather than silently remap evidence |
| P6-15 | Medium | Documentation / limitation | `audit_events` exists but no writer/immutability control; employee has only /me, no evidence route; dev auth no refresh; claims of full controls unsupported | Correct implementation claims and record production follow-ups |
| P6-16 | Medium | Business ambiguity | No approved→denied rule or timestamp ordering contract; denied/closed are only documented terminal states | Preserve approved as nonterminal mirror; require owner decision, fence terminal state; do not invent adjudication rules |
| P6-17 | Medium | Implementation | `db/migrate.ts:migrate` API/worker startup can concurrently apply the same migration | Serialize the runner with a DB advisory lock; test fresh/rerun/concurrent/failed/Phase 5 upgrade paths |
| P6-18 | Medium | Implementation | `apps/mobile/src/features/sync/use-sync.tsx:SyncProvider` no timer wakes persisted backoff while app stays active | Foreground five-second retry tick, single-flight preserved, errors visible in Settings, timer cleanup test |
| P6-19 | Medium | Architectural limitation | `apps/mobile/src/features/claims/use-claims.ts` writes SQLite cache but never hydrates it; SQLite/query cache are not customer-partitioned, policy cache absent | Remediated in Phase 6.5: schema-validated SQLite snapshots hydrate customer-scoped query keys; per-issuer/subject databases isolate all cache/outbox records; policy TTL and session fences tested. Historical unscoped DB is quarantined, not reassigned. See MOBILE_OFFLINE.md |
| P6-20 | Medium | Implementation | `object-storage.ts:presignPut` SDK excludes content-type signing by default despite code/docs claiming it was signed | Explicit signableHeaders for content-type/content-length; assert signed headers and metadata rejection in storage integration tests |

Counts: **20 confirmed findings: 1 Critical, 5 High, 14 Medium, 0 Low**.
All Critical/High implementation defects are remediated. P6-05/06/15/16/19 retain external,
production or business dependencies described below; documented limitations are not claimed
as implemented controls. Other findings are remediated in code/docs and regression tests.

False-positive/already-handled concerns: no local GET/download evidence route exists, so
there is no current adjuster download bypass. Claim creation/document metadata/outbox already
commit in one transaction; customer-owned reads already scope the aggregate. Cross-region SQS
replication was never implemented; approved was never documented as terminal. Missing coverage,
not a proven adjudication defect, is the approved→denied issue. A nonexistent
`apps/api/src/worker/src/deliver.ts` in the request resolves to `src/worker/deliver.ts`.

## Validation and remaining risks

Remediation and validation completed for the local scope; see results below. Local tests cannot validate AWS availability, regional DR,
real identity federation, WAF, push delivery, malware scanning or production legacy semantics.

## Changes and rollout

Backend files changed (under `apps/api`):

- `src/object-storage.ts`: explicitly sign declared type/length (SDK default excluded type).

- `src/db/idempotency-repo.ts`, `src/modules/claims/routes.ts`: customer-scoped body-checked
  replay, serialized same-key access using the same connection as creation (no pool starvation).
- `src/modules/claims/service.ts`, `src/db/outbox-repo.ts`: unique object keys, duplicate-name
  validation, media_pending until all documents validate, publisher readiness filter.
- `src/worker/deliver.ts`, `src/db/claims-repo.ts`: row-locked delivery, finalized outcome
  short-circuit, atomic state/event/notification and persisted legacy_claim_number. Hold a DB
  connection/row lock during the bounded external call: a deliberate small-change throughput
  trade-off. HTTP 400/422 retain permanent rejection; 401/403/408/409/429 now retry rather than
  falsely rejecting a claim. Real rejection/retry mapping still needs integration confirmation.
- `src/worker/reconcile.ts`, `src/db/claims-repo.ts`: lease generations fence expired polls;
  timeline/status/parking commit together, failure backoff cannot reopen terminal claims.
- `src/db/queue-repo.ts`, `src/worker.ts`: atomic DLQ movement, attempt-fenced acknowledgments
  and failures, capped exponential worker retry delay. Publisher remains at-least-once; a
  crash between enqueue and marking published may duplicate messages, safely handled locally.
- `src/db/migrate.ts`: serialized startup migrations, transaction rollback on failed DDL.
- `src/server.ts`, `src/platform/auth/verify.ts`: fail-closed unsupported auth modes,
  required exp/sub, safe validation 400s, pool/storage cleanup on server close.
- `src/integrations/legacy/http-gateway.ts`: validate successful responses against existing
  interface fields rather than accepting malformed external data as a delivery acknowledgment.
- Tests: modified `test/auth.test.ts`, `claims.integration.test.ts`,
  `deliver.integration.test.ts`, `queue.integration.test.ts`, `reconcile.integration.test.ts`;
  added `phase6.integration.test.ts`, `migrations.integration.test.ts`,
  `smoke.integration.test.ts`, `legacy-adapter.test.ts`.

Mobile files changed (under `apps/mobile`): `src/features/sync/sync-engine.ts`,
`use-sync.tsx`, new `use-sync.test.tsx`; `src/features/claims/status-copy.ts`, its tests,
`claim-card.tsx`, `submission-card.tsx`; `src/app/(tabs)/settings.tsx`;
`test-db/sync-engine-failures.test.ts`. Accepted and evidence-pending remain distinct;
server cards display pending evidence even when the duplicate local card is hidden.
Completion-response loss recovers from server state. Missing document mapping parks visibly.

Migration added: `apps/api/src/db/migrations/005_phase6_safety.sql` preserves existing
responses, replaces the global idempotency primary key with (customer_id, idempotency_key),
adds nullable legacy_claim_number and reconcile_generation, and holds previously undelivered
incomplete claims. No mobile migration or dependencies added. Upgrade/rerun/failure rollback
are tested. No destructive down migration: retain expanded columns/key and deploy compatible
code forward; old globally-scoped idempotency code is unsafe to roll back to. Pause old API/
workers before upgrade. Review preexisting published pending claims/queue/DLQ inventory:
old messages may already have exhausted retries; after uploads complete, safely redrive or
re-enqueue the same claim/reference. Already delivered claims are not rewound. Historical
legacy numbers in timeline labels require verified manual backfill, not guessed parsing.

Documentation: updated `ARCHITECTURE.md`, `SECURITY_AND_RELIABILITY.md`, this report,
`ARCHITECTURE_DECISIONS.md` (conditional DR target), `FAILURE_SCENARIOS.md` (real controls/test
paths), `IMPLEMENTATION_STATUS.md` (historical snapshot correction), and
`diagrams/failure-recovery.mmd`. Canonical recovery procedure is Security §3.11, not a new
competing architecture. Docker Compose and LocalStack 3.8.1 remain untouched.

## Remaining risks and ownership

- **Legacy owner:** prove durable deduplication, retention and lookup contract. Local stub
  deduplication is in-memory and duplicate fault bypasses it; no local code can guarantee an
  external exactly-once effect after commit/response loss. Safest production behavior with
  unverified A2: pause ambiguous operations, inspect legacy by reference/number, repair local
  acknowledgment or explicitly approve resend. No automated twin detector exists.
- **Claims business owner:** decide approved→denied/reopening rules and provide an ordered
  source version/timestamp contract. Safest current behavior mirrors legacy as approved is
  nonterminal, parks denied/closed, and rejects stale lease results. Nonterminal source
  regressions remain possible; do not invent a local adjudication rule or DB CHECK sequence.
- **Security/platform owners:** production quarantine/scanner, checksum/version binding,
  bucket policies, identity federation, employee operations/RBAC, immutable emitted audit,
  full PII log review, WAF/rate limits, tracing, encryption/retention and push are not validated
  locally. Local complete never implies clean. PUT overwrite until expiry and declared-only
  SHA-256 remain explicit local limitations; no consumer download API exists.
- **Mobile/product owners:** Phase 6.5 adds persistent read hydration, policy snapshots,
  per-identity database/query isolation and session fences. Local login still issues one
  seeded identity; multi-identity UI is not claimed. Access-token expiration requests login;
  no refresh-token or OS background guarantee. Historical unscoped records are retained but
  quarantined. See the Phase 6.5 validation section for actual simulator coverage.
- **Policy integration owner:** local intake checks ownership and active status against the
  local policy snapshot. Live policy revalidation, incident-date/coverage rules and the
  unavailable-policy-system business decision still require a verified domain contract.
- **Operations/DBA:** rehearse fenced regional promotion, DB/queue/object/legacy reconciliation,
  monitor replication lag, establish actual loss window. RPO 5 min/RTO 1 h are conditional
  targets; neither object replication nor SQS recovery has been proven. Run production load
  tests before capacity commitments; 2/50 claims/s are assumptions. Worker DB failures may
  terminate the process; local operator/production supervisor must restart it. Local auth and
  fault controls are intentionally unauthenticated demo endpoints; do not expose local mode.

Assessment: **Ready with documented limitations for final documentation and presentation**.
No unresolved local Critical/High defect is known after this audit; this is not production
readiness. Phase 7/presentation/video have not started; await user approval for that phase.

## Executed validation commands

All commands below ran from `/Users/guidanzer/Dev/MobileClaims`. Latest results observed on
2026-11-07; no skipped tests. Backend and SQLite scripts use serial Node execution.

| Exact command | Observed result |
|---|---|
| `docker compose -f infra/local/docker-compose.yml ps` | Initial sandbox attempt failed: docker.sock connect operation not permitted. Approved rerun passed: Postgres 16 and localstack/localstack:3.8.1 healthy |
| `npm --workspace @northwind/api test` | Initial sandbox attempt failed in DB setup with pg AggregateError EPERM (and after-hook pool undefined). Approved local-network reruns passed: 29, then 41, 44, 47, 48, finally **49 tests passed, 0 failed/skipped**, final duration 6431 ms |
| `npm --workspace @northwind/mobile test -- --runInBand` | Passed 26 Jest + 26 SQLite tests at that stage; npm warned --runInBand was forwarded as unknown CLI config. Used ordinary mobile test command subsequently; SQLite remained serial |
| `npm --workspace @northwind/mobile test` | First newly-added timer test failed Jest mock-factory scope validation; corrected test setup. Latest run: **5 suites / 27 Jest tests passed**, plus **26 SQLite tests passed**, zero failed/skipped |
| `npm run typecheck` | Interim failures: unknown error.statusCode access in server handler; later async render().unmount type mismatch in new test. Both corrected. Latest run **passed all four workspaces**, including mobile test-db tsconfig |
| `npm run lint` | Interim failures in new timer test (render side effect) and sync mount effect; corrected without disabling rules. Latest run **passed API ESLint, mobile expo lint, stub ESLint** |
| `git diff --check` | Failed on **preexisting, untouched `package.json:27: new blank line at EOF`**. Left unrelated working-tree content intact. Does not inspect untracked files |

Backend test script executed exactly:
`node --import tsx --test --test-concurrency=1 "test/*.test.ts"` in `apps/api`.
Mobile test script executes `jest`, then
`node --import tsx --test --test-concurrency=1 "test-db/*.test.ts"` in `apps/mobile`.
Typecheck runs workspace `tsc --noEmit` (mobile also `tsc --noEmit -p tsconfig.test-db.json`);
lint runs ESLint / `expo lint` through configured workspace scripts.

Relevant evidence in the final backend run:

- Fresh migrations + concurrent startup + rerun, injected DDL rollback, Phase 5 data upgrade.
- Tenant-scoped key replay/conflict/expiration, owned reads and employee rejection, **20
  simultaneous keyed submissions with one claim/outbox**; no claim creation capacity claim.
- Expired/missing-subject/missing-expiration/tampered token denial.
- Incomplete/mismatched evidence blocked, explicit signed type/length headers, not_scanned
  preserved, duplicate filenames refused, object PUT/completion via real LocalStack.
- Concurrent and repeated delivery yields one local outcome; ambiguous timeout/429 retry
  retains reference; injected notification failure rolls back full delivery outcome.
- Queue retry/DLQ and stale attempt fencing; reconciliation retry/recovery/concurrent lease
  and expired poll cannot overwrite denied or append stale approved event.
- `smoke.integration.test.ts` runs the README health/auth/policy flow through Fastify injection,
  extends it to S3 PUT/completion and queue/reconciliation, and calls the real HTTP adapter
  against an ephemeral local stub listener. Worker operations are driven deterministically;
  this does not exercise the infinite worker main loop, real phone UI or an AWS deployment.

Relevant final mobile evidence: interrupted submission/upload, offline no-send, partial-progress
retry, authentication retry, completion acknowledgment lost across restart, missing document
mapping, evidence-pending copy, active retry timer/error display and timer cleanup. SQLite
uses node:sqlite (runtime emits its ExperimentalWarning); no claim of real-device validation.

Source checks used the installed Expo major **58**, matching SDK reference and router docs:
[SDK 58](https://docs.expo.dev/versions/v58.0.0/),
[Expo documentation index](https://docs.expo.dev/llms.txt),
[Router SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/router/).
AWS production design references are linked in Security §2.5 and §3.11. One attempted SQS
resiliency documentation URL was inaccessible; no deployment or live AWS request was made.


## Phase 6.5 disposition

P6-19 was verified against the hooks before changes: the dashboard and policies had no
persistent hydration; detail used a competing screen-only SQLite fallback. Current hooks
share one snapshot hydration path, and the screen fallback was removed. Acknowledgment is
now durable before media lookup; old sessions cannot start later operations under a new
identity. Outbox retries/IDs/backoff and two-phase media completion remain intact. The only
backend scope change checks existing policy ownership/active fields at intake; it adds no
coverage rule and preserves accepted replay semantics.

Phase 6 test counts above are historical. Current executed commands, test counts, simulator
scope and failure-scenario classifications are in IMPLEMENTATION_STATUS.md and
FAILURE_SCENARIOS.md (Phase 6.5 sections). No cloud validation is implied.
