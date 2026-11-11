# Architecture Decisions

A numbered, append-only log. Every significant decision records **what**, **why**,
**alternatives considered**, **trade-offs accepted**, and **what happens when it fails**.
Status: all ADRs are *Accepted* unless marked otherwise.

---

## ADR-001 — Repository structure: npm workspaces monorepo

**Chosen:** one repository with `apps/mobile`, `apps/api`, `apps/onprem-stub`, and
`packages/contracts`, wired through npm workspaces.

**Why:** the mobile app and API must share one claim-status vocabulary and one set of zod
schemas. Duplicated enums are the most common cause of "the screen says X, the database
says Y".

**Alternatives:** a single package with the Expo app at root (shared contracts become path
hacks); separate repositories (no atomic contract change).

**Trade-offs:** a one-time move of the existing Expo app and a reinstall at the root; Metro
handles monorepos automatically since SDK 52, so no `metro.config.js`.

**When it fails:** a workspace resolves a package incorrectly. Mitigation: the Phase 2 gate
runs `tsc --noEmit` + `expo export` before any domain code; rollback is a single revert.

---

## ADR-002 — SQLite (`expo-sqlite`) as the durable local store

**Chosen:** drafts, outbox items, cached claims, and status events live in on-device
SQLite, not AsyncStorage.

**Why:** the outbox is a queue with per-item retry state, ordering, and partial-progress
rows. SQLite gives transactions, indexes, and queries; AsyncStorage would force a hand-rolled
JSON blob with no atomic multi-row updates.

**Alternatives:** AsyncStorage/MMKV (no queries/transactions); WatermelonDB (an ORM layer we
don't need).

**Trade-offs:** SQL in the repo and a `user_version`-based migration mechanism.

**When it fails:** a migration bug loses local data. Mitigation: migrations are additive and
tested; the outbox can always be rebuilt from the server, which is the source of truth.

---

## ADR-003 — Two-phase submission: claim first, media second

**Chosen:** `POST /v1/claims` returns a reference number and per-document presigned URLs
immediately; photographs upload afterward; a `complete` call marks each document done.

**Why:** a reference must exist before 8 MB of photos finish on poor connectivity. This
decouples "we have your claim" from "we have your bytes".

**Alternatives:** upload-then-create (no reference until done; whole submission lost if the
last upload fails); proxy bytes through the API (Fargate pays for every customer's photos).

**Trade-offs:** an extra `media_pending` state and a per-document confirmation call.

**When it fails:** the claim is accepted but uploads never complete. Mitigation: the claim
remains visible as "Submitted" with a "photos still uploading" label, and the outbox retries.

---

## ADR-004 — Idempotency from a client-generated `clientClaimId`

**Chosen:** the mobile app mints a UUID once per draft, persists it before the first send,
and reuses it forever; the API enforces a unique index on `(customer_id, client_claim_id)`
and returns the same claim on replay.

**Why:** retries are normal, so duplicate claims must be structurally impossible rather than
handled in code.

**Alternatives:** server-assigned ID with client-side dedupe (a lost response creates an
orphan claim); reliance on the legacy system to dedupe (violates ADR A3).

**Trade-offs:** the client must persist the ID before the first attempt (it does, in the
same SQLite transaction as the claim row).

**When it fails:** a client regenerates the ID on every retry — mitigated by a test asserting
ID stability across retries.

---

## ADR-005 — Transactional outbox + a message-queue boundary

**Chosen:** accepting a claim and writing an `outbox_events` row happen in one Postgres
transaction; a publisher drains the outbox into a `MessageQueue` boundary. Locally the queue
is a Postgres table with visibility timeout, attempts, delay, and a dead-letter queue;
production publishes to SQS.

**Why:** "claim accepted" and "will be sent to legacy" must commit atomically; a direct
publish can't join the DB transaction (dual-write → lost or phantom events).

**Alternatives:** direct SQS publish in the request (dual-write); EventBridge-first (extra
hop for one consumer group).

**Trade-offs:** a poller process; the local queue reproduces delivery *semantics* but not SQS
*throughput characteristics* (see ADR-014).

**When it fails:** the publisher dies. Mitigation: the outbox row is durable; a second
process can take over because claiming a row is atomic (`FOR UPDATE SKIP LOCKED`).

---

## ADR-006 — Push + pull for status; no WebSockets/SSE

**Chosen:** status changes reach the customer by push notification (a hint) and are always
readable by pull (`GET /v1/claims/{id}/events?since=`) on app foreground and refresh.

**Why:** status changes are minutes-to-days apart; a persistent socket costs battery,
connection state, and a stateful gateway tier, and buys nothing over a push. Pull keeps
status correct when push silently fails.

**Alternatives:** WebSockets/SSE (justified only for live adjuster chat, not a requirement).

**Trade-offs:** worst-case status latency is the push delay; the UI shows "last updated" so
a missing push is not mistaken for a missing update.

**When it fails:** push is down. Mitigation: the timeline is fully available by pull, so no
customer information is lost.

---

## ADR-007 — TanStack Query for server state; no Zustand

**Chosen:** server state (claims, status events, policies) flows through TanStack Query;
the outbox/queue is read from SQLite through query functions. No Zustand in v1.

**Why:** two client-state libraries plus a queue mirrored in memory is how staleness bugs
appear. The queue's canonical state is SQLite; the UI observes it via queries.

**Alternatives:** Zustand/Redux mirror of drafts and queue (duplication + reconciliation).

**Trade-offs:** slightly more invalidation discipline.

**When it fails:** a screen reads stale queue state. Mitigation: invalidation after every
sync-engine mutation, tested.

---

## ADR-008 — React Hook Form + zod, schemas shared in `packages/contracts`

**Chosen:** form state via React Hook Form; validation via zod schemas published from
`packages/contracts` and used by both the form and the API.

**Why:** one source of truth for validation rules; no drift between what the form accepts
and what the API rejects.

**Alternatives:** manual validation (duplicates the rules); Yup (already standardized on zod
in the contracts package).

**Trade-offs:** one dependency + a resolver, both justified.

**When it fails:** a schema change breaks an older app version. Mitigation: additive-only
schema evolution and tolerant parsing (unknown enum values render as "Updated").

---

## ADR-009 — Hand-written circuit breaker for the legacy boundary

**Chosen:** a ~40-line, unit-tested circuit breaker (closed → open → half-open) guarding the
single legacy call site.

**Why:** a down legacy system must not consume all worker capacity. One call site deserves an
obvious, readable implementation rather than a framework.

**Alternatives:** `opossum` (fine, but more machinery than one call site needs); no breaker
(retries alone would pile up and stall the queue).

**Trade-offs:** we own the half-open transition logic and must test it.

**When it fails:** the breaker misbehaves. Mitigation: dedicated unit tests for each state
transition.

---

## ADR-010 — Fastify + `pg` with plain-SQL migrations

**Chosen:** Fastify for the API (schema-first validation, structured logs, low overhead);
`node-postgres` with hand-written SQL files and a tiny `user_version`-style runner.

**Why:** hand-written SQL is the clearest possible description of a six-table schema and
keeps the data model inspectable. Fastify avoids the decorator/DI ceremony of heavier
frameworks.

**Alternatives:** NestJS (DI + decorators for a monolith this size is ceremony);
Prisma/Drizzle (codegen and a build step to read the schema); Lambda (cold starts and
connection management for a long-lived DB workload).

**Trade-offs:** more SQL by hand; we own a ~30-line migration runner.

**When it fails:** a migration fails. Mitigation: migrations are additive, run in a
transaction, and are exercised by CI integration tests.

---

## ADR-011 — One object-storage path: S3 client against LocalStack locally

**Chosen:** a single `ObjectStorage` implementation using `@aws-sdk/client-s3` and the
presigner, configured with `forcePathStyle` and an `endpoint` pointing at LocalStack locally and
S3 in production. No separate disk-backed adapter.

**Why:** presigned-PUT semantics (expiry, size/type constraints, direct-to-store bytes) are
hard to fake and are the core of the upload design; running the real client against LocalStack
means the upload path is exercised, not emulated.

**Alternatives:** a local disk adapter (bytes transit the API, unlike production); two
storage adapters (one untested in production).

**Trade-offs:** one extra container (LocalStack) in the compose file.

**When it fails:** LocalStack is unreachable. Mitigation: the API fails fast with a clear
startup error and health check, and the README documents it.

---

## ADR-012 — Legacy gateway: HTTP adapter against a local stand-in

**Chosen:** `LegacyClaimsGateway` has an `HttpLegacyClaimsGateway` (real HTTP, idempotency
key, timeouts) pointed at `apps/onprem-stub` locally, plus a `SimulatedLegacyClaimsGateway`
for deterministic unit tests.

**Why:** the HTTP adapter is production code and should be exercised over a real network
boundary; the stub's fault controls make it demoable. The simulator keeps unit tests fast
and socket-free.

**Alternatives:** only an in-process simulator (the HTTP path would never be tested); calling
a fake and presenting it as real (violates the labeling rule).

**Trade-offs:** a fourth workspace app (~100 lines).

**When it fails:** the stub returns an unexpected shape. Mitigation: the stub is versioned
against `packages/contracts`, and a contract test fails on drift.

---

## ADR-013 — No Infrastructure-as-Code deliverable

**Chosen:** the production topology is documented (topology, limits, scaling math, DR
runbook, per-service failure behaviour) rather than expressed as Terraform or CDK.

**Why:** the challenge explicitly makes IaC optional and warns against infrastructure code
"simply to demonstrate familiarity". Without AWS there is nothing to validate it against,
and the documentation is the part a reviewer scrutinises.

**Alternatives:** Terraform modules (unvalidatable here, no applied value); CDK (same).

**Trade-offs:** no machine-checked infrastructure definition.

**When it fails:** — nothing is deployed; the docs are the deliverable and are reviewed by a
human.

---

## ADR-014 — Postgres-backed queue instead of Redis/ElasticMQ

**Chosen:** the local message queue is a Postgres table using `FOR UPDATE SKIP LOCKED`,
with visibility timeout, attempt counts, delayed delivery, and a dead-letter table.

**Why:** deterministic, dependency-free, and testable; it reproduces the delivery semantics
we need without another container or an SQS emulator.

**Alternatives:** Redis/BullMQ (one more service; real, but heavier than needed);
ElasticMQ (an SQS-compatible container; the most faithful, but adds a less-known tool and
still does not reproduce SQS scale).

**Trade-offs:** it does not reproduce SQS throughput or scale characteristics — stated
explicitly wherever the queue is discussed.

**When it fails:** a long transaction blocks the poller. Mitigation: short, single-row
transactions and a bounded poll loop.

---

## ADR-015 — Local JWT issuers behind the production verifier

**Chosen:** two local issuers (customer and employee) sign RS256 JWTs and publish JWKS;
the API verifies every token with `jose` against issuer + audience, exactly as it would for
Cognito or Entra ID.

**Why:** the verification boundary is the security-critical part and must be real; only the
issuer is local, and customer/employee separation must be demonstrated, not asserted.

**Alternatives:** mock authentication middleware (the RBAC path would never be tested);
a Keycloak/OIDC container (correct but heavier than the constraint requires).

**Trade-offs:** the local issuers are gated on `AUTH_MODE=dev` and refuse to start in any
other mode.

**When it fails:** a token is signed with a mismatched audience. Mitigation: verification
tests cover audience/issuer/expiry rejection.

---

## ADR-016 — Status reconciliation via leased polling

**Chosen:** a reconciliation loop in the existing worker that periodically leases due claims
(`intake_status = 'legacy_accepted'` with a past `reconcile_at`), polls the legacy system's
`getStatus(reference)`, and appends changed statuses to the timeline. A
`FOR UPDATE SKIP LOCKED` lease (`reconcile_at` advanced into the future) prevents concurrent
workers from reconciling the same claim, and all state lives in Postgres, so it survives
restarts.

**Why:** the legacy system cannot push status events (assumption A1), so the platform must
poll. The timeline is append-only, so deduplication needs a persisted "last known status"
(`claims.legacy_status`) rather than a fragile comparison against the latest timeline event
(which interleaves platform and legacy events).

**Alternatives:** a dedicated cron/scheduler (new infrastructure); pushing reconciliation
tasks through the message queue (more moving parts for a periodic job); comparing against the
latest timeline event (fragile once platform events interleave).

**Trade-offs:** polling latency is bounded by the poll interval (15 s default, adjustable);
the lease adds `legacy_status`, `reconcile_at`, and `reconcile_attempts` columns; the terminal
status set (`denied`, `closed`) is hardcoded and documented.

**When it fails:** the worker is down → claims are simply not polled until it returns (state
is durable in Postgres). A poll failure backs off and never mutates the claim, so an accepted
claim is never invalidated; the circuit breaker pauses reconciliation while the legacy system
is known down.

---

## ADR-017 — Production database: RDS PostgreSQL Multi-AZ + RDS Proxy (not Aurora)

**Chosen:** the production database is **RDS for PostgreSQL, Multi-AZ**, fronted by **RDS
Proxy**, with a **cross-region read replica** in `us-west-2` for disaster recovery. **Aurora
PostgreSQL Multi-AZ** and **Aurora Global Database** are documented as the upgrade path, not
the default.

**Why:** the load profile (assumption A8) is ~2 claims/second normal and ~50 claims/second
for a few hours during a storm — well within a single RDS Multi-AZ instance. RDS is cheaper
and simpler to operate than Aurora at this scale; RDS Proxy keeps the Postgres connection
count bounded and independent of Fargate task count, and smooths failover. A cross-region read
replica supports the planned DR targets (RTO 1 h, RPO 5 min), conditional on replication lag and operator recovery, without Aurora Global
Database.

**Alternatives:** Aurora PostgreSQL Multi-AZ (faster failover and more headroom, but more cost
and complexity than the problem requires); Aurora Global Database (sub-5 s cross-region RPO,
but only justified if recovery-point requirements tighten).

**Trade-offs:** cross-region failover is a manual promote (pilot-light) rather than Aurora's
managed global failover; in-region failover (seconds to a minute) is unchanged.

**When it fails:** promote of the cross-region replica is not automatic. Mitigation: a
documented runbook in `SECURITY_AND_RELIABILITY.md` §3.11 and a periodic game-day exercise.





## ADR-018 — Customer-owned response snapshots and session-fenced recovery

**Chosen:** additive SQLite v2 `read_snapshots`, one hydration hook and customer-scoped
TanStack Query keys; one database file per SHA-256 JWT issuer/subject namespace. The
historical unscoped database is kept quarantined. Logout clears memory/tokens but retains
the owner's durable queue/files. Sync keeps the original token and stops new remote steps
when its session changes. Save backend acknowledgment before fetching document metadata.

**Why / advantages:** offline reads survive process death without a new global store;
server payloads and freshness timestamps are preserved. A small file boundary isolates
all existing repositories without duplicating owner checks. Accepted claims survive a
later lookup/upload failure and recover with their original IDs.

**Alternatives:** owner columns and predicates on every table/repository (larger migration
surface); generic React Query persistence (additional persistence lifecycle); reconstruction
from normalized summaries (cannot guarantee a previously fetched full detail/history).

**Trade-offs:** database handles/files remain for previously used identities; response
payloads are blobs with no retention/size policy yet. Hashing a namespace is not encryption.
Quarantined historical drafts need verified ownership recovery rather than automatic adoption.
Already-sent requests may finish using the old token; local isolation is not remote logout
revocation. Production storage protection and federation remain separate requirements.

**When it fails:** missing/corrupt snapshots produce useful unavailable states; hydration
cannot replace existing memory data, and older responses cannot overwrite newer persisted
snapshots. Policy TTL limits freshness, never offline availability. Reconnect refreshes data;
server ownership/active-policy rejection preserves editable draft/evidence. Permanent media
failures preserve acceptance and offer manual retry without another claim POST. Live coverage
eligibility still requires a verified policy-system contract; it is not inferred locally.
