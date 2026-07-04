-- Email is not an identity key: Cognito permits the same email across
-- identity providers (a federated Google login and a native login are two
-- distinct subs). Found in dev during the identity backfill. Demote the
-- unique index to a plain lookup index (same semantics as Dynamo's
-- EmailIndex + Limit 1).
DROP INDEX IF EXISTS users_email_uq;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);
