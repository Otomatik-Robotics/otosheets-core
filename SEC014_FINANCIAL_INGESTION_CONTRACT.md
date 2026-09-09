# Financial document ingestion admission — source contract

Continuation from core `406ec74e392724a116286a8e136ac666be5891e1`, isolated on
`codex/sec014-financial-document-ingestion`. GENERAL APP PR512 at
`0d029f4abcc25a8da28c68bcf84e4490e3d2b927`, core406 and its existing consumer pins
remain frozen. Migration0069 is source only and is not part of PR512's approved
pending migration set. This checkpoint does not restore financial routes.

## Implemented boundary

`ProfileDocumentRequestIngestionPgRepo` admits one immutable metadata record per
owned verified attachment. The statement or receipt target ID is deterministic
from the organisation/profile/adviser/request/file/type identity. The explicit
target user and statement financial year are fixed at first admission. A retry
returns the same record without increasing the parent revision; a changed target
user or year conflicts. A noncanonical pre-existing target ID also conflicts on replay or metadata lookup.
The request remains OPEN and admission remains RESERVED.
Neither value implies a queued job, financial record, extraction or fulfillment.

Admission locks the exact owned parent and requires its current revision, OPEN
status and financial request type. It requires an existing attachment, compares
its scope/key/hash/size/uploader with the immutable reservation, and checks the
declared format for the target kind. It accepts no caller-supplied source bucket,
key, VersionId, target ID or status. The returned source comes from the persisted
attachment's bucket/key/VersionId/hash/size. It never chooses the latest S3 object.

The attachment is already immutable. A composite foreign key from the admission
prevents its deletion or replacement while admitted; a second composite foreign
key binds the parent type as well as organisation/profile/adviser. Admission UPDATE
and DELETE are rejected in SQL so deleting a dedupe marker cannot remap a target.
The parent revision increment and admission insert are one database transaction.
No migration0068 trigger or GENERAL fulfillment rule is altered.

An exact scoped metadata getter exposes the persisted admission and parent status,
including cancellation, for later status/audit UI. It does not claim work or grant
permission to read/process a source. An admission replay against a closed parent
always refuses. There is no list-all fallback, implicit owner lookup or legacy import.

## Trust and limits

The caller must freshly authorize the acting user, persisted adviser relationship,
explicit target user and selected client profile. The core port validates storage
identity and consistency; it does not itself prove membership or make an arbitrary
target user authorized. A future owner/admin adapter can explicitly use its admitted
actor as the target user; it must not pick the first organisation owner. Adviser-led
target selection requires its own explicit, reviewed authority contract.

Stored attachment metadata and a declared MIME type are not fresh byte verification,
safe parsing, malware scanning or correct financial classification. Before effects,
the adapter must read only the configured bucket and persisted VersionId, verify
actual hash/size/format, reauthorize grants and recheck request cancellation/revision.
No S3 operation, copy, queue, provider call, statement/receipt creation or financial
write is implemented by this port. Normal receipt/statement upload pipelines are
unchanged and must not be used as an unreviewed raw-key fallback.

The stable target ID does not establish destination creation/replay safety. The next
contract must atomically create or validate the exact owned statement/receipt target,
refuse a conflicting existing destination, preserve uncertain/partial processing
states and prevent duplicate downstream effects. No exactly-once queue/provider or
DB/S3 atomicity guarantee is claimed. Concurrent local PGlite tests are not proof of
multi-connection Neon behavior. Privileged DDL/trigger removal is outside this port.

## Validation and remaining work

The new real-PGlite suite covers stable identity/version and replay, changed target
payload, financial type/year/format constraints, caller override refusal, foreign
organisation/profile/adviser/parent/file isolation, missing attachments, stale and
closed parents, preserved GENERAL-only fulfillment, inconsistent persisted source,
same-file and distinct-file concurrency, cancellation, immutable marker/attachment
constraints, transaction rollback on parent write failure and migration replay.
The first rollback test expected the nested PostgreSQL error at the Drizzle wrapper
message; the assertion was corrected to inspect the actual cause. Product code did
not change for that fixture correction. Final core build and full Vitest suite pass: 92 files / 968 tests, including all11
new ingestion and15 existing request tests. Evidence: financial-admission-core-full-tests.log
in the persistent evidence directory. No live acceptance is claimed.

- [x] Define immutable scoped admission and version-pinned source identity.
- [x] Add source-only0069 schema, repository and meaningful local regressions.
- [x] Complete final build and full core validation.
- [ ] Obtain bounded independent source review.
- [ ] Adopt the reviewed core in separate continuation consumers; frozen GENERAL
  release pins and policy remain unchanged.
- [ ] Add atomic owned destination creation/replay and explicit processing outcomes.
- [ ] Add guarded version-pinned byte validation/worker admission and recovery.
- [ ] Restore financial routes/UI only after that complete contract is reviewed.
- [ ] Obtain separate migration/release approval and run live A/B/foreign/legacy,
  storage, cancellation/revocation and replay acceptance. Production/SEC014 hold,
  legacy raw-key handlers, financial route gates and DOCREQ cron remain closed.
