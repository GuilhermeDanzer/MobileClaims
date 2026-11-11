# Assumptions

Every assumption that shapes the architecture is recorded here with its **impact** and how
it would be **validated or invalidated**. Assumptions are not silently invented business
requirements — when a decision depends on something that cannot be verified from this
repository, it is listed below and referenced from the relevant ADR.

## A1 — Legacy claims system exposes a synchronous HTTPS API

**Assumption:** the on-premises claims system provides a request/response HTTPS API for
claim creation and status queries, and it **cannot push events** to us.

**Impact:** the platform must poll for status changes and run a reconciliation job; status
latency is bounded by the poll cadence. This is the single most consequential integration
assumption.

**Validation:** provide a contract/spec or a test endpoint during implementation. Until
then the integration is exercised against the clearly labeled `SimulatedLegacyClaimsGateway`.

## A2 — Legacy system accepts an idempotency key

**Assumption:** the legacy `createClaim` operation can deduplicate on an external reference
(we send the platform claim reference).

**Impact:** if true, redelivery is safe. If false, a duplicate legacy claim is possible and
the reconciliation job must detect it and flag it for an adjuster to merge.

**Validation:** confirm with the legacy team; test with the simulated gateway configured to
duplicate.

## A3 — The legacy system cannot be modified freely

**Assumption:** changes to the on-premises systems are limited to additive integration work
on our side; we cannot change their schema, add their outbox, or require new APIs from them.

**Impact:** all resilience (idempotency, retries, reconciliation) lives on the platform
side of the boundary.

## A4 — Policy data is read-only and cacheable for 15 minutes

**Assumption:** policy/coverage records can be read (synchronously or batch) and are safe to
cache with a 15-minute TTL; a snapshot can be persisted on-device for offline policy
selection.

**Impact:** a policy changed inside the TTL could show briefly stale coverage during
selection; the server re-validates policy eligibility at submission time, which is the
authoritative check.

**Validation:** confirm the policy API supports a `since=`/incremental fetch; confirm
eligibility rules are enforced at submission.

## A5 — Attachment limits

**Assumption:** up to 10 attachments per claim, each ≤ 10 MB, types JPEG/HEIC/PNG/PDF.

**Impact:** presigned PUT is a safe fit (no multipart/resumable uploads required in v1);
server-side validation and malware scanning can bound work per claim.

## A6 — Claims are immutable after submission

**Assumption:** a customer cannot edit a submitted claim; corrections happen through an
adjuster or as an addendum.

**Impact:** no conflict-resolution UI or merge logic is needed in v1. If customers must be
able to add documents later, that is a separate, additive flow (post-submission attachment).

## A7 — Customer identity is username/password in Cognito

**Assumption:** customers authenticate with a Cognito user pool (username/password,
optional MFA), not an existing SSO/CIAM provider. Existing customers would require an
import/migration path, which is **not designed here**.

**Impact:** the auth boundary is real (JWT verification with JWKS/issuer/audience); in
local development the issuer is a local dev JWT signer, clearly labeled and disabled
outside `AUTH_MODE=dev`.

## A8 — Peak load profile

**Assumption:** 1.2M monthly active users; normal peak ~2 claims/second; a severe weather
event drives **25× for up to 4 hours** (~50 claims/second) and ~10× document uploads.

**Impact:** drives autoscaling floors, SQS concurrency, DB sizing, and the WAF/API Gateway
throttle ceilings documented in `ARCHITECTURE.md` §6 and §8 (no infrastructure-as-code exists
by design — ADR-013).

## A9 — Single primary region, US data residency

**Assumption:** primary region `us-east-1`, disaster-recovery region `us-west-2`; data
resides in the US only.

**Impact:** a cross-region RDS read replica + S3 Cross-Region Replication are the DR
mechanisms (see ADR-017); no EU/data-sovereignty requirements are modeled.

## A10 — PII scope

**Assumption:** claims contain name, address, policy number, incident narrative, photographs,
and possibly injury-related information. Retention is 7 years for claim records, 1 year for
audit logs, 90 days for operational logs.

**Impact:** encryption everywhere, PII redaction in logs, field-level access control, and
audit logging are mandatory, not optional.

## A11 — Claims reference format

**Assumption:** a human-readable, monotonically increasing reference such as
`NW-2026-000123` is acceptable and is assigned by the platform at acceptance time.

**Impact:** the reference is stable, appears in notifications and support conversations, and
doubles as the legacy idempotency key.

## A12 — Development/validation environment

**Assumption:** iOS Simulator (Xcode 26) and Docker Desktop are the validation
environments; no App Store, EAS, or AWS credentials exist in this repository.

**Impact:** integration tests require a running Docker daemon (real Postgres). If Docker is
not running, those tests are **skipped and reported as not-run**, never faked.

## A13 — Status delivery is best-effort push + reliable pull

**Assumption:** push notifications are a low-latency signal, not a delivery guarantee.

**Impact:** claim status must always be fully readable via pull; the UI shows a
"last updated" timestamp so a missing push is not confused with a missing update.
