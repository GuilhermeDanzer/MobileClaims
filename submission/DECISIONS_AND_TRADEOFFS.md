# Decisions and Trade-offs

Reviewer summary grounded in the existing ADRs. Alternatives below are conceptual comparisons, not benchmarked experiments. This document uses current code and Phase 6.5 evidence when historical ADR prose differs.

## 1. SQLite instead of key-value persistence

Source: ADR-002, ADR-018.

**Decision:** SQLite stores drafts, attachments, queued intent and response snapshots transactionally.

**Problem:** A crash must not leave a submission without its stable ID or retry state.

**Alternatives:** AsyncStorage/MMKV for blobs; a larger offline ORM.

**Rationale:** Relational queries and atomic multi-row updates fit an outbox and additive migrations.

**Trade-off:** SQL/schema lifecycle and multiple retained owner databases require maintenance.

**Failure behavior:** Reopen restores committed state. Corrupt/missing snapshots show unavailable states. Unsent drafts cannot be rebuilt from the server; migration and backup policy remain essential.

## 2. TanStack Query without another global store

Source: ADR-007, ADR-018.

**Decision:** Server reads use TanStack Query, hydrated from validated SQLite snapshots; temporary UI/session state uses React.

**Problem:** Mirroring server and durable queue state creates competing authorities.

**Alternatives:** Zustand/Redux copies; generic query-cache persistence.

**Rationale:** Query lifecycle handles reads while SQLite remains authoritative for pending work.

**Trade-off:** Invalidation, timestamp ordering and hydration rules must be explicit.

**Failure behavior:** Offline reads use saved responses only for previously fetched resources. Cache misses remain honest; late hydration cannot replace live data.

## 3. Durable mobile outbox

Source: ADR-002, ADR-004, ADR-018.

**Decision:** Commit a queued operation with the existing draft identity before sending.

**Problem:** Memory retries disappear on process death or suspension.

**Alternatives:** In-memory mutation retry; relying on network availability at Submit.

**Rationale:** Persisted attempts and next-attempt time support restart and foreground recovery.

**Trade-off:** Storage retention and visible queued/attention states are required.

**Failure behavior:** Temporary failures back off without discarding work; auth pauses for login. Permanent rejection preserves the unaccepted draft. Fully closed apps are not guaranteed to sync.

## 4. Two-phase claim and evidence

Source: ADR-003, ADR-011.

**Decision:** Accept metadata first, then direct presigned PUT and explicit completion per file.

**Problem:** Large photos should not delay the durable claim reference or consume API bandwidth.

**Alternatives:** Single multipart API request; upload everything before creating the claim.

**Rationale:** Separates acceptance from transfer and supports independent file retry.

**Trade-off:** Media-pending state and a completion protocol; PUT restarts the whole file.

**Failure behavior:** Persist acceptance first; recover document IDs and check server completion before retry. Production scanning/access gate is additional design, not a local feature.

## 5. Client-generated intake identity

Source: ADR-004.

**Decision:** Persist clientClaimId once; enforce uniqueness within customer scope.

**Problem:** The API may commit while its response is lost.

**Alternatives:** Server-only IDs; UI duplicate checks; legacy-only dedupe.

**Rationale:** The retry identifies the original business operation even before the server ID is known.

**Trade-off:** A new ID on each retry defeats the protection. Accepted claims cannot be edited by replay.

**Failure behavior:** A duplicate POST returns the original claim. Separate Idempotency-Key handling scopes by customer and compares request hash; cross-system dedupe still depends on legacy.

## 6. Transactional backend outbox

Source: ADR-005.

**Decision:** Commit claim and intent in one PostgreSQL transaction, then publish eligible work.

**Problem:** Direct queue publication and database commit can disagree.

**Alternatives:** Publish to SQS in the HTTP request; EventBridge-first flow.

**Rationale:** Durable intent remains discoverable when the publisher is unavailable.

**Trade-off:** Publication acknowledgment is separate and can duplicate messages; production publisher coordination needs validation.

**Failure behavior:** Crash before publication leaves intent; crash after enqueue before marking may duplicate it. Current publisher selects/enqueues/marks separately, despite an older ADR claim of atomic claiming.

## 7. SQS instead of synchronous legacy calls

Source: ADR-005, ADR-009, ADR-012, ADR-014.

**Decision:** Production standard queue buffers work; independent workers apply retry, breaker and DLQ policies.

**Problem:** Storm intake must not wait for a fixed-capacity on-premises dependency.

**Alternatives:** Synchronous API-to-legacy call; Redis/BullMQ; SQS emulator locally.

**Rationale:** Decouples rate and availability, with a durable operational backlog.

**Trade-off:** Eventual completion and duplicate-safe consumers; local PostgreSQL queue does not prove SQS scale.

**Failure behavior:** Legacy outage retains work. Permanent 400/422 becomes a recorded rejection; exhausted transient/poison messages reach DLQ. Ambiguous commits require verified external dedupe or operator lookup.

## 8. Push hints plus pull

Source: ADR-006, ADR-016.

**Decision:** Propose push hints with foreground/periodic/manual retrieval of the authoritative projection.

**Problem:** Mobile apps suspend and notification delivery can fail.

**Alternatives:** WebSockets/SSE for continuous status streaming.

**Rationale:** Claims change over minutes/days; pull restores correctness without a persistent connection.

**Trade-off:** Freshness depends on legacy poll, device reachability and refresh cadence.

**Failure behavior:** Missing push does not remove status. Local implementation has notification records and polling, not APNs/FCM delivery. Worst-case latency is not bounded by push delay alone.

## 9. PostgreSQL instead of DynamoDB

Source: ADR-010, ADR-017; database alternative is a design comparison.

**Decision:** Use RDS PostgreSQL Multi-AZ with RDS Proxy; local PostgreSQL models the relational transactions.

**Problem:** Intake, ownership, evidence and intent need coherent constraints and transactions.

**Alternatives:** DynamoDB; Aurora PostgreSQL as a future upgrade.

**Rationale:** SQL and uniqueness constraints make these relationships and recovery queries inspectable. DynamoDB could work but needs deliberate access-pattern/index design.

**Trade-off:** Connection, index and instance-capacity management; asynchronous regional replica.

**Failure behavior:** Database unavailability prevents acceptance and preserves mobile intent. Multi-AZ/Proxy may reduce disruption but do not eliminate failed requests. No database benchmark comparison was performed.

## 10. Fargate modular monolith

Source: ADR-010, ADR-013; deployment comparison in ARCHITECTURE §8.

**Decision:** Run stateless API and separately scaled long-lived workers as Fargate services.

**Problem:** API demand and legacy drain capacity differ; platform needs a small operational surface.

**Alternatives:** Lambda for each operation; EKS; independent microservices.

**Rationale:** Fits the existing Node/PostgreSQL API and worker loops without Kubernetes administration.

**Trade-off:** Minimum runtime cost and explicit autoscaling; Lambda may be cheaper for other demand shapes.

**Failure behavior:** ECS replaces failed tasks; ALB removes unhealthy targets. Client retry and queue visibility recovery handle interrupted operations. Neither this topology nor relative cost is measured locally.

## 11. Separate customer and employee identity

Source: ADR-015; SECURITY_AND_RELIABILITY §2.

**Decision:** Cognito for customers; Entra ID for employees with distinct audiences and entry/authorization paths.

**Problem:** Customer access must never inherit employee privileges or corporate lifecycle assumptions.

**Alternatives:** One shared tenant/audience and role switch.

**Rationale:** Aligns workforce governance and customer identity without making tokens interchangeable.

**Trade-off:** Two trust configurations and an unresolved existing-customer migration plan.

**Failure behavior:** Bad signature/issuer/audience/expiry fails closed. Local verifier works with dev issuers; real federation, refresh flow and employee claim operations are not implemented.

## 12. Eventual consistency across systems

Source: ADR-004, ADR-005, ADR-012, ADR-016.

**Decision:** Platform owns intake and projection; legacy owns adjudication, reconciled by leased polling.

**Problem:** A distributed transaction cannot be assumed across an unmodifiable legacy HTTPS API.

**Alternatives:** Synchronous distributed commit; using legacy as the mobile request dependency.

**Rationale:** Keeps intake available and permits independent recovery with explicit status semantics.

**Trade-off:** Customers see pending states and delayed status; source ordering and identifiers must be verified.

**Failure behavior:** Lease generations reject stale workers. A legacy commit without local acknowledgment remains ambiguous. Durable external dedupe or manual resolution is required; there is no exactly-once promise.

## 13. Pilot-light regional DR

Source: ADR-017; SECURITY_AND_RELIABILITY §3.11.

**Decision:** One primary writer, async database replica, replicated objects and manual fenced recovery.

**Problem:** Regional outage requires recovery without introducing concurrent legacy writers.

**Alternatives:** Active-active regions; full warm standby; Aurora Global Database for tighter recovery needs.

**Rationale:** Reduces steady-state complexity and cost while retaining a recovery path.

**Trade-off:** Manual promotion, independent data/object lag and queue reconstruction; targets depend on rehearsals.

**Failure behavior:** Fence primary, verify surviving state and evidence, resolve ambiguous sends, rebuild regional work and canary. RTO 1h/RPO 5m are untested targets, not contractual guarantees.

## Evidence boundaries

See [original ADRs](../docs/ARCHITECTURE_DECISIONS.md), [current validation](../docs/IMPLEMENTATION_STATUS.md#phase-65--mobile-hardening-2026-11-07) and [consistency review](REQUIREMENTS_COVERAGE.md#consistency-review). ADR-002 overstates reconstruction of unsent work; ADR-005 overstates publisher atomic claiming; ADR-006 understates worst-case refresh delay. ADR-008 describes React Hook Form, while the current wizard uses React context and explicit shared-schema validation. This summary does not claim those historical statements as implemented behavior.
