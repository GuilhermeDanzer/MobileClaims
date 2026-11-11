# Architecture Presentation Script

Candidate recording guide · spoken English · approximately 12 minutes at 150 words/minute, excluding optional demonstration. Rehearse timing before recording; correctness takes precedence over rushing. The spoken text is in “What to say”; screen directions and reasoning are notes, not narration.

Keep the three exported diagrams open. Zoom to each area instead of trying to read an entire production topology at once. No video has been recorded or generated. Final recording link: **[add candidate video link after recording]**.

## 1. Introduction — 0:00–1:00

**What to show on screen:** Main design executive summary, then [Diagram 1](diagrams/production-architecture.svg), zoomed to mobile, API, queue and legacy.

**What to say:**

“Northwind Mutual has a mobile claims problem with a reliability consequence. During severe weather, more people need to report damage at exactly the time the backend and on-premises dependencies are under the most pressure. Customers also need to understand what happened to their claim without calling support.

My main design principle is to separate durable intake from downstream processing. A slow claims system should delay processing, rather than make a customer repeat their report.

I will start on the phone, because that is where failure becomes visible to the customer. Then I will follow a submission through the backend and legacy integration, before covering security, scaling, migration and recovery.

The challenge asks for an architecture design. I also built a local proof of concept to validate selected failure behaviors. The AWS diagram is a proposed production design; it has not been deployed.”

**Key technical reasoning:** Separate the customer acknowledgment boundary from legacy availability. Establish evidence limits before showing infrastructure.

**Transition:** “First, what does Submit mean when the customer has no connection?”

## 2. Mobile-first experience — 1:00–4:05

**What to show on screen:** [Diagram 2](diagrams/mobile-offline-sequence.svg). Focus on SQLite, acknowledgment and the per-document loop. Optionally show a prepared screenshot of Waiting to send and Submitted/photos pending; do not spend recording time starting services.

**What to say:**

“The app uses React Native and Expo. Screens render the workflow, but durable work belongs in SQLite. That includes the draft, attachment records, submission identity, retry count and next retry time.

I separate three kinds of state. React owns temporary interface and session state. SQLite owns work that must survive a crash. TanStack Query owns server reads in memory. Validated SQLite snapshots hydrate those reads after restart. I do not add Zustand or Redux because there is no additional state responsibility that needs a second global store.

Imagine the customer fills in an incident while offline. The draft and photographs are saved locally. Tapping Submit commits an outbox operation with the same client-generated claim ID. The screen says Waiting to send. It does not say the insurer has accepted anything yet.

When the app reconnects or returns to the foreground, the sync engine checks due work. Temporary failures use persisted exponential backoff and jitter. There is also a foreground timer so recovery does not depend on another network event. A fully terminated app is not guaranteed to synchronize. Correctness depends on durable storage and recovery when the app is open, not on the operating system granting background time.

Now suppose the API commits the claim but the response disappears. The phone cannot tell whether it succeeded. It retries with the original clientClaimId, and the database uniqueness constraint returns the original claim. Generating a new ID during retry would defeat the entire design.

Once the acknowledgment arrives, the phone saves the server ID and reference before attempting another lookup. Only then does the interface say Submitted. Photographs can still be pending. That separation prevents an upload failure from making an already accepted claim look unsubmitted.

Each photo has a durable file copy and its own completion state. The app requests a short-lived upload URL, sends bytes directly to storage, then asks the API to confirm receipt. Transfer progress is not confirmation. If the app crashes, recovery checks whether the server already completed that document before uploading again. It gets a fresh URL for a pending file. This is file-level recovery; interrupted bytes restart from the beginning, rather than resuming at an offset.

Permanent failures remain visible. An unsent policy rejection preserves an editable draft. A missing file after acceptance preserves the reference and offers upload recovery without creating another claim.

For reads, a previously fetched list, detail or timeline can survive restart with its saved timestamp. A list does not magically provide every full detail. Policy snapshots have fifteen-minute freshness, but stale policies remain selectable offline. The API is still responsible for authorization; the prototype checks ownership and active status, not live coverage eligibility.

Finally, account isolation is part of mobile correctness. Database names and query keys are scoped by issuer and subject. Logout clears memory and credentials while retaining that owner's pending work. A new account cannot drain the previous queue. Already-sent requests can finish with their original token, but later steps stop after the session changes.”

**Key technical reasoning:** Persist intent before transport; persist acknowledgment before follow-up work; distinguish local durability, platform receipt and evidence receipt. Account isolation and cache freshness are part of recovery.

**Transition:** “The same distinction between durable intent and completed delivery continues on the server.”

## 3. Backend and enterprise integration — 4:05–6:10

**What to show on screen:** Diagram 2 from API transaction to reconciliation, then [Diagram 3](diagrams/failure-recovery.svg), focusing on the ambiguous-outcome branch.

**What to say:**

“The API commits the claim, document metadata, initial timeline event and outbox intent in one PostgreSQL transaction. If I published directly to a queue and then committed the database, either side could succeed alone. The outbox removes that acceptance-versus-intent gap.

Publishing is still a separate operation. A publisher can enqueue a message and crash before recording publication. That can produce another message later, which is why this design assumes at-least-once delivery.

Claims with required evidence remain held until receipt is confirmed. In production, scan clearance is an additional gate. The local prototype validates size and type and labels evidence Not scanned; it does not perform malware scanning.

Workers process eligible messages independently of customer requests. Temporary legacy failures back off. A circuit breaker avoids repeatedly calling a known-down service. A permanent business rejection becomes a visible outcome, while exhausted transient or poison failures move to a dead-letter queue for investigation.

Local locking and finalized-outcome checks prevent repeated delivery from duplicating committed platform outcomes. But there is a more difficult window: legacy creates the claim and the worker crashes before recording success.

A database transaction cannot undo that external commit. Safe replay requires the real legacy system to deduplicate durably by the same platform reference. If that contract is unavailable, we must look up the result and hold unresolved work for an operator. The local stand-in deduplicates in memory, which does not prove production durability. I do not claim exactly-once processing across systems.

Legacy owns adjudication. The platform owns intake and the customer-facing projection. A leased reconciliation loop polls legacy and appends changed statuses. Generation fencing prevents an expired worker from overwriting a newer result, but source ordering still requires a verified contract. A failed poll delays freshness; it does not reverse claim acceptance.”

**Key technical reasoning:** Atomic intent is different from atomic distributed delivery. Make ambiguity an explicit operational state, not an excuse to generate a new claim.

**Transition:** “Now we can scale intake without treating legacy throughput as elastic.”

## 4. AWS architecture, security and operations — 6:10–8:15

**What to show on screen:** Diagram 1: edge and AZs, direct upload path, employee boundary, telemetry. Zoom each area as it is discussed.

**What to say:**

“The storm planning scenario is fifty claims per second for several hours. That is an assumption, not a measured benchmark. The production architecture isolates the resources that respond differently to that load.

At the edge, WAF limits abuse and API Gateway applies token checks and throttles. A private integration leads through an internal load balancer to stateless Fargate API tasks across two availability zones. The API still enforces ownership. Personalized responses must not enter a shared cache.

Direct S3 uploads keep large photo transfers out of API compute. PostgreSQL provides the intake transaction and uniqueness constraints. RDS Proxy reduces connection pressure as tasks scale, while Multi-AZ improves in-region availability. None of those services removes the need to measure database latency, connection budgets and actual failover.

SQS absorbs the difference between arrival rate and legacy drain rate. Workers scale on backlog age and depth, but concurrency is capped by legacy capacity. Scaling workers aggressively against an outage would amplify the problem rather than solve it.

Customers authenticate through Cognito. Employees use Entra ID through a separate internal boundary with role and assignment authorization. Local tests exercise verification with separate development issuers. Real federation and employee claim operations remain production work.

Production data uses encryption in transit and at rest, private storage, managed keys and least-privilege roles. Uploaded objects stay quarantined until scanning marks the relevant object version clean. Every download and forwarding path must enforce that gate. The prototype does not implement it, and document receipt must never be described as proof of safety.

For operations, I want to answer three separate questions: are claims being accepted, is evidence completing, and is legacy processing catching up? Structured logs, correlated traces and metrics connect the API, outbox, queue and integration. Alerts track intake success, oldest queued work, dead letters, media age, reconciliation delay and replication lag. End-to-end cloud tracing is proposed; the local evidence is logs, correlation IDs and diagnostic counters.”

**Key technical reasoning:** Scale independent resources while respecting the least elastic dependency. Authorization and scan gating follow data across all entry and access paths.

**Transition:** “Availability within one region is only part of operating this system safely.”

## 5. Migration, compatibility and disaster recovery — 8:15–10:25

**What to show on screen:** Design §11, then Diagram 3 regional branch and Diagram 1 recovery region.

**What to say:**

“I would migrate with a strangler approach. Start with read-only comparisons, then move stable customer cohorts through small traffic gates. Each claim has one intake owner, and retries continue to reach that owner after the rollout percentage changes.

I would not shadow customer writes into both creation systems. For a claim owned by the new platform, its worker is the only path that creates the corresponding legacy claim.

Rollback stops new assignments. It does not abandon claims already accepted by the new system. Their reads, uploads and queue processing remain available. Any ownership transfer requires fencing obsolete writers and reconciling the inventory first.

Mobile compatibility changes the release strategy. A customer may keep an old binary for six months, with pending operations stored on the phone. Version one APIs therefore evolve additively. Breaking contracts get another version and an overlap period. Old payloads, stable IDs and upload renewal must keep working. Unknown statuses need a safe display rather than a crash.

Feature flags and staged releases reduce exposure. Compatible JavaScript updates can use EAS updates within runtime compatibility, while native changes require a new store binary. We cannot coordinate every device installation with a server deployment. Existing customer identity migration and a tested old-binary matrix remain prerequisites.

For disaster recovery, Multi-AZ handles in-region disruption. A regional event uses a pilot-light region with an asynchronous database replica and replicated object versions. The targets are a one-hour recovery time and a five-minute data loss window. They are not guarantees, and object lag can differ from database lag.

SQS is regional, so the other region does not simply inherit the queue. Recovery uses surviving claim, evidence and outbox records to reconstruct pending work, including work previously marked published. Records missing from replication cannot be assumed recoverable.

The runbook fences the original writers, promotes the replica and verifies inventory and evidence. In-flight legacy requests are ambiguous because legacy may be ahead of the recovered database. Resolve those outcomes before replay. Keep consumers paused, build an audited recovery manifest, run canaries, switch traffic and resume gradually. Production owners need to rehearse this before accepting the targets.”

**Key technical reasoning:** Preserve ownership through rollout and rollback. Regional durability spans database, objects, delivery state and external effects; promotion alone is insufficient.

**Transition:** “The remaining question is what this design buys us, and what evidence still needs to be gathered.”

## 6. Trade-offs and conclusion — 10:25–11:30

**What to show on screen:** Design §12 and README validation/limitations. Finish with links to design, diagrams and coverage.

**What to say:**

“The most consequential trade-off is accepting eventual consistency in exchange for reliable intake. That creates pending states, retry logic and operational reconciliation, but it avoids coupling a customer's report to every downstream dependency.

SQLite adds migration and retention responsibilities. Two-phase uploads add completion state. Fargate and PostgreSQL keep the runtime understandable, but require capacity validation. Pilot-light recovery avoids concurrent regional writers, at the cost of manual promotion and replication exposure.

The optional prototype validates selected behavior, not the whole production system. The latest recorded evidence includes fifty API tests, forty-five mobile logic tests and thirty-four SQLite and sync tests, with scoped iOS simulator recovery. Those are historical executed results from the audit supplement. They do not prove Android behavior, real device interruption, cloud scaling, malware scanning, federation or regional recovery.

Before production I would prioritize the legacy dedupe and lookup contract, live policy authorization, evidence security, identity lifecycle, representative device validation, load testing and recovery drills.

The core design remains straightforward: preserve the customer's work, acknowledge only durable acceptance, make evidence progress explicit, and let downstream processing recover without asking the customer to start over.”

**Key technical reasoning:** Report bounded evidence, accepted costs and concrete validation priorities. Do not use test counts as throughput proof.

**Transition / closing:** “The written design and requirement map provide the detail behind each diagram. Thank you.”
