# Northwind Mutual — Mobile Claims Platform · Project Overview

> Status: **Phase 1 — approved for implementation.**
> Kept in sync with `ARCHITECTURE.md`, `ARCHITECTURE_DECISIONS.md`, `ASSUMPTIONS.md`,
> `DEVELOPMENT_PLAN.md`, `IMPLEMENTATION_MATRIX.md`, `FAILURE_SCENARIOS.md`, and
> `SECURITY_AND_RELIABILITY.md`.
>
> The system runs entirely locally (no AWS credentials). The AWS production topology is
> designed and documented but not deployed; components are labeled *implemented (A)*,
> *locally simulated (B)*, or *designed only (C)* in `IMPLEMENTATION_MATRIX.md`.

## 1. Context

Northwind Mutual is a fictional mid-size insurance company with ~1.2 million mobile
customers, an existing React Native app, a Node.js backend on AWS, and on-premises policy
and claims systems. Employees and field adjusters authenticate through Microsoft Entra ID.

The business problem this platform exists to solve:

- During a severe weather event, claim submission failed for several hours.
- Customers cannot track a claim without calling support.
- The existing backend cannot absorb the demand spike or tolerate on-premises downtime.

## 2. Goals

1. Customers can submit claims from the mobile app with photographs and documents.
2. Customers can track claim progress through timely, understandable status updates.
3. Submission keeps working under poor or no connectivity.
4. Feedback is reliable even when the backend or on-premises systems are down.
5. The platform is more resilient, scalable, available, and observable than today's system.

## 3. Non-goals (explicitly out of scope for v1)

- No adjuster/admin web application (described in the architecture, not built here).
- No customer self-service for editing an already-submitted claim.
- No payments, fraud scoring, or provider integrations.
- No multi-region *active-active* deployment (pilot-light DR is documented instead).
- No real AWS deployment, no real Cognito tenant, no real Entra ID tenant, no real
  connection to an actual on-premises system. These are **modeled, documented, and
  clearly labeled as simulated where simulation is used** — never presented as real.

## 4. Actors

| Actor | Identity | Access |
|---|---|---|
| Customer | Cognito (username/password, optional MFA) | Own claims only |
| Adjuster / employee | Microsoft Entra ID | All claims, internal tools |
| Operations engineer | Entra ID | Dashboards, alerts, runbooks |
| Mobile app (background) | Device-issued access token | Own claims only |

Customer identity and employee identity are **separate systems, audiences, and network
paths** and are never interchangeable.

## 5. Scope of the system

The platform is a **modular monolith** (mobile app + public API + workers). It runs
entirely locally against Docker containers and simulated external systems; the AWS
production topology is designed and documented but **not deployed**.

What actually runs locally:

- **Mobile app (Expo / React Native):** claim creation, photo/document capture, offline
  draft + outbox queue, synchronization, claim history, claim details, status timeline.
- **Claims API (Node.js + Fastify):** the only public entry point for the mobile app.
  Accepts and validates submissions, enforces idempotency, issues claim references,
  manages document metadata, and records status.
- **Worker process:** drains the outbox, delivers commands to the on-premises stand-in,
  reconciles status, and records notifications.
- **Postgres 16 (Docker):** source of truth for submission intake, document metadata,
  outbox, the local message queue, and the mirrored status timeline.
- **LocalStack (Docker, S3 API):** local object storage. The same S3 client and presigner used
  in production, pointed at LocalStack with path-style addressing.
- **On-premises stand-in (Fastify on `:4000`):** represents the policy and claims systems,
  with fault-injection controls.

Production targets (designed, not deployed): RDS PostgreSQL Multi-AZ, S3, SQS, Cognito,
and Entra ID — see `ARCHITECTURE.md` and `SECURITY_AND_RELIABILITY.md`.

## 6. End-to-end flows at a glance

1. **Submit a claim** — the customer fills a multi-step form (policy → incident →
   photos → review). The draft is persisted to on-device SQLite, and on submit a
   client-generated `clientClaimId` is committed alongside it. The outbox sends the claim
   first; the server returns a reference number; photographs upload afterward against
   presigned URLs.
2. **Track a claim** — the customer opens the claim to see a local + server-reconciled
   timeline. Updates arrive by push notification (simulated locally) and are refreshed on
   app foreground and pull-to-refresh.
3. **Legacy synchronization** — an outbox record moved through the local queue causes the
   worker to call the on-premises stand-in. Results (and failures) are reconciled back
   into the status timeline.

## 7. Success criteria

- The architecture addresses every requirement in the original challenge.
- Mobile and backend run locally with no AWS credentials, from one compose file and a
  short README.
- The system tolerates a severe-weather traffic spike (25× normal) without losing submissions.
- Claim submission remains reliable during temporary infrastructure and legacy failures.
- A customer is **never shown a claim as submitted before the backend has confirmed it**.
- Offline behavior is predictable: draft → queued → submitted → received, each with
  unambiguous copy and a safe retry/backoff path.
- Legacy integration is resilient to downtime, slowness, duplicates, and partial failure,
  and each failure is reproducible locally.
- Security is enforced at every boundary (identity, authz, encryption, PII, uploads).
- Every external integration is clearly labeled *implemented*, *simulated*, or *designed*.
- The diagrams and documentation match the actual implementation.

## 8. Repository layout

```
MobileClaims/
├── apps/
│   ├── mobile/         # Expo SDK 58 app (Expo Router, SQLite, TanStack Query)
│   ├── api/            # Fastify modular monolith + worker entrypoint
│   └── onprem-stub/    # stand-in for the policy + claims systems (fault injection)
├── packages/
│   └── contracts/      # zod schemas + domain types shared by mobile and api
├── infra/
│   └── local/          # docker-compose.yml (Postgres + LocalStack)
└── docs/               # this documentation set + Mermaid diagrams
```

## 9. Deferred (recorded so scope is explicit)

| Item | Deferred to | Reason |
|---|---|---|
| Adjuster/admin UI | post-v1 | Out of the challenge's customer-facing scope |
| Resumable (multipart) uploads | post-v1 | Single presigned PUT is sufficient for ≤ 10 MB photos |
| Real Cognito / Entra ID wiring | post-v1 | Requires real tenants; the JWT verification boundary is real, the issuer is local in dev |
| Real device push (APNs/FCM) | post-v1 | Unvalidatable locally; notification inbox simulates the contract |
| Per-customer quota store (Redis/DynamoDB) | post-v1 | WAF + API Gateway throttles cover the documented design |
| EventBridge fan-out | post-v1 | One consumer group does not justify the extra hop |
| Terraform / CDK IaC | never (challenge) | Explicitly optional; production topology is documented instead |
