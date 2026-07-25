-- Per-org studio entitlement (0035).
--
-- `enabled_studios` is the HARD entitlement floor read by the CASL ability
-- engine (otosheets-app-backend shared/abilityGuard.ts + handlers/auth/me.ts):
-- a JSON array of studio ids, e.g. ["ops.money", "ledger"]. A per-user override
-- can never unlock a studio that is absent from this list.
--
-- `feature_overrides` is the org-level feature-flag map — { "<feature>": bool }
-- — applied on top of the tier/entitlement resolution.
--
-- Both are jsonb to match this schema's existing convention (every array/object
-- attribute on `orgs` is jsonb; there is no text[] anywhere in the schema).
--
-- Expand-contract / sparse-safe: nullable, NO DEFAULT, no backfill. NULL means
-- "not configured", which the ability engine reads as *all studios enabled*.
-- Defaulting to '[]' would read as "no studios" and lock every existing org out,
-- so absence must be preserved exactly as DynamoDB stores it (attribute omitted).
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS enabled_studios jsonb;
--> statement-breakpoint
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS feature_overrides jsonb;
