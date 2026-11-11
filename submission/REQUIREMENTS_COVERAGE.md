# Requirements Coverage and Delivery Review

The original challenge PDF was not found in the repository. This checklist uses every requirement supplied in the submission request; it does not claim verbatim equivalence to an unavailable PDF. The implementation is optional evidence, not a challenge requirement.

Design section numbers refer to [ARCHITECTURE_DESIGN.md](ARCHITECTURE_DESIGN.md). Diagram 1 is [production architecture](diagrams/production-architecture.mmd), 2 is [mobile sequence](diagrams/mobile-offline-sequence.mmd), and 3 is [failure recovery](diagrams/failure-recovery.mmd). See the [diagram index](diagrams/README.md) for rendered versions.

## Challenge requirements

| Requirement | Main design section | Diagram | Evidence boundary |
|---|---|---|---|
| Overall architecture and component interactions | 3, 5 | 1, 2 | Local API/mobile/worker interaction; AWS topology design only |
| Mobile app, employee tools and on-premises systems | 3, 8 | 1 | Mobile + HTTP stand-in local; employee tools/real systems design only |
| Scalability during severe-weather spikes | 2, 7 | 1 | Design only; 50 claims/s assumption; no throughput benchmark |
| High availability and failure isolation | 7 | 1, 3 | Local retry/recovery tests; Multi-AZ/managed failover design only |
| Disaster recovery | 10 | 1, 3 | Design/runbook only; one-hour RTO/five-minute RPO targets untested |
| Customer authentication and authorization | 4, 8 | 1 | Real local verifier/scoping with dev issuer; Cognito/refresh design only |
| Employee authentication and authorization | 3, 8 | 1 | Separate dev issuer and /me tested; Entra/tools/claim roles design only |
| Encryption of data in transit and at rest | 8 | 1 | Production TLS/KMS/storage protection design only; local HTTP not equivalent |
| Monitoring, logging and distributed tracing | 9 | 1 | Local logs/correlation/counters; cloud traces and alarms design only |
| Claim submission with photos and documents | 4, 5 | 2 | Local intake/photo PUT/receipt; PDF manifest accepted, image picker only |
| Claim status tracking and notifications | 5, 6, 9 | 2 | Local timeline/reconciliation/notification records; real push design only |
| Poor connectivity and offline use | 4, 5 | 2, 3 | Local SQLite/retry/snapshot tests + scoped iOS simulation; no closed-app guarantee |
| Backend temporary unavailability | 4, 7 | 3 | Automated transient retry and simulator unreachable-API restart; cloud shedding design only |
| On-premises claims integration | 5, 6 | 1, 2 | Real HTTP adapter to local stand-in; true legacy contract unverified |
| Data consistency and duplicate prevention | 5, 6 | 2, 3 | Local constraints/outbox/fencing tested; external dedupe remains assumption |
| Migration with minimal disruption | 11 | 1, 3 | Strangler, owner routing, read shadow and fenced rollback design only |
| Release and gradual rollout | 11 | 1 | Flags endpoint local; staged store/EAS/traffic rollout design only |
| Backward compatibility for older mobile apps | 4, 11 | 2 | Local SQLite upgrade and unknown-status behavior; old-binary matrix design only |
| Detailed architectural diagram | 3, 5, 10 | 1, 2, 3 | Maintainable Mermaid plus exports; all AWS diagrams explicitly proposed |
| Written design and architectural decisions | 1–13; decisions supplement | 1, 2, 3 | Prepared in this submission; source/evidence linked |
| Presentation video explaining choices and trade-offs | Presentation script sections 1–6 | 1, 2, 3 | Recording materials prepared; candidate video intentionally not recorded |

## Additional submission checks

| Requested emphasis | Location | Boundary |
|---|---|---|
| SQLite, TanStack Query and no redundant global store | Design §4; decisions 1–3 | Actual snapshot hooks, repositories and current sync inspected |
| Offline drafts, outbox, foreground triggers, backoff | Design §4; diagram 2 | Local code/tests; terminated-app background execution not guaranteed |
| Acceptance versus evidence completion; upload recovery | Design §4–5; decisions 4–5 | Receipt is not scan clearance; whole-file retry, no byte-offset resume |
| Account switching/cache isolation | Design §4; Q&A 12 | Per-owner database/query scope and session fences; one demo UI identity |
| Transactional outbox, at-least-once, retry/breaker/DLQ | Design §6; diagram 3 | Publisher can duplicate; queue uses PostgreSQL locally |
| PostgreSQL, RDS Proxy, Fargate, S3/SQS | Design §3, §7, §12; diagram 1 | AWS deployment and capacity design only |
| Cognito, Entra, ownership, malware, PII/audit | Design §8; diagram 1 | Local verified JWT/scoped access; federation/scanner/immutable audit not implemented |
| Correlation, tracing, technical/business alerts | Design §9 | Local diagnostics; proposed production instrumentation |
| Queue reconstruction, lag, RPO/RTO | Design §10; diagram 3 | Operator runbook; no regional test |
| Stable migration ownership, rollback, old versions | Design §11 | No dual writes; compatibility and rollout design with local schema regression evidence |
| Thirteen reviewer-oriented decisions | DECISIONS_AND_TRADEOFFS.md | Alternatives considered, not claimed benchmarked |
| Natural English video script with screen/logic/transitions | PRESENTATION_SCRIPT.md | Candidate must rehearse, record and add link |
| At least 25 technical interview answers | INTERVIEW_QA.md | 36 questions; each includes concept, trade-off and limitation |
| Reviewer-friendly optional-PoC README | ../README.md | Setup includes independent worker; historical results clearly dated |

## Source review and precedence

Read: PROJECT_OVERVIEW, ARCHITECTURE, ARCHITECTURE_DECISIONS, ASSUMPTIONS, SECURITY_AND_RELIABILITY, MOBILE_OFFLINE, IMPLEMENTATION_MATRIX, IMPLEMENTATION_STATUS, PHASE_6_AUDIT, FAILURE_SCENARIOS and DEVELOPMENT_PLAN, plus existing Mermaid sources. Inspected mobile routes/repositories, snapshot hydration, session/query scope, sync/upload behavior, API intake/completion, publisher/queue, delivery/reconciliation, local compose and test evidence.

Use current implementation and Phase 6.5 supplements first. Phase 6 reports 49 API, 27 Jest and 26 SQLite tests at its final baseline; Phase 6.5 later reports 50 API, final 45 Jest and 34 SQLite/sync. The combined Phase 6.5 root test preceded the final stall test and had 44 Jest tests. These are distinct executed runs, not contradictory counts or a newly executed combined run.

Automated evidence lives in `apps/api/test`, `apps/mobile/test-db` and feature tests under `apps/mobile/src`. Simulator evidence is limited to the recorded iPhone/Expo Go flows. Network-unreachable restart and diagnostic offline are not OS airplane-mode tests; injected pre-PUT failure is not an observed mid-byte OS interruption.

## Consistency review

The final package corrects framing without rewriting historical engineering records. The following discrepancies remain in upstream documents and are explicitly excluded from submission claims:

| Existing statement | Actual source/evidence and submission treatment |
|---|---|
| PROJECT_OVERVIEW and status headers describe early phases; audit says final materials await approval | Historical snapshots. The current user request authorizes this delivery preparation; no implementation expansion is performed |
| ARCHITECTURE and SECURITY_AND_RELIABILITY trailing notes say no cold-start hydration/policy persistence/account partition | Superseded by ADR-018, Phase 6.5 and actual snapshot/session code; design §4 reflects current behavior |
| ARCHITECTURE boundary says no ownership revalidation at intake | Current service checks customer-owned active local policy; live coverage/incident-date eligibility remains unimplemented |
| ADR-002 says outbox can always be rebuilt from server | Unaccepted offline drafts exist only locally; final package explicitly avoids this recovery promise |
| ADR-005 says publisher atomically claims outbox rows | Current outbox selection, enqueue and publication marking are separate; duplicates are possible and delivery must remain idempotent |
| ADR-006 implies worst-case latency equals push delay | Freshness also depends on source polling, outages and device refresh; no instantaneous or bounded push guarantee |
| ADR-008/development plan describe React Hook Form | Current wizard uses React context and explicit shared validation; no React Hook Form implementation is claimed |
| ADR/status summaries imply broad employee roles, complete audits or malware simulation | Actual scope is issuer separation plus /me, audit schema placeholder and not_scanned metadata. Employee operations/scanner/immutable capture remain production work |
| Existing sequence sends upload URLs on replay and implies push/tracing across every hop | Current mobile persists acknowledgment, reads document mapping and gets fresh URLs. Device push and full distributed traces are design only |
| Existing sequence routes permanent legacy rejection to DLQ | Actual 400/422 rejection is recorded without retries; exhausted transient/poison errors use DLQ |
| DEVELOPMENT_PLAN proposes demo/load scripts and separate final documents | Those are plans, not executable artifacts. README uses real commands and links this prepared package |
| Older ADR alternatives contain service price/failover/capacity assertions | Final submission avoids unmeasured cost/performance promises; alternatives are qualitative |

Production diagram clarifies S3/SQS as regional services and uses a VPC link/internal ALB rather than implying a public database/compute path. Existing production diagram lacks this detail. AZ B mirrors application responsibilities; shared arrows are drawn once for readability. This is design clarification, not a provisioned network.

## Missing information and incomplete deliverables

- Original PDF, public repository URL and recorded presentation URL are unavailable. Relative repository links are valid; the script has an explicit video placeholder.
- The mandatory video itself remains for the candidate to record, as requested. No recording or generated video was made.
- Real legacy dedupe retention, lookup/ordering identifiers, policy eligibility rules and existing-customer identity migration need owners/contracts.
- Production capacity/cost, supported mobile-version window, retention approval, device/security acceptance and measured recovery targets need validation. No AWS infrastructure or signed release was created.
- Main design covers all supplied system requirements, but production-only requirements are architectural proposals, not proven implementation guarantees.

## Recommended reading order

1. Main design, with diagrams 1 and 2.
2. Failure recovery diagram and the decisions summary.
3. This coverage/evidence review.
4. Presentation script for recording; interview Q&A for preparation.
5. Optional local proof of concept and engineering audit for deeper inspection.

## Delivery verification

- `npm run lint` — passed across workspaces during documentation preparation, 2026-11-11.
- `npm run typecheck` — passed across workspaces, including mobile test-db project, 2026-11-11.
- Application behavior suites were not rerun for this documentation-only change; recorded results above remain attributed to 2026-11-07.
- All three Mermaid sources passed rendering to SVG and PNG (six exports); SVG XML and PNG signatures/dimensions passed checks. Images were visually reviewed. All 67 local Markdown links, including six heading anchors, resolved. Details and renderer setup are in the [diagram index](diagrams/README.md).
- No feature implementation, refactoring, infrastructure provisioning or video generation was performed.
