# Development Plan

Phases are executed in order. Each phase ends at a **gate** that must actually pass before
the next begins. "Pass" means the command ran and succeeded; a command that was not run is
reported as *not run*, never as green.

## Guiding principles

1. Human readability over abstraction. A reviewer should understand any file in minutes.
2. Simplest thing that meets the requirement; no microservices, no speculative patterns.
3. Every external dependency sits behind a named business boundary (ObjectStorage,
   MessageQueue, IdentityProvider, NotificationProvider, LegacyClaimsGateway).
4. Nothing is described as implemented unless it runs and is tested locally.
5. Small, focused commits; one architectural concern per change.

## Phase map

| Phase | Focus | Primary gate |
|---|---|---|
| 1 | Documentation + diagrams (this) | Reviewer approval |
| 2 | Foundation: monorepo, config, contracts, schema, local env, auth verifier | `typecheck` + `lint` + `test` + `expo export` green; `docker compose up` healthy; `GET /v1/me` correct |
| 3 | Core backend: claims, idempotency, documents, outbox, queue, worker, legacy gateway | Integration tests incl. replay, duplicate, legacy-down, DLQ |
| 4 | Mobile: wizard, SQLite outbox, sync engine, upload progress, timeline | Outbox/offline/idempotency tests; `tsc`/`lint`/`export` clean |
| 5 | Local environment & reliability | One-command demo from a clean checkout |
| 6 | Validation report | Every failure scenario marked tested/simulated/theoretical |
| 7 | Final docs + presentation | Docs cross-checked against code |

## Phase 2 — Foundation

Order of work (each step is a commit):

1. Move the Expo app to `apps/mobile` (`git mv` for `app.json`, `assets/`, `src/`,
   `tsconfig.json`, `scripts/`; rewrite `package.json` as `@northwind/mobile`).
2. Create root `package.json` (`workspaces: ["apps/*", "packages/*"]`, fan-out scripts),
   `tsconfig.base.json`, `packages/contracts` (zod schemas + domain types).
3. `apps/api` skeleton: Fastify, pino structured logs, error envelope, config loader,
   `/health`, `/v1/app-config`, `/v1/me`, two local issuers + `jose` verifier, RBAC policy.
4. `apps/onprem-stub` skeleton: `/health`, `/dev/faults`, seeded policies, placeholder
   claim create/status.
5. Postgres schema + migration runner (see `ARCHITECTURE.md` §4); `infra/local/docker-compose.yml`
   (Postgres 16 + LocalStack).
6. ESLint (`eslint-config-expo/flat` for mobile, shared flat config for API/stub), Jest 30 +
   jest-expo + `@testing-library/react-native` 14 for mobile, `node --test` + `tsx` for API.
7. Rewrite root `README.md` with run instructions.

Gate: `npm install` → `npm run typecheck` → `npm run lint` → `npm test` →
`npx expo export --platform ios` → `docker compose up -d` → `curl /health` → dev login →
`GET /v1/me` returns the expected actor.

## Phase 3 — Core backend (`apps/api`)

Modules, in dependency order:

1. `claims` — create (validated), get, list, status + events timeline.
2. `idempotency` — `clientClaimId` unique index + replay; `Idempotency-Key` header support.
3. `documents` — presign upload, `complete` confirmation, size/type validation, `not_scanned` flag.
4. `outbox` + `queue` — transactional outbox, publisher, Postgres queue (visibility
   timeout, attempts, delay, DLQ).
5. `worker` — drain queue, call `LegacyClaimsGateway`, reconcile status, record notifications.
6. `integrations/legacy` — `HttpLegacyClaimsGateway` + `SimulatedLegacyClaimsGateway` +
   circuit breaker.
7. `notifications` — inbox table + dev trigger.
8. `observability` — correlation IDs, `/dev/metrics`, threshold alert records.

Gate: integration tests against real Postgres covering 201-then-200 replay, concurrent
duplicate submission, legacy down/slow/reject, DLQ, recovery.

## Phase 4 — Mobile (`apps/mobile`)

1. Route shell: `(tabs)` list + diagnostics, modal stack for new claim, `claims/[claimId]`.
2. SQLite layer: drafts, outbox, cached claims, status events; migrations.
3. New-claim wizard: policy → incident → photos → review (RHF + shared zod schemas).
4. Photo capture (`expo-image-picker`) + copy into app storage (`expo-file-system`).
5. Sync engine: claim-first submission, presigned upload with progress, retry/backoff,
   network-recovery triggers, `force offline` toggle.
6. Claims list + detail timeline + upload progress + status copy mapping.
7. Version gate (`/v1/app-config`), diagnostics screen.

Gate: mobile tests for outbox state machine, offline/reconnect, retry exhaustion, upload
interruption, idempotent replay; `tsc --noEmit`, `expo lint`, `expo export` clean.

**Gate result (executed):** `tsc --noEmit` clean (app + test-db projects), `expo lint` clean,
`expo export --platform ios` bundles. Mobile suites: 21 logic tests (jest) + 24 SQL/sync tests
(node:sqlite, real SQLite) pass. Offline, retry, idempotent replay, upload interruption, and
crash recovery are covered in `apps/mobile/test-db/sync-engine*.test.ts`.

## Phase 5 — Local environment & reliability

- Hardened compose (healthchecks, named volumes, fixed ports), seed script, `.env.example`.
- One-command demo script (`npm run demo`) that boots everything and walks the happy path.
- Dependency-free load script (`apps/api/scripts/load-test.ts`) demonstrating 429 backpressure.
- README quickstart validated from a clean checkout.

Gate: `npm run demo` succeeds end-to-end with no AWS credentials.

## Phase 6 — Validation

Run the full `FAILURE_SCENARIOS.md` matrix. Produce `docs/TESTING_AND_VALIDATION.md` with
each scenario marked **tested** (command + output), **simulated** (which substitute), or
**theoretical** (design only). Anything not run is listed as not-run.

## Phase 7 — Final documentation & presentation

`SECURITY.md`, `OBSERVABILITY.md`, `MOBILE_OFFLINE.md`, `INTEGRATION.md`, `MIGRATION.md`,
`TESTING_AND_VALIDATION.md`, final diagrams, and `PRESENTATION.md` (video outline + speaking
notes). Cross-check every claim against the code.

## Conventions

| Concern | Convention |
|---|---|
| Naming | descriptive; kebab-case files; PascalCase components; domain terms (`claim`, `document`, `draft`, `outbox`) used consistently |
| Folder | routes in `src/app`; features in `src/features`; shared in `src/lib`, `src/db`, `src/components`; API modules in `src/modules`, platform in `src/platform` |
| Errors | single `ApiError` envelope `{ error: { code, message, correlationId } }`; domain error codes in `packages/contracts` |
| Logging | pino structured JSON; redact bodies and PII; always carry `correlationId` |
| API responses | consistent envelope; `201` create, `200` idempotent replay, `429` with `Retry-After` |
| Validation | zod at the boundary; no ad-hoc checks in handlers |
| Types | strict; no `any`; separate wire types (in `packages/contracts`) from internal models where they differ |
| Testing | API: `node --test` + real Postgres for integration; mobile: jest-expo + RTL 14; one `__tests__` per module |
| Docs | updated in the same change that alters behaviour |

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Monorepo move breaks the Expo app | Med | High | Gate with `tsc` + `expo export`; single revert |
| Legacy contract unknown; simulation mistaken for real | High | High | Adapter port + `SIMULATED` labeling + contract tests |
| Presigned PUT size not strictly enforced | Med | Med | Signed `content-length`/`content-type`; post-upload `HeadObject` check + quarantine |
| iOS background execution unreliable | High | Med | Correctness never depends on it; foreground sync is the guarantee |
| jest-expo 58 / RTL 14 / React Compiler incompatibilities | Med | Med | Pin versions, smoke-test a trivial test early |
| No Postgres without Docker | Med | Med | Integration tests skip loudly; reported not-run |
| Fault toggles leak to a "real" path | Low | High | `/dev/*` routes registered only when `APP_ENV=local` |
