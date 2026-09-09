# SEC014 scoped matching contract

This is a bounded core contract, not consumer adoption or SEC014/release clearance.

`LedgerMatchPgRepo.withScope(orgId, businessProfileId)` captures immutable ownership. Statement/feed reads and conditional stamps check owned parents in SQL; legacy foreign match/duplicate/transfer references are quarantined. Candidates, invoice/receipt chips, rejection memory, unmatched-income pages/counts and invoice deposit evidence constrain ownership before returning data. Scoped target mutations require an owned invoice/receipt. Unscoped legacy methods remain compatibility ports and must not be used by the scoped APIs.

`mutateInvoiceMatch` locks the owned parent and bank row, then the owned invoice, and applies payment insertion/deletion, invoice balance/status and link/reversal in one transaction. Failure or a suppressed conditional update rolls the whole unit back. Payment identity hashes the exact transaction ID and includes source; records stamp org/profile/user. Replays require the matching scoped payment and link; ambiguous legacy links, orphan payments and conflicting foreign payment identities are quarantined. Reversal subtracts exactly that verified payment from the locked invoice balance, preserving independently recorded amounts without summing unassigned payment rows. Generic stamp/unstamp remain low-level compatibility operations; invoice money APIs must use the atomic port rather than composing those operations with separate payment writes.

Atomic money mutations require `billing-core=pg`. Dynamo, dual_dynamo and dual_pg states fail before data effects with `Atomic invoice matching requires billing-core pg`. No flag changes, automatic fallback, mirror retirement, DDL or legacy assignment are included. HoE owns the functional rollout gate and old-writer/rollback coordination. Read-only scoped matching stays available independently of that money-write gate.

Validation: build and noEmit types pass; 50 tests across the actual PGlite matching and invoice-mutation repositories pass. Cases include foreign/null/unknown ownership, scope rebinding, target references, filtering before pagination/counts, same-user different profiles, foreign legacy links, deterministic payment identity, unsupported modes, replay, competing accepts, different credits sharing an invoice, concurrent accept/reverse, injected storage failures and suppressed conditional updates. PGlite serializes a local connection; these are transaction/rollback regressions, not live Neon multi-connection stress proof. Evidence is under `/Users/leon-ticharwa/.codex/worktrees/sec014-persistent/evidence/ledger-scope-core-{build,types,tests}.log`. Independent exact-head review and all five consumer pins/adoption are still pending.

Independent review of cfdcc430 found two blockers: the atomic path omitted the row-reference quarantine predicate, and deposit payment dates omitted payment profile scope. The correction shares one owned-row SQL predicate between reads, low-level mutations and the locked atomic source query. Foreign, unassigned and missing transfer references now refuse both accept and reverse before money effects. Deposit evidence filters payment profile, withholding foreign/null dates while retaining owned dates. Corrective validation: 56 real-repository tests (33 matching, 23 atomic), build/noEmit pass. Exact bounded re-review is pending; no consumer has adopted the rejected checkpoint.

## Paid-event correction (source migration gate)

Matching API review found missing canonical payment dates and an invalid null-client event payload. The core correction returns `paymentDate` from the payment record and persists an original paid-transition intent in nullable `invoice_payments.match_event`, atomically with payment/invoice/link. Source-only additive migration0062 must be applied by the release owner before adoption is deployed. No legacy intent is guessed or backfilled. Payment DTOs hide this internal column, and generic payment row writers cannot supply it.

An earlier partial credit never gains an intent when another credit later settles the invoice. Concurrent acceptance/replay returns the same stored event identity/time/amount/date/status. Reversal removes the canceled payment/intent; a later fresh paid transition has a new event identity. Paid-transition storage and deletion roll back with failed stamps. Corrective validation:59 real-repository tests, core build/noEmit pass. API strict publication/retry and real registry validation are separate adoption work; a stable event ID alone does not establish downstream exactly-once processing. No background outbox dispatcher is included, and recovery will rely on explicit failed-request retry using the persisted intent unless a separately authorized dispatcher is added.

## Scoped signature-request model — 0064 source checkpoint

`ProfileSignatureRequestPgRepo` is a new PostgreSQL-only namespace. Migration 0064
must run before any new reader. No legacy SIGREQ row is imported or assigned.
The database binds org/profile with a composite foreign key and prevents changes
to request ownership, actor, creation identity, payload and reserved file.
The server supplies a freshly authenticated adviser/client context; the repo does
not authenticate Cognito or replace the authoritative MembershipRepo check.

A client request key, immutable scope and actor determine the request ID; a
normalized payload fingerprint rejects conflicting replays. Upload reservation
accepts only a request-specific canonical profile original. This establishes key
authority, not byte immutability or proof of upload. The adopter must address file
validation/conversion and expired or reusable upload URLs before functional acceptance.
Only one DRAFT -> SENDING claim wins. Any replay, including the same attempt ID,
returns claimed=false. Uncertain SENDING stays pending and has no reset/resend API.
Completion requires the matching persisted attempt and deterministic envelope ID.
Cancellation is similarly claimed; DRAFT cancellation needs no provider effect.
SENT describes delivery completion, not the recipient's eventual signature state.

Nine real PGlite tests cover additive migration replay, profile/org FK, actor and
scope isolation across every method, concurrent creation and send claims, changed
payload conflicts, canonical file reservation, uncertain retry, cancellation,
immutable SQL identity/lifecycle and scoped pagination. Core typecheck/build pass.
This checkpoint has no authenticated API/provider adoption, no live DDL or sends,
and does not close the signature-request functional gap or overall SEC014.

## Signature admission correction and checklist source checkpoint

Source-reviewed core cda6b51 and APP8ced362c use exact owned request send admission
before dispatch, server claim authority on credential and SES writes, and live
owned completion. Terminal delivery races remain pending. Generic draft/credential
ports consult the signature-request table:0064 must precede ALL native/workflow
send consumers, not just new request routes. The app ledger records15 real request
and7 existing envelope tests, API285 and consumer gates. Legacy change-acceptance
and reviewer-verdict lifecycle ports remain open; source clearance is bounded.

0065 adds a separate PostgreSQL profile setup checklist, with immutable composite
org/profile/item ownership and revision CAS. GET returns four static defaults for
missing rows without seeding or importing legacy checklist data. Successful writes
stamp the trusted actor and advance one revision; stale/competing writes conflict.
Actor membership/role is freshly checked by the eventual HTTP adopter, not core.
The profile FK depends on0064's composite unique index and intentionally retains
referenced profiles.0065 must precede checklist readers. Six real PGlite cases and
core noEmit/build pass, including read-without-write, scope/FK/override refusal,
concurrent insert/stale revision, actor stamps and migration replay/immutability.
No legacy import, live DDL, API adoption or checklist functional acceptance yet.

## DOCREQ metadata and reserved-file checkpoint — 2026-09-09

New source-only migration0066 follows0065 and must precede any new DOCREQ reader.
It adds profile_document_requests and profile_document_request_files with composite
profile/org ownership and child request/org/profile/adviser foreign keys. No legacy
DOCREQ/PROSPECTREQ import, ownership assignment, or default-profile fallback exists.

ProfileDocumentRequestPgRepo copies immutable trusted org/profile/adviser context.
Fresh caller grants are the eventual API adopter's responsibility. Stable creation
identity uses scope/adviser/client key and normalized payload fingerprint; altered
replays conflict and cancelled requests never reopen. Reads and bounded keyset
pages use exact scope. Cancellation requires the current OPEN revision.

File reservation holds the exact parent lock, derives a canonical profile/request
key, and atomically advances revision with the inserted reservation. Stable per-
uploader file keys replay without a second revision or insert; changed file metadata
conflicts. Closed parents refuse even old reservation replays. File get joins exact
owned parent and file. Parent ownership/creation payload and every reservation
field are immutable by SQL triggers. Declared hash/size constrain a future verifier;
RESERVED is not an attachment, uploaded-byte proof, or completed ingestion.

Validation:8 real PGlite tests, noEmit and build pass, including actual migration
replay, isolation, create replay, revision winners, reservation/cancellation order,
and transaction rollback with an injected SQL failure. Serialized local tests do
not establish live Neon multiconnection behavior. No full suite or live actions.

APP1fb615f4c087126b415eb92539fa05c0c61afcbc is source-cleared containment only:
all8 legacy DOCREQ handlers and reminder/digest cron passes remain unavailable.
No API restoration in this checkpoint. Owned attachment verification, ingestion
identity/status, owner-side request discovery, paginated file retrieval and fresh
recipient/reminder admission remain future contracts. All previous0064/0065 gates,
clientSummary503, non-atomic checklist audit and whole SEC014 exclusions remain.

## DOCREQ same-revision attachment admission — 2026-09-09

Migration0067 follows0066 before attachment readers. Separate immutable attachment
rows pin configured bucket, exact reserved key, actual object VersionId, hash/size,
uploader and timestamp; reservation rows never change. attachVerified accepts only
trusted verifier output (not an HTTP body), locks exact owned OPEN parent, requires
reservation uploader/hash/size, and atomically inserts attachment plus advances the
same revision observed during verification. Matching replay returns the original
attachment without another revision; closed parents refuse even replays. Changed
object versions conflict. getAttachment remains metadata, not download authority.

Validation:11 real PGlite tests and noEmit/build pass, adding attachment replay,
stale proof/uploader/hash/version refusal, cancellation ordering, migration replay
and immutable SQL evidence. This is not live Neon contention or S3 proof: the caller
must supply fresh grants and trusted actual-version evidence. No fulfillment,
ingestion or API restoration occurs.0064/0065/0066 gates remain; APP DOCREQ/cron
quarantine stays closed while production adapter and ingestion/download contracts
are reviewed.

## DOCREQ client discovery checkpoint — 2026-09-09

ProfileDocumentRequestClientPgRepo adds read-only exact org/profile get and bounded
keyset list for freshly authorized client members. It can discover requests from
multiple advisers within that profile and returns the immutable persisted adviser
identity for selecting the request-specific mutation port. HTTP bodies cannot supply
that authority. No org-wide fallback, file signing or mutation is added. No new
migration;0067 and earlier reader gates remain.12 focused PGlite tests, noEmit/build
pass; new case covers exact client discovery across advisers, foreign-profile/org
refusal and paging. Live grants/HTTP cursor binding remain adopter responsibilities.
