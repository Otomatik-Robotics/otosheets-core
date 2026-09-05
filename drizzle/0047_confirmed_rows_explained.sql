-- A person confirming a bank row is that person's categorisation. The bulk
-- "Confirm selected" used to keep the machine's own provenance (AI / RULE /
-- SHARED / PAYER) and only flip review_status, so a row a person had confirmed
-- still read as unreconciled on the BAS and stayed on the unmatched-income
-- list for ever: both predicates look at category_source, not at who
-- confirmed. The confirm paths now stamp USER (ADVISOR for the accountant);
-- this brings the rows confirmed before that fix into line.
--
-- Machine confirms are 'auto:*' (rule / payer / cache) and are left alone.
-- A USER or ADVISOR stamp is never overwritten. Re-running touches nothing.
UPDATE statement_transactions
   SET category_source = 'USER', updated_at = now()
 WHERE review_status = 'CONFIRMED'
   AND confirmed_by IS NOT NULL
   AND confirmed_by NOT LIKE 'auto:%'
   AND (category_source IS NULL OR category_source NOT IN ('USER', 'ADVISOR'));
--> statement-breakpoint
UPDATE bank_transactions
   SET category_source = 'USER', updated_at = now()
 WHERE review_status = 'CONFIRMED'
   AND confirmed_by IS NOT NULL
   AND confirmed_by NOT LIKE 'auto:%'
   AND (category_source IS NULL OR category_source NOT IN ('USER', 'ADVISOR'));
