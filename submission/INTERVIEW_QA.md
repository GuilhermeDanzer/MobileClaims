# Interview Preparation

Spoken answers with the concept, accepted cost and evidence limit made explicit. Read alongside [the design](ARCHITECTURE_DESIGN.md); local test evidence does not establish production readiness.

## React Native architecture

### 1. How would you explain the mobile architecture?

**Answer:** “Screens use Expo Router and render feature state. Repositories own durable data, a React-independent engine orchestrates sync, and platform adapters handle storage and transfer APIs. This makes recovery behavior testable without navigating every screen.”

**Concept:** Separate rendering from durable work.

**Trade-off:** More boundaries than a screen-only implementation, but fewer lifecycle-dependent bugs.

**Implementation limitation:** Only scoped iOS simulator flows were manually validated; a bundle export is not a signed binary.

### 2. Why React Native and Expo?

**Answer:** “They fit the existing application and let one team share the claims workflow across iOS and Android. I keep platform-dependent work behind small adapters and validate SDK-specific behavior rather than assuming both platforms behave identically.”

**Concept:** Share domain behavior while respecting native lifecycle differences.

**Trade-off:** Native changes still require compatible builds and device testing.

**Implementation limitation:** The project uses Expo SDK 58; Android UI and physical-device behavior remain unvalidated.

## Offline-first persistence

### 3. Why SQLite rather than AsyncStorage or MMKV?

**Answer:** “The pending submission is several related records, not just a preference value. I need transactions, queries, migrations and retry metadata. SQLite lets the enqueue operation preserve its relationship to the saved draft.”

**Concept:** Atomic local intent survives process death.

**Trade-off:** SQL migrations and storage policy become responsibilities.

**Implementation limitation:** Unsent data exists only on the device and cannot be reconstructed from the server.

### 4. What can the customer read after an offline cold start?

**Answer:** “Previously fetched lists, details, timelines and policies hydrate from validated response snapshots with their original timestamps. A saved list does not imply that every full detail or timeline was fetched. Missing information gets an explicit unavailable state.”

**Concept:** A snapshot is last-known information, not a prediction.

**Trade-off:** Response snapshots duplicate some server fields and need retention limits.

**Implementation limitation:** A stored unexpired session is required; first login or expired-session reauthentication needs the API.

### 5. How do you migrate local storage safely?

**Answer:** “Use additive versioned migrations and exercise real SQLite close/reopen and upgrade paths with pending work. Preserve identifiers, retry state and file associations. Never solve a migration error by silently deleting the queue.”

**Concept:** Local schema evolution is part of delivery correctness.

**Trade-off:** Compatibility code and recovery procedures must remain.

**Implementation limitation:** The historical unscoped database is quarantined; verified ownership recovery has no UI yet.

## State management

### 6. Why use SQLite instead of React Query persistence alone?

**Answer:** “Query persistence saves read results, while a submission needs transactional domain intent, per-file progress and retry scheduling. Query snapshots can improve reads, but they do not replace the outbox transaction.”

**Concept:** Read cache and work queue have different responsibilities.

**Trade-off:** There are two persistence concerns, with deliberately separate ownership.

**Implementation limitation:** The prototype uses a custom snapshot hydration path rather than a generic persistence plugin.

### 7. Why not use Zustand?

**Answer:** “I would add it for a concrete client-state need. Here React handles temporary state, TanStack Query handles server reads, and SQLite owns durable work. Mirroring those in Zustand would introduce reconciliation rather than remove it.”

**Concept:** Choose a state owner before choosing a library.

**Trade-off:** Explicit invalidation and hydration rules are still necessary.

**Implementation limitation:** There is no comparative library performance benchmark.

### 8. Can a late cache read overwrite a newer server response?

**Answer:** “Hydration only seeds an empty query. Persisted snapshots use request-start timestamps and reject older writes. That prevents delayed disk reads and competing requests from replacing newer saved information.”

**Concept:** Order asynchronous results, not just requests.

**Trade-off:** Timestamp rules and race tests add complexity.

**Implementation limitation:** This protects the local snapshot lifecycle; it is not a server-side resource version protocol.

## Synchronization and retries

### 9. Can the app synchronize while fully closed?

**Answer:** “There is no guarantee. The durable queue waits, then resumes on foreground or reconnection with a valid session. Background opportunities could improve latency, but correctness must not depend on them.”

**Concept:** Persistence is dependable; operating-system scheduling is conditional.

**Trade-off:** Some claims wait until the customer returns.

**Implementation limitation:** No terminated-app background execution was validated or implemented as a guarantee.

### 10. How do you avoid retry storms?

**Answer:** “Persist the next-attempt time and use exponential backoff with jitter. Serialize mobile runs and use a foreground scheduler for due work. On the server, bound consumers and apply a breaker instead of increasing pressure on a failed dependency.”

**Concept:** Spread retries and respect downstream capacity.

**Trade-off:** Recovery can be deliberately slower than immediate retry.

**Implementation limitation:** Mobile 429 handling is tested as transient behavior; production Retry-After enforcement and cloud throttling are not validated.

### 11. Which errors should not retry automatically?

**Answer:** “A permanent invalid request needs correction, and a missing local file after acceptance needs attention. Authentication pauses for login. A network failure is uncertain and should retain the original operation for backoff.”

**Concept:** Classify by whether another identical attempt could safely succeed.

**Trade-off:** Classification and user-facing explanations need maintenance.

**Implementation limitation:** Transient submissions are not governed by a claimed fixed retry-exhaustion limit in the current engine.

### 12. What if a customer changes accounts during sync?

**Answer:** “Database files and query keys use the issuer/subject namespace. Logout clears memory but preserves that owner's pending work. Sync retains its original token and stops new steps after a session change. It never sends A's work using B's credentials.”

**Concept:** Local ownership must survive asynchronous work.

**Trade-off:** Old owner files remain on disk and need a retention policy.

**Implementation limitation:** An already-sent request may finish. Multi-identity isolation is automated-test evidence; the demo login offers one seeded account.

## Idempotency and consistency

### 13. What if the API accepted a request but the response was lost?

**Answer:** “Replay the same customer-scoped clientClaimId. The uniqueness constraint returns the original server claim and reference. Persist that acknowledgment before any media lookup so a later failure does not erase acceptance.”

**Concept:** Identify the business operation before transport.

**Trade-off:** The client must preserve the ID across restarts and retries.

**Implementation limitation:** A deliberately new ID is a new intake; the mechanism does not infer duplicate real-world incidents.

### 14. What if SQS delivers the same message twice?

**Answer:** “Assume it will. A finalized platform delivery is skipped, and local outcome writes commit together. The external call still needs durable legacy dedupe by the stable reference to cover crashes between external and local commits.”

**Concept:** At-least-once delivery needs idempotent effects.

**Trade-off:** Locks and duplicate checks do not eliminate external ambiguity.

**Implementation limitation:** Tests exercise a PostgreSQL queue substitute, not live SQS.

### 15. What if legacy processed the claim but timed out?

**Answer:** “Do not create a new reference. Query the verified legacy lookup contract. If it exists, repair local delivery state; if absent and dedupe is durable, resend the same reference. If the outcome is unknown, quarantine for operator resolution.”

**Concept:** Timeout is lack of knowledge, not proof of failure.

**Trade-off:** Some recovery requires a human rather than automated retry.

**Implementation limitation:** The current worker retries assuming legacy dedupe; safe ambiguous-outcome quarantine is production procedure, not an implemented operator workflow.

### 16. Why not a distributed transaction across PostgreSQL and legacy?

**Answer:** “The legacy HTTPS boundary is not a transaction participant we control. I commit intake and intent locally, then use delivery and reconciliation. That gives clear ownership without pretending an external commit can be rolled back.”

**Concept:** Local atomicity plus eventual consistency.

**Trade-off:** Pending states and drift monitoring are required.

**Implementation limitation:** Source ordering and business status transitions still need agreement.

### 17. How does reconciliation avoid stale workers?

**Answer:** “Due claims are leased with a generation. A poll persists only while that generation remains current, and timeline/status updates commit atomically. A failed poll changes retry scheduling rather than reversing acceptance.”

**Concept:** Fence obsolete work before it writes.

**Trade-off:** Lease durations and polling load need tuning.

**Implementation limitation:** Source data can itself be stale; without legacy versions the fence cannot guarantee monotonic nonterminal adjudication.

## Photo uploads

### 18. What happens if the app crashes halfway through an upload?

**Answer:** “The accepted claim and durable file record remain. Recovery resets interrupted states, checks server completion and obtains a fresh URL for unfinished evidence. That PUT starts from byte zero. Completed files stay complete.”

**Concept:** Recover independently at the file boundary.

**Trade-off:** Whole-file retry spends bandwidth but fits the assumed ten-megabyte limit.

**Implementation limitation:** The simulator failure was injected before PUT; real OS mid-byte interruption was not manually validated.

### 19. What if the completion response is lost?

**Answer:** “Before uploading again, read the accepted claim and check whether that document is already complete. A completed server record repairs local progress without retransferring the file.”

**Concept:** Reconcile before repeating an uncertain effect.

**Trade-off:** Another read is needed on recovery.

**Implementation limitation:** Completion proves size/type receipt, not a verified checksum or malware verdict.

### 20. Why not send photos in one multipart request?

**Answer:** “A long upload would couple intake acknowledgment to every byte and keep API compute in the data path. Claim-first intake gives an early durable reference and retries files independently.”

**Concept:** Separate metadata acceptance from evidence transfer.

**Trade-off:** The UI and backend need a media-pending lifecycle.

**Implementation limitation:** There is no byte-offset resumable or multipart-upload implementation.

### 21. Does 100% uploaded mean evidence is safe?

**Answer:** “No. Transfer progress only describes bytes sent. The API must confirm receipt, and production security must separately authorize a clean scan verdict for that object version before access or forwarding.”

**Concept:** Transport completion, receipt and safety are different facts.

**Trade-off:** Scanner outage delays availability and requires recovery monitoring.

**Implementation limitation:** Local documents stay not_scanned; no scanner or evidence download path is implemented.

### 22. What if a file disappears or an upload stalls?

**Answer:** “A missing file is actionable and preserves the accepted reference. A transfer with no advancing bytes for sixty seconds aborts and returns to persisted backoff. Manual Retry uploads reuses the accepted claim.”

**Concept:** Avoid indefinite busy state without duplicating intake.

**Trade-off:** A customer may need support when original evidence is gone.

**Implementation limitation:** There is no automatic file cleanup/retention policy or PDF picker; the current picker selects images.

## Mobile performance

### 23. How would you validate performance at production scale?

**Answer:** “Measure startup and hydration latency, scrolling and image memory, SQLite snapshot size, file hashing and transfer behavior on representative low-end devices. Add pagination and bounded retention according to observed workload, rather than claiming the demo proves scale.”

**Concept:** Measure the device constraints the customer actually has.

**Trade-off:** More device coverage and realistic datasets take time.

**Implementation limitation:** Production-scale pagination, Android and physical-device performance remain unvalidated.

### 24. How do you avoid wasting battery with status updates?

**Answer:** “Use push as an optional hint and pull when the app is active or refreshed. Claims usually change over minutes or days, so a persistent socket adds lifecycle work for little customer benefit. Tune polling based on activity and measured cost.”

**Concept:** Match refresh frequency to business freshness.

**Trade-off:** Pull adds delay and network work; hints are unreliable.

**Implementation limitation:** Current read hooks poll while online; a full production background/battery matrix has not been measured.

## Error handling and UX

### 25. What should the customer see during backend failure?

**Answer:** “Waiting to send with retained work and retry information, not Submitted. If the platform already acknowledged the claim, show its reference and separate pending evidence. Saved timeline data should carry a saved-information label and timestamp.”

**Concept:** Tell the customer what is known, not what was attempted.

**Trade-off:** More explicit states than a success/error toast.

**Implementation limitation:** Diagnostics offline mode is process-local and is not evidence of OS airplane mode.

### 26. Why not WebSockets for real-time status?

**Answer:** “Sockets cannot bypass legacy polling or guarantee delivery to a suspended phone. Push can prompt a refresh, and pull retrieves the authoritative projection. I would revisit sockets for interactive adjuster chat, which is a different requirement.”

**Concept:** End-to-end freshness is limited by the slowest stage.

**Trade-off:** Status is eventually refreshed rather than instantaneous.

**Implementation limitation:** APNs/FCM is design only; the local inbox is not real device push.

## AWS scalability

### 27. Why not Lambda for everything?

**Answer:** “Lambda is a valid alternative for event-driven tasks. Fargate fits this shared long-lived Node API and polling worker model without introducing function-specific execution and connection management throughout. I would compare cost and behavior using actual traffic before optimizing the choice.”

**Concept:** Fit runtime shape to workload and operating capacity.

**Trade-off:** Fargate has minimum running cost; Lambda requires different limits and lifecycle design.

**Implementation limitation:** No Lambda/Fargate cost or throughput benchmark was performed.

### 28. How does the design handle fifty claims per second?

**Answer:** “That rate is a planning assumption. Stateless APIs, direct storage uploads and queue buffering separate bottlenecks. RDS connection budgets and worker concurrency still need measurement, and workers must remain capped by legacy throughput.”

**Concept:** Absorb arrival rate without assuming equal downstream capacity.

**Trade-off:** Backlog age can grow even while intake is healthy.

**Implementation limitation:** No production load test establishes that capacity; the concurrent replay test checks correctness.

### 29. Why PostgreSQL rather than DynamoDB?

**Answer:** “The domain benefits from relational ownership checks, unique intake identity and one transaction for claim plus intent. DynamoDB can implement an outbox too, but would require a different access-pattern and index design. SQL keeps this prototype and recovery inventory easy to inspect.”

**Concept:** Choose a data model that makes invariants clear.

**Trade-off:** PostgreSQL requires connection and capacity management.

**Implementation limitation:** This is a reasoned comparison, not a benchmark proving one database faster.

## Security

### 30. How are customer and employee permissions separated?

**Answer:** “They use different issuers, audiences and entry boundaries. The server verifies the token and derives ownership from identity. Employee tools additionally require role and assignment checks; a customer token never grants those capabilities.”

**Concept:** Authentication establishes identity; authorization limits actions and objects.

**Trade-off:** Two identity lifecycles and contracts must be maintained.

**Implementation limitation:** Local verifier tests use dev issuers. Employee claim operations, real federation and refresh tokens are not implemented.

### 31. Does the hashed customer database encrypt local PII?

**Answer:** “No. It names an isolated database using the issuer/subject namespace. Storage protection, retention and device policy are separate requirements. Secure token storage does not encrypt every draft or photograph.”

**Concept:** Isolation and confidentiality are different controls.

**Trade-off:** Production protection may complicate recovery and key lifecycle.

**Implementation limitation:** Database/files are retained after logout and encryption/retention policy remains production work.

### 32. Which parts are not production-ready?

**Answer:** “Real identity and refresh, employee operations, clean-only evidence access, immutable audit capture, live policy eligibility, production queue/cloud deployment, device validation and recovery drills remain prerequisites. Local tests prove selected paths, not an operational security posture.”

**Concept:** A prototype validates bounded hypotheses.

**Trade-off:** Production hardening needs real contracts and operational ownership.

**Implementation limitation:** Production/real auth startup deliberately fails closed; no AWS deployment is claimed.

## Disaster recovery

### 33. What happens to queued operations during a regional disaster?

**Answer:** “The secondary queue is not automatically populated. Rebuild eligible work from surviving claims, evidence and outbox/delivery records, including published records whose old messages are inaccessible. Resolve ambiguous legacy effects first and keep the original reference.”

**Concept:** A queue is transport; retained business intent is recovery inventory.

**Trade-off:** Replication can lose recent inventory, and reconstruction needs an audited manifest.

**Implementation limitation:** This runbook is design only; neither queue reconstruction nor region failover was rehearsed.

### 34. Are the one-hour RTO and five-minute RPO guaranteed?

**Answer:** “No. They are targets conditional on measured replica/object lag, staffing, promotion and reconciliation. A regional event can exceed them. Record the actual loss window and recovery time in drills before making commitments.”

**Concept:** Availability and recoverability need evidence, not just services.

**Trade-off:** Pilot-light is cheaper and simpler than active-active but slower to restore.

**Implementation limitation:** RDS and S3 have independent asynchronous lag; no local test proves these targets.

## Migration and backward compatibility

### 35. How do you support an app version from six months ago?

**Answer:** “Keep the supported v1 contract additive, accept its stable IDs and upload renewal protocol, tolerate unknown statuses and preserve queued work during local migration. Breaking changes get a new API version with an explicit overlap policy.”

**Concept:** Mobile clients cannot upgrade in lockstep with servers.

**Trade-off:** Compatibility extends maintenance and test scope.

**Implementation limitation:** The exact support window and old-binary matrix are not validated; app-config fields do not prove a full upgrade UX.

### 36. How can you roll back without losing accepted claims?

**Answer:** “Stop new cohort assignments while keeping the original owner for accepted claims, their uploads, reads and pending deliveries. Do not replay them through old intake. Fence writers and reconcile before any ownership transfer.”

**Concept:** Rollback changes future routing, not past business ownership.

**Trade-off:** Both paths may need to operate during the transition.

**Implementation limitation:** Stable routing and rollback are production design, not implemented local infrastructure.
