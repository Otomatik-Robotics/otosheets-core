# Statement dedupe rollout — held for release-owner review

Migration 0061 only adds the profile and unassigned partial unique indexes. The old `(user_id, content_hash)` uniqueness remains during expansion. Identical content in two profiles can therefore still encounter the old uniqueness constraint until the contract step; this is an expected rollout limitation, not complete support for profile-specific duplicate uploads.

Do not run the contract during the predeployment migration job. The release owner must first verify deployed API routes, S3/SQS workers, exports, reconciliation and all other statement readers/writers use validated persisted organization/profile scope. Unassigned records need an explicit disposition, without guessing ownership. Any rollback version retained after the contract must also obey that scope.

After that inventory, integrated acceptance and explicit release review, the separate `statement-profile-dedupe-contract.sql` may remove the old index. It checks that expansion indexes exist first and is idempotent. No application request invokes it, and the automatic migration runner does not scan this directory.

After contract, validate identical content independently under profiles A/B and continued dedupe within each profile and within guest/unassigned records. Restoring an unscoped application version is unsafe. Recreating the old index can fail once cross-profile duplicates exist; do not silently delete or reassign data to enable rollback.

No deployment, contract execution, legacy mapping or rollout exception is authorized by this document.
