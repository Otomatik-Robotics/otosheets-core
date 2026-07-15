-- Processing-queue support: how many times the worker has picked a statement
-- up (SQS ApproximateReceiveCount). >1 means a prior attempt threw and it is
-- being retried — surfaced as "Retry N/…" in the queue FAB. Additive + idempotent.
ALTER TABLE statements ADD COLUMN IF NOT EXISTS processing_attempt INTEGER;
