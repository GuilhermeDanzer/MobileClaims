# Security & Reliability

> Companion to `ARCHITECTURE.md`. Classifications follow `IMPLEMENTATION_MATRIX.md`:
> **A** = implemented & tested locally, **B** = real code against a local substitute, **C** =
> designed & documented only (production), **not deployed**. **Nothing in the AWS sections has
> been provisioned, deployed, or tested.** The local environment proves behaviour, not scale.

**Related:** `ARCHITECTURE.md` (flows, data model, service catalogue), `ARCHITECTURE_DECISIONS.md`
(ADR-001…017), `FAILURE_SCENARIOS.md` (F1…F12), `ASSUMPTIONS.md` (A1…A13).

## 1. Threat model (summary)

| Asset | Sensitivity | Primary protection |
|---|---|---|
| Claim records + narratives + photos | High (PII, possibly health-related) | Encryption at rest/in transit, row scoping, log redaction, retention |
| Customer credentials / tokens | High | Cognito; `expo-secure-store` on device; never in SQLite/logs |
| Policy + coverage data | Medium | Seeded read-only snapshot locally; production TTL/revalidation required |
| Claim reference / status | Low–medium | TLS, least-privilege |

Actors and trust boundaries:

- **Device ↔ edge (CloudFront / API Gateway):** untrusted network → TLS + JWT.
- **Edge ↔ VPC:** AWS network → VPC, security groups, least-privilege IAM.
- **Platform ↔ on-premises:** private **VPN / Direct Connect**; the legacy boundary is the
  highest-risk integration (assumptions A1–A3).
- **Customer** (Cognito) vs **employee / adjuster** (Entra ID) vs **operations** (Entra ID).

The platform is an **intake and tracking** system, not the system of record for adjudication
(`ARCHITECTURE.md` §3): it holds the authoritative submission + evidence, and a mirrored,
append-only copy of downstream status.

## 2. Security

### 2.1 Two identity providers, never interchangeable

- **Customers → Amazon Cognito** user pool: auth-code + PKCE, optional MFA (assumption A7).
- **Employees / adjusters → Microsoft Entra ID**: OIDC, **separate audience** and a separate
  internal route. Customer and employee tokens are **never interchangeable** — a test asserts
  one cannot present the other's token.

Local (B): two local JWT issuers (RS256 + JWKS) reproduce the *verification* boundary; the API
verifies issuer + audience with `jose` exactly as it would for Cognito/Entra ID (ADR-015),
gated on `AUTH_MODE=dev`.

### 2.2 Microsoft Entra ID integration

- OIDC authorization-code flow; the platform validates `iss`, `aud`, `exp`, and signature
  against Entra's JWKS.
- **Group → role mapping:** Entra groups map to `role` claims (`adjuster`, `supervisor`,
  `admin`); no per-user role table is kept on the platform.
- **Conditional access / MFA** is enforced at the Entra tenant boundary, not re-implemented in
  the API.
- Employee access is a **separate internal API surface** (distinct audience + path), never the
  public customer gateway.

### 2.3 Authorization

- JWT `sub` → `customer_id`; RBAC by `role` claim (customer / adjuster / supervisor / admin).
- **Customer row scoping:** customer claim lookups require the caller's
  `customer_id`; internal document/event helpers require an owned-claim lookup first; a test asserts a
  customer cannot read another's claim.
- Employees are authorized by role, not by `customer_id`.

### 2.4 Encryption in transit & at rest

| Layer | Control | Level |
|---|---|---|
| Transit | TLS 1.2+ end to end: CloudFront → API Gateway → ALB → Fargate → RDS/S3/SQS | C |
| Database at rest | RDS storage encryption (KMS CMK) | C |
| Objects at rest | S3 **SSE-KMS** (customer-managed key), versioning, bucket policy denies non-TLS | C |
| Device tokens | `expo-secure-store` (Keychain/Keystore); never in SQLite | A |
| Local secrets | `.env` (git-ignored) | B |

### 2.5 Photo & document uploads (secure by construction)

Local flow (B): claim/customer-scoped, random unique object keys; presigned PUT with declared
size/type and five-minute expiry; post-upload HeadObject verifies size/type; missing or mismatch
is rejected and remains pending. `sha256` is declared metadata, not currently verified against
stored bytes. `complete` means metadata validated; `scan_status` remains `not_scanned`.
Objects are private by local default. There is **no download endpoint/presigned GET**, employee
claim/evidence endpoint or forwarding of bytes to legacy. Therefore no local consumer can
obtain bytes through this API before scanning, but no real scanner or production IAM gate is
implemented. A previously issued PUT can overwrite until expiry; local validation does not
establish immutable content or malware safety.

Required production lifecycle (C):

1. Upload only to private quarantine with Block Public Access and restricted uploader PUT.
2. Validate declared properties and checksum against the exact immutable S3 version; reject
   mismatches. Bind subsequent scans and reads to that same version to avoid overwrite races.
3. GuardDuty Malware Protection for S3 scans; trusted result processing sets clean/rejected.
   Treat absent, failed, unsupported or access-denied scans as pending/rejected, never clean.
4. Deny GetObject/GetObjectVersion to adjusters, downstream processors and download signing
   roles unless metadata is validated **and** that version is clean. Enforce bucket/IAM
   tag-based denial unless GuardDutyMalwareScanStatus=NO_THREATS_FOUND, protect scan tags
   from uploader edits, and use a trusted release process/version binding for metadata checks.
5. Only then authorize per customer/employee role and claim and issue short-lived GET URLs
   for the released version. Rejected evidence stays quarantined; audit access/release.

Tagging alone is not an access gate; use explicit policies and verify them in production.
See [GuardDuty tag-based access control](https://docs.aws.amazon.com/guardduty/latest/ug/tag-based-access-s3-malware-protection.html).

### 2.6 Secrets management

- Production: **Secrets Manager** for DB credentials, legacy credentials, and signing material;
  automatic rotation; Fargate tasks fetch secrets via their task IAM role (no secrets in images
  or env files).
- Local: `.env` (git-ignored), dev-only.
- **KMS** CMKs encrypt DB and S3; keys rotated yearly; key access is least-privilege.

### 2.7 API protection & rate limiting

- **WAF** (managed rule groups + rate-based rules + bot control) sheds abuse at the edge.
- **API Gateway** per-route throttles cap burst; above SLO the API returns `429 + Retry-After`.
- The mobile outbox treats `429` as "retry later", so backpressure is **lossless** (never shown
  as a user error).
- Local: sync tests classify injected transient failures; there is no implemented API load
  shedding/Retry-After or load script. WAF/API Gateway enforcement is C.

### 2.8 Least-privilege IAM

- Separate **execution role** (Fargate) vs **task role** (the AWS calls the container makes).
- Per-service task roles with scoped resource ARNs (API task: RDS/S3/SQS/Secrets only; worker
  task: SQS/legacy/Secrets only); no wildcards.
- Human access via SSO/Entra (no long-lived keys); CloudTrail records API calls.

### 2.9 Sensitive customer information protection

- PII classification follows assumption A10: name, address, policy number, narrative, photos,
  possibly injury-related information.
- Logs use pino, omit request bodies and redact authorization. Dependency error details
  need production PII review; customerIdHash and end-to-end tracing are not implemented.
- Retention: claims 7 y; audit 1 y; operational logs 90 d (lifecycle rules / CloudWatch).
- Production requires append-only emitted audit events and CloudTrail data events. Local
  `audit_events` is currently an unused schema placeholder, without DB immutability enforcement.
- Data minimization: the API persists only what intake requires; adjudication data stays on the
  legacy system and is mirrored as status labels, not raw records.

## 3. Reliability, scalability & disaster recovery

### 3.1 Targets (SLOs)

| SLO | Target |
|---|---|
| Claim submission success rate | ≥ 99.9% over rolling 30 days (durably accepted eligible attempts; same denominator as ARCHITECTURE §7) |
| Intake latency p95 | ≤ 1.5 s |
| Status freshness | bounded by poll cadence (15 s default) + legacy availability |
| Queue-to-DLQ rate | 0 in steady state; DLQ is exceptional, not expected |

### 3.2 Severe-weather traffic spike (assumption A8)

~2 claims/s normal and ~50 claims/s storm traffic for hours (25× normal) are A8 planning
assumptions, not measured capacity. Production load tests must exercise DB writes/locks,
connection pools, consumers, object uploads and legacy throughput before commitments.
Local contention tests establish correctness only. In order:

1. **Edge:** CloudFront + WAF absorb and shed abuse (rate-based rules, bot control).
2. **Throttle:** API Gateway route throttles cap burst before it reaches compute.
3. **Scale:** ECS Fargate scales on request count *and* queue depth, with a warm floor during
   severe-weather season (scheduled pre-scaling avoids cold-start lag).
4. **Write path:** one short transaction (claim + outbox + document metadata) through **RDS
   Proxy**, so connection count is bounded and independent of task count.
5. **Backpressure:** above SLO the API sheds with `429 + Retry-After`; the outbox retries —
   lossless.
6. **Load leveling:** photo bytes go **direct to S3**; the legacy system is fed through **SQS**
   with fixed consumer concurrency, so on-prem sees a flat rate and the backlog drains over
   hours.
7. **Degradation order:** reads serve cached data first; non-essential work is disabled by a
   remote "storm mode" flag; **claim submission is the last thing to be reduced.**

### 3.3 API failure & degradation

| Failure | Customer impact | Recovery |
|---|---|---|
| API task dies | In-flight request fails; ALB health check re-routes | ECS/Fargate replaces tasks; ALB health checks remove unhealthy targets; client/application retries with stable clientClaimId |
| Whole API down | App queues locally (offline), retries with backoff | Restore; outbox drains; `clientClaimId` dedupes |
| DB write slow | `429 + Retry-After` | Client backoff; autoscale; RDS Proxy absorbs |
| Object storage down | Claims accepted; uploads retry | Presigned URLs re-issued per attempt |
| Push down | Status still readable by pull | "last updated" timestamp shown |

### 3.4 Database availability

- **RDS PostgreSQL Multi-AZ:** synchronous standby in a second AZ; automatic failover.
- **RDS Proxy:** connection pooling and fast client reconnect during failover; bounded
  connections independent of task count.
- Automated backups + **PITR** (35-day window) for point-in-time restore.
- Read replicas (in-region) for read scaling if the read path ever dominates; not required for
  v1 volume.

### 3.5 Queue backlog & failed messages

- **SQS standard + DLQ**; the consumer (worker) scales on queue depth.
- **Visibility timeout** gives at-least-once delivery; a crashed worker's messages become
  visible again and are re-processed.
- Failed messages retry with backoff; after N attempts they move to the **DLQ** (never
  silently lost).
- Alarms: `ApproximateAgeOfOldestMessage` and DLQ depth; operators **redrive** after the cause
  is fixed.
- Local (B): `queue_messages` + `queue_dead_letters` reproduce these semantics (ADR-014) and are
  exercised by tests (F5/F6/F10).

### 3.6 Legacy outages

- The **circuit breaker** opens when the legacy system is down/slow, short-circuiting further
  calls for a cooldown; the worker stays healthy.
- Claims are **still accepted** (the API's only synchronous promise is "durably stored"); the
  queue retries with backoff; status pauses at "sending to claims team".
- On recovery, **reconciliation** (ADR-016) catches up status via `getStatus` polling; no
  submission is lost, and a poll failure never invalidates an accepted claim.

### 3.7 Duplicate message delivery

- SQS is at-least-once, so redelivery is **expected**, not an error.
- Idempotency is the correctness mechanism (not ordering): intake dedupes on `clientClaimId`
  (unique index), and the legacy call dedupes on the claim reference (assumption A2).
- If A2 is unverified/false, automatic resend after ambiguous timeout is unsafe. Operators
  must pause delivery and resolve by external lookup with the integration owner; there is
  no implemented twin detection/merge. Persisted legacy numbers support this investigation.
- ALB does not generically retry POSTs. It health-checks targets; ECS replaces failed tasks.
  The app retries with its stable clientClaimId; DB uniqueness and tenant-scoped, body-checked
  Idempotency-Key replays protect intake. A2 is still required across the external commit gap.

### 3.8 Interrupted photo uploads

- Two-phase submission: the claim (with reference) is accepted first, photos second (ADR-003).
- An interrupted upload leaves the claim `media_pending`; the app re-requests a presigned URL
  and retries from scratch (S3 PUTs are not resumable below the multipart threshold — A5 caps
  files at 10 MB, so full re-upload is acceptable).
- The claim is accepted independently of evidence. Server `media_pending` and mobile photo
  status remain visible until all declared documents pass metadata checks. Upload completion
  is not scan clearance. Outbox publication waits for metadata completion locally; production
  evidence release must also wait for clean scans. Restart retries query server completion
  first to recover a lost completion response without re-uploading an already completed file.

### 3.9 Multi-AZ

- ALB, ECS Fargate, RDS (Multi-AZ), and RDS Proxy span AZs; S3 and SQS are regional services.
- An AZ loss may interrupt in-flight requests and connections: ALB shifts traffic, Fargate re-places tasks,
  and RDS fails over automatically.

### 3.10 Backup & recovery

- RDS: automated daily snapshots + PITR (35 d); **AWS Backup** vault for long retention.
- S3: versioning + lifecycle; **Cross-Region Replication** to the DR region.
- Restore is exercised by runbook; RPO/RTO are the DR targets below.

### 3.11 Disaster recovery — immediate vs long-term

**Immediate (automatic, in-region):** multi-AZ failover, task replacement, SQS redelivery —
seconds to minutes, no human action.

**Longer-term (planned, cross-region, pilot-light):**

| Aspect | Design |
|---|---|
| Region | Primary `us-east-1`, DR `us-west-2` |
| Database | Asynchronous cross-region read replica; 5-min RPO target conditional on observed lag; manual promotion |
| Objects | S3 Cross-Region Replication |
| Compute/state | Fargate re-deployed from images; queue reconstructed from DB; S3 evidence is separate durable state |
| DNS | Route 53 failover to the DR stack |
| **Target RTO** | 1 hour |
| **Target RPO** | 5 minutes |

Pilot-light keeps a warm DB replica + replicated objects but minimal compute; it is cheaper
than warm standby. The promote is a documented runbook (manual), not automatic — consistent
with the "no active-active" non-goal.

The local environment reproduces **none** of the cross-region path (single Postgres/LocalStack);
it is designed, not demonstrated (C). Multi-AZ failover timing is likewise C (see
`FAILURE_SCENARIOS.md` "Not reproducible locally").

#### Regional recovery and queue runbook (C; not implemented or rehearsed locally)

SQS is regional; pending and in-flight messages are **not automatically copied across
regions**. The secondary queue starts empty. Retained claims, document metadata and outbox
records in the promoted DB are the recovery inventory, including already-published events
whose old queue is inaccessible. Database replication loss may remove that inventory too;
recovery cannot promise to reconstruct records absent from the replica/backups.

1. On-call incident commander declares failover and appoints DBA and integration/security
   owners. Freeze intake and consumers; fence primary writers/workers (including old legacy
   credentials/network access) so a returning primary cannot submit alongside DR.
2. DBA records last primary/replica positions and observed replication lag; monitor RDS
   ReplicaLag and S3 replication metrics/failed replication alarms before incidents. Five
   minutes is an RPO **target**, not a maximum lag guarantee. Lag, network partitions, missing
   objects or unavailable telemetry may exceed it. Record the estimated loss window explicitly.
3. Manually promote the replica, point paused services at it, verify schema/constraints,
   accepted-claim/outbox counts, references, delivery state and evidence versions against
   available logs/backups. Check S3 replica presence, checksum/metadata and security status;
   CRR is asynchronous, so do not assume every referenced object is present or scanned.
   Hold missing evidence; request re-upload where possible. Verify consistency before writes.
4. Build an audited recovery inventory by claimId/reference: accepted/rejected delivery
   outcomes are not recreated; delivered claims resume status polling. Undelivered claims
   with complete required evidence are candidates for a new regional queue message, even if
   their old outbox published_at is set. Pending evidence stays held. DLQ/poison causes need
   review before redrive. Use a recovery manifest to avoid repeated bulk enqueue; normal
   delivery dedupe remains necessary. Do not blindly reset every published_at.
5. Treat all in-flight sends and any missing DB delivery acknowledgments as ambiguous.
   Integration owner queries legacy by verified reference/legacy-number contract before resend.
   If legacy already has it, repair local delivery state/number and reconcile timeline. If
   absent and durable dedupe is verified, re-enqueue with the same reference. If unknown,
   quarantine the operation for manual resolution; never invent a new reference to retry.
   Legacy state may be ahead of the asynchronously replicated DB.
6. Security owner verifies clean-only evidence gate in DR. Deploy consumers paused, verify
   configuration/permissions, perform controlled canary reads/writes/delivery, then switch
   traffic and gradually unpause. Monitor duplicates, lag, backlog age/DLQ and status drift.
   Incident commander signs off resumption and records actual RPO/RTO. Rebuild replication
   from the promoted primary; failback is another fenced, reconciled migration, not dual writes.

The target RTO of 1 hour depends on staffed ownership, available images/configuration,
promotion and external reconciliation time. Evidence recovery has separate lag and can exceed
the 5-minute data target. Exercise this runbook with production owners before any commitment.
See [RDS promotion](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.Promote.html).

### 3.12 What the local environment proves vs. not

Proven (A/B, with tests): offline submission, idempotent replay, two-phase upload + interrupt
retry, queue visibility/DLQ movement, circuit breaker, legacy-down catch-up, transient retry handling,
customer/employee separation. See `FAILURE_SCENARIOS.md` F1–F12.

Not proven (C): WAF/edge rate limits, multi-AZ failover timing, cross-region promote, APNs/FCM
delivery, real Cognito/Entra federation, malware scanning.

## 4. Observability (business-level)

`ARCHITECTURE.md` §7 covers the signal pipeline (one `correlationId` carried across every
boundary; pino structured logs; CloudWatch Logs/Metrics + X-Ray/ADOT tracing). The
**business-level** metrics that matter most here:

| Metric | Why it matters | Alarm |
|---|---|---|
| Claim submission success rate | The core promise ("we accepted your claim") | < 99% over 5 min |
| Claims waiting for legacy processing | Backlog visibility during a legacy outage | queue age > threshold |
| Legacy integration failure rate | Earliest signal of on-prem trouble | breaker open > 2 min |
| Queue age / DLQ volume | Backlog + poison-message health | age > 10 min; DLQ > 0 |
| Photo upload failure rate | Evidence completeness | > 5% |
| Time from submission to status update | Customer-perceived responsiveness | p95 > target |

Local (B): counters exposed under `/dev/metrics`; the alert rules above are documented in
`ARCHITECTURE.md` §7 with runbook lines.

The <99% over five minutes alert is an acute operational degradation signal, intentionally
different from the rolling 30-day ≥99.9% SLO. It is not itself an SLO breach indicator.
Use the eligible-attempt denominator and error-budget monitoring in ARCHITECTURE §7.

Local identity checks require RS256 signature, issuer, audience, expiration and subject. Real
federation is unavailable and production/real auth startup fails closed. Employee operations
beyond /v1/me, refresh tokens, live policy revalidation and immutable audit capture remain
production prerequisites (see ARCHITECTURE Phase 6 boundaries). Approved→denied is an
unresolved adjudication rule: local reconciliation mirrors legacy and only denied/closed
are terminal. Lease fencing prevents a stale in-flight poll from overwriting those states;
no guarantee exists for out-of-order nonterminal source data without a source version contract.
Migration ownership, retry routing and rollback fencing are specified in ARCHITECTURE §9.

Local mobile limitation: SQLite cache write/read repositories are tested, but server-query
hooks do not hydrate that cache on an offline cold start; policy snapshots are not persisted
on device. Existing in-memory query data may remain visible while offline; restart requires
reconnection for server claims/policies. Drafts and photo upload progress persist. The app
currently uses one fixed demo customer; multi-account cache/outbox partitioning and cancellation
on account switch are prerequisites for real federation. Foreground retry scheduling runs
every five seconds and honors persisted per-item backoff; no OS background execution is claimed.
