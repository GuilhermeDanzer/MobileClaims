# Mobile Offline-First Design

How the React Native app keeps claim submission correct and understandable on a flaky or
absent connection. This is the customer-visible contract; the implementation lives in
`apps/mobile/src/features/sync` and `apps/mobile/src/db`.

## The guarantee

A customer is **never told a claim was submitted before the backend confirms it**. Locally the
claim moves through explicit states, and the device reuses the same `clientClaimId` on every
retry, so the server's unique index (`(customer_id, client_claim_id)`) is the authoritative
duplicate guard — a lost or ambiguous HTTP response can only ever produce one claim.

## Device states → copy (single mapping, `features/claims/status-copy.ts`)

| Device state | What the customer sees |
|---|---|
| `draft` | Saved on this device |
| `queued` | Waiting to send — retries automatically |
| `submitting` | Sending claim — waiting for platform confirmation |
| `accepted` | Submitted · `reference` (only after server confirmation) |
| `media_pending` | Submitted · `reference` — photos still uploading |
| `complete` | Submitted · `reference` — all documents received |
| `needs_attention` | Needs your attention |

Server-side statuses (`received`, `legacy_accepted`, `under_review`, `approved`, …) are mapped
separately, and unknown future statuses are rendered verbatim rather than crashing or lying.

## Durable local state (SQLite, `user_version` migrations)

- `drafts` + `draft_attachments` — the claim and its photos; `client_claim_id` is minted once
  when the draft is first saved and never regenerated.
- `submission_queue` — the outbox; one row per draft with `state`, `attempts`, `next_attempt_at`,
  `claim_id`, `reference`.
- `read_snapshots` (migration v2) — validated, full GET response payloads and request-start
  timestamps for claim lists, individual details, timelines and policies. The old normalized
  cache tables/repos remain for compatibility; current hooks use snapshots exclusively.

Photos are copied into `Paths.document/claim-drafts/<draftId>/` at capture time and their
SHA-256 (the value the API's document manifest requires) is computed once and stored.

## Sync engine (`features/sync/sync-engine.ts`)

A pure orchestrator (no React, no Expo) that runs claim-first:

1. **Recover** — anything left `submitting`/`uploading` by a crash goes back to a retryable state.
2. **Submit** — `POST /v1/claims` with `clientClaimId`, policy, incident, and the document
   manifest. On 200/201 it maps server `documentId`s back to attachments by filename (works for
   both fresh creates and idempotent replays).
3. **Upload** — for each incomplete attachment, re-issue a presigned URL
   (`POST /v1/claims/:id/documents/:docId/upload-url`, added in Phase 4), PUT the file with
   progress, then `POST …/complete`. Partial progress is preserved across retries.

Failure classification:

- `401` → keep retryable; the session flips to signed-out and re-login resumes it.
- permanent `4xx` → `needs_attention` with the server's message; the draft is preserved.
- timeout / network / `429` / `5xx` → exponential backoff with jitter (2 s base, 5 min cap),
  same `clientClaimId` on retry.

Triggers: app start, foreground, network recovery (`expo-network` listener), post-submit, and a
manual "Sync now" in Settings. Correctness never depends on background execution — foreground
sync is the guarantee.

## Reproducing failure scenarios (diagnostics screen)

The Settings tab exposes, for the demo, the same fault controls the backend simulates:

- **Force offline** — the sync engine refuses to send; drafts stay on device.
- **Drop the next upload** — simulates an interrupted upload; the attachment returns to a
  retryable state and the claim stays `media_pending`.
- **Sync now** and a live local-submission list show what is in flight.

The backend side is controlled with `POST :4000/dev/faults` (`down`, `slow`, `reject`, …) and
`POST :4000/dev/status` (drive reconciliation), per `docs/FAILURE_SCENARIOS.md`.

## Known limitations

- The API binds to `0.0.0.0`, so a physical device reaches it over LAN without a Settings
  override. Presigned URLs still point at `localhost:4566`, so photo upload works on the
  simulator but needs a LAN-visible object store or real S3 on a device — documented, not faked.
- The demo identity is one seeded customer (`POST /dev/auth/customer`); the API issues
  tokens that do not survive an API restart, so a 401 simply prompts re-login.
- `sha256` is declared metadata; the server verifies size/content-type on `complete`, not the
  hash (unchanged backend behavior).


## Phase 6.5 — persistent reads and identity isolation

`useSnapshotQuery` is the single read-hydration path. Before enabling a network query it reads
SQLite, validates the payload against the shared response schema and seeds TanStack Query
only if the query has no data. A restored snapshot retains its original timestamp and is
marked as saved information. Empty or incomplete/corrupt snapshots produce an explicit empty
or unavailable state, never a fabricated full claim. Claim details/history are available
only after those resources have actually been fetched; fetching the list does not prefetch
all evidence or timelines. Saved status is last-known status, not a prediction.

Successful responses replace the snapshot with an atomic upsert. The request-start timestamp
orders competing responses; an older write cannot replace a newer snapshot. Hydration never
replaces existing query data. Connectivity recovery invalidates reads and foreground polling
refreshes claims. Policies have a **15-minute freshness TTL**, with an explicit reconnect
refresh; expiry does not delete offline availability. Offline/stale policy selection is not
coverage authorization. At intake the API now checks the existing customer-owned `active`
policy snapshot inside its transaction. Unknown, foreign or inactive policies return
`POLICY_UNAVAILABLE`, preserving the local draft/evidence for correction. Replays of an
already accepted claim still succeed after a policy changes. No incident-date/coverage
eligibility rule or live policy-system revalidation was invented.

Each local database is named with SHA-256 of the JWT `[issuer, subject]` namespace. Query keys
include that namespace. This is local isolation, not JWT signature verification or encryption;
the API continues to verify tokens. Missing identity fails closed. Offline reads require a stored unexpired session; first login
or expired-token reauthentication requires the API. Logout clears query memory
and removes the token, retaining the owner's database/files. Re-login with the same identity
recovers that owner's queue. Another identity opens a different database. Sync captures the
original database/token and stops starting new remote operations when that session changes;
a request already sent may finish using its original token. No A operation receives B's
credentials. A late A-token 401 cannot log B out. Wizard state remounts with identity.

**Historical data:** `northwind-claims.db` is quarantined by leaving it untouched and unopened.
Unscoped rows and their files are not assigned to the next customer, deleted, displayed or
submitted. Recovery requires an explicit, verified ownership migration; there is no recovery
UI. Existing pre-6.5 pending items are therefore retained but unavailable in the new UI.

The server acknowledgment is persisted before document lookup. A failed lookup leaves the
accepted claim in `media_pending`; document IDs are recovered by the existing filename
mapping on the next upload attempt. Each attempt gets a new URL and reconciles server
completion first. Missing files/permanent media validation failures park visibly with the
accepted reference intact. Settings provides **Retry uploads**, which preserves the claim ID
and never creates a second claim. Accepted claims with pending evidence stay on the dashboard,
including pending filenames, transfer progress and retry timing. Native byte counters are
converted to numbers at the upload boundary (SDK runtime counters can be bigint). Transferred bytes are not
called confirmed uploads. Rejected unaccepted drafts reopen for correction.

Photo capture validates size before hashing, requests camera permission with a useful denial
message, and retains the durable draft directory/copy behavior. The picker remains image-only;
PDF is a supported manifest/storage type, not a new document-picker flow. No automatic file
cleanup was added; recovery files remain available. Buttons expose disabled/selected states,
back/primary actions have at least 44/48-point targets, and incident fields have explicit
labels plus keyboard avoidance and scroll dismissal.

### Interview explanation

| Problem | Chosen approach and advantages | Alternatives and trade-offs | Failure behavior |
|---|---|---|---|
| Reads disappear after process death | SQLite response snapshots hydrate TanStack Query; server schemas/timestamps stay intact | Generic query persistence or normalized-table reconstruction would add hydration machinery or partial-detail semantics; response blobs duplicate some server fields and have no retention policy yet | Cache miss/corruption is explicit; last-known data remains labeled; reconnect refreshes |
| Account changes can expose/send another owner's data | One database per issuer/subject plus scoped query keys and session-fenced sync | Owner columns across every repo were considered; files give a smaller complete boundary but leave more database files and require a verified legacy migration | Logout retains A's work, B cannot query/drain it, A can resume; original in-flight requests may finish |
| Claim accepted but media lookup/upload fails | Save acknowledgment first; retain existing claim-first sync and idempotency; reconcile each document before reissuing URL | A single claim-and-photo request would couple all failures; two phases require explicit pending-media UX | Accepted ID/reference survive; only pending media retries; permanent failures are actionable |
| Offline policies become stale | 15-minute snapshot freshness, indefinite offline readability, API ownership/active check | Blocking expired snapshots would prevent offline drafts; broad eligibility logic needs a real domain contract | Rejection keeps draft and files; accepted replays remain stable; coverage eligibility is still a production integration requirement |

### Assessment demo script

1. Start the local API, storage and Expo server using the existing README; sign in online.
   Open New claim once to cache policies, then open an existing claim to cache detail/history.
2. Enable Settings → Force offline. Select a saved policy, enter incident details and attach
   a library photo. Save as draft and reopen it from Claims to demonstrate retained input.
3. Submit while forced offline. Show Waiting to send and its pending filename. This is a
   durable queue operation, not server acceptance.
4. For restart with an actually unavailable backend, keep network disabled externally or use
   the existing API URL override temporarily pointing to an unreachable local port. Restart
   Expo Go/open the project. The diagnostics flag itself is intentionally process-local and
   resets on restart; it is not proof of OS-level airplane mode.
5. Restore the original API URL/connectivity and disable Force offline. Keep the app foreground;
   allow the persisted backoff/5-second scheduler to run. Show the accepted reference, then
   evidence pending and completion. Do not interpret 100% transferred as confirmed completion.
6. Use Drop the next upload before recovery to exercise a deterministic interrupted-upload
   failure. Wait for automatic recovery or use Settings → Retry uploads; open the claim to
   identify pending evidence and track the server timeline.
7. Explain that account B is covered by automated identity/database tests; the local sign-in
   screen issues only one demo identity and cannot demonstrate a genuine second login.

Executed evidence and limitations for this script are recorded in IMPLEMENTATION_STATUS.md
and FAILURE_SCENARIOS.md. This script is a reproducible procedure, not a claim that every
step was manually run. No AWS services were provisioned or contacted.

An upload with no advancing byte count for 60 seconds is cancelled via the SDK AbortSignal,
then returns to durable retry/backoff with a fresh URL. Active transfers reset the idle
deadline; timers are cleared on every outcome. This avoids an indefinitely busy sync worker
without imposing a short total time limit on a slow, progressing mobile transfer.
