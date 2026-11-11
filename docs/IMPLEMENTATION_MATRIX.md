# Implementation Matrix

Every component in the system is classified into one of three levels. No component may be
described as more complete than it is.

| Level | Meaning |
|---|---|
| **A — Fully implemented** | Runs and is tested locally, no external service required. |
| **B — Locally simulated** | Real application code against a realistic local substitute that reproduces relevant behaviour (including failures). The production service is not contacted. |
| **C — Architecturally designed** | Documented in `ARCHITECTURE.md` with responsibility, rationale, local equivalent (if any), expected production configuration, and failure behaviour. No code, no deployment. |

Labeling rules:

- Every code module, endpoint, table, and doc reference uses the level tag where the
  distinction matters (e.g. a `// Level B — simulated; production = SQS` comment).
- Simulated services are never presented as the real service in logs, API responses, or
  documentation.
- The local substitute reproduces *behaviour* (at-least-once delivery, expiring presigned
  URLs, fault injection), not necessarily *throughput or scale characteristics*.

> Phase 4 status: the mobile rows below are now **implemented and tested** (not just designed).
> See `IMPLEMENTATION_STATUS.md` for the exact suites and results.


## Component matrix

| Component | Level | Local implementation | Production design (documented) |
|---|---|---|---|
| Mobile app, navigation, claim wizard | A | Expo SDK 58, simulator / dev build | EAS Build + OTA updates |
| Drafts, outbox, cache (SQLite) | A | `expo-sqlite`, v2 migration; per-issuer/subject DB; historical unscoped DB quarantined | Same boundary, plus verified account migration/retention |
| Offline read hydration and policy snapshot | A | One response-snapshot hook → TanStack Query; claims/details/timeline/policies; 15-minute policy freshness | Same, plus production cache retention/encryption policy |
| Intake policy guard | A | Checks customer ownership + active flag in local policy snapshot; rejected draft survives | Verified live policy eligibility contract still required |
| Sync engine, retry/backoff, upload progress | A | In-app worker + foreground/reconnect triggers | Same |
| Claims REST API | A | Fastify on `:3000` | API Gateway HTTP API → ECS Fargate |
| Postgres schema + migrations | A | Postgres 16 container | RDS PostgreSQL Multi-AZ + RDS Proxy |
| Idempotency (`clientClaimId` + replay) | A | Unique index + idempotency table | Same |
| Transactional outbox + publisher | A | Postgres poller | Same, publishing to SQS |
| Message queue | B | `queue_messages` table: visibility timeout, attempts, delay, DLQ | SQS standard + DLQ + redrive |
| Worker process | A | `npm run worker` (separate process) | ECS Fargate service |
| Status reconciliation | A | `worker/reconcile.ts` — leased polling + `legacy_status`/`reconcile_at` | Same worker, poll cadence config |
| Object storage | B | LocalStack + real S3 client/presigner (path-style) | S3 + presigned PUT + SSE-KMS + CRR |
| Malware scan | B | `scan_status = 'not_scanned'`, surfaced in API/UI | GuardDuty Malware Protection for S3 |
| Customer identity | B | Local issuer: RS256 JWT + JWKS, dev login | Cognito user pool (PKCE, optional MFA) |
| Employee identity | B | Second local issuer, separate audience, `role` claims | Microsoft Entra ID |
| Token verification, RBAC, row scoping | A | Real `jose` verification + policy function | Same code |
| Push notifications | B | `notifications` table + in-app inbox + dev trigger | Expo Push / SNS → APNs & FCM |
| Legacy claims + policy systems | B | `apps/onprem-stub` on `:4000` with `/dev/faults` | On-prem via VPN / Direct Connect |
| Metrics & alerting | B | Structured JSON logs + `/dev/metrics` + threshold rules | CloudWatch metrics/alarms + X-Ray |
| VPC, subnets, security groups, NAT | C | — | Documented topology |
| CloudFront, WAF, API Gateway throttles | C | — | Documented limits + rationale |
| ECS/autoscaling, Multi-AZ, cross-region DR | C | — | Documented scaling + DR runbook |
| KMS, Secrets Manager, AWS Backup | C | — | Documented key/secret/retention strategy |
| EventBridge | C | — | Documented as deferred fan-out option |
| Route 53, SES, CloudTrail | C | — | Documented |

## External-dependency seams

The application depends on five business-level boundaries, each with exactly one local
implementation plus a documented production contract. These are genuine system boundaries,
not a generic cloud-abstraction framework.

| Boundary | Local (B) | Production (documented) | Notes |
|---|---|---|---|
| `ObjectStorage` | S3 client against LocalStack | S3 | Same client; only endpoint + path-style differ |
| `MessageQueue` | Postgres-backed queue | SQS | Reproduces semantics, not throughput |
| `IdentityProvider` | Two local JWT issuers | Cognito / Entra ID | Same verifier on both sides |
| `NotificationProvider` | Inbox table + dev trigger | Expo Push / SNS | Contract: push is a hint, not a guarantee |
| `LegacyClaimsGateway` | HTTP adapter → on-prem stand-in | HTTP adapter → on-prem over VPN | Same adapter code |

## Explicitly not implemented (even locally)

- Real APNs/FCM delivery (no push token, no device).
- Real Cognito/Entra ID token issuance (the local issuer stands in).
- S3 Cross-Region Replication and Multi-AZ failover (single local Postgres/LocalStack).
- Malware scanning of uploaded objects (flagged `not_scanned`, never claimed otherwise).
- Cross-region read-replica promotion and pilot-light DR (runbook only).

These items are documented as designed-but-not-executed and appear in no test report as
passing.


## Phase 6.5 evidence boundary

Identity isolation is implemented/tested with multiple test identities and real SQLite files;
the UI still signs in only the seeded demo customer. Offline restart tests combine hook
lifecycle tests with real SQLite close/reopen tests. They are not physical-device or AWS
validation. Legacy normalized cache repos remain compatible, but current read hooks use only
`read_snapshots`; there is no second hydration mechanism. Current verification and simulator
coverage are recorded in IMPLEMENTATION_STATUS.md and FAILURE_SCENARIOS.md.
