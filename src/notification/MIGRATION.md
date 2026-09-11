# Notification Postgres cutover

Implementation is opt-in and has not been deployed or backfilled. Migration 0058 adds
`notifications`; it does not change the existing Dynamo table or stream.

The public `NotificationRepo(ddb)` API remains at `notification/repo.ts`.
`createNotificationOnce` and `createNotification` both insert or do nothing on an
existing recipient/ID, preserving read state, payload, creation time and expiry.
Callers must supply a stable ID for retries: this does not deduplicate random IDs or
external push side effects. Inbound email's deterministic notification IDs are
preserved. Dynamo mark-read no longer creates a partial missing record.

`listNotificationsPage` returns `{ items, nextToken? }` with descending notification
IDs and a recipient-bound opaque token. Limits are 1–200, default 50. Continue while
`nextToken` is present, even if a Dynamo page is empty after filtering expired items.
The old array-returning `listNotifications` remains for compatibility; the backend's
capped unread count/mark-all-read endpoints still need a separately coordinated fix.

## Authority and deployment gates

`DATA_BACKEND_NOTIFICATIONS` overrides
`{DATA_BACKEND_SSM_PREFIX}/notifications`. Supported values are `dynamo`,
`maintenance`, and `pg`; absent configuration defaults to `dynamo`.
Invalid configuration and SSM errors fail closed. Maintenance rejects all routed
operations. The SSM cache lasts five seconds; environment overrides bypass SSM.
There are no dual writes or runtime failure fallbacks. Do not remove the flag after
cutover: absent configuration still selects Dynamo.

Before changing authority:

1. Verify each deployed caller's core hash, override, SSM prefix/permission and
   database bootstrap. Include inbound email, notification APIs, push helpers,
   crons, agents and any direct Dynamo writers. Core changes require a coordinated
   full-hash consumer repin; this local implementation does not repin consumers.
2. Confirm source families and recipient ownership. The current contract is a
   recipient inbox, with optional organization metadata. Preserve this scope;
   business-profile ownership is not inferred. Resolve #497 and confirm the desired
   profile authorisation contract before a profile-scoped cutover. The JSON record
   preserves sparse/unknown source attributes without introducing guessed owners.
3. Run additive migration 0058 before consumer code. Verify app-role table grants
   under the migration owner used by that environment. Deploy with Dynamo authority
   and verify all relevant handlers before scheduling a coordinated pause.
4. Pause all notification writers/readers through maintenance and drain/wait for
   in-flight work. Overrides and old deployed consumers can bypass the SSM pause;
   they must be stopped independently. Wait beyond cache/in-flight duration and
   verify quiescence. Inventory the notification stream/direct pollers and their
   side effects before any authority change.
5. Create a dry-run manifest and resumable family/recipient backfill. The Pg
   `importNotification` primitive preserves source data/TTL and inserts only;
   it deliberately never overwrites an existing target. It is not a CDC engine or
   complete backfill command. Conflicting pre-existing rows require reconciliation,
   not silent acceptance. Do not run an online scan followed by a flag flip.
6. Reconcile IDs, canonical payloads (including read state), ownership, TTL and
   counts per recipient. Account explicitly for source TTL deletions and expired
   rows; do not compare approximate DescribeTable counts. Verify pagination, expiry,
   retries, email notifications and real push journeys in coordinated dev rollout.
7. Set `pg` only after reconciliation and consumer readiness, then release writers.
   Promote through the approved production pipeline with independently verified
   production source/account evidence. No manual production deployment.

## Expiry, retention and recovery

Both backends hide records whose TTL is at or before the current Unix second.
Missing/null TTL remains visible; creation uses 90 days. Pg
`deleteExpired(limit)` removes at most 200 expired rows per call with row locking
and skip-locked semantics, and is safe to retry. It is a maintenance primitive;
no scheduler has been deployed. Schedule bounded cleanup only after retention and
recovery requirements are agreed. Visibility does not depend on cleanup running.

Dedupe lasts while the recipient/ID row exists. Deleting it (explicitly or through
expiry cleanup) permits that ID to be created again, as Dynamo TTL already did.
Triggers needing a longer dedupe window need separate durable claims. Deletion
is not an idempotency tombstone and insert-only import must not race application
deletes; the write pause is a required backfill condition.

After new Pg writes, Dynamo is stale. Rollback needs writer quiescence and a verified
reverse migration/export, not an unverified flag flip. Agree observation duration,
retention and recovery evidence before removing readers, IAM, streams or tables.
Those changes are not part of migration 0058. #498 remains open.
