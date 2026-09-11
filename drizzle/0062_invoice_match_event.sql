-- Additive only. Apply before adopting the scoped invoice-match event writer.
-- Existing payment writers/readers may omit this nullable transition intent.
-- No backfill: legacy payments do not prove which credit caused a paid event.
ALTER TABLE invoice_payments ADD COLUMN IF NOT EXISTS match_event jsonb;
