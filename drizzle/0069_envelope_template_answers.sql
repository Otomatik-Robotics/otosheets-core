-- What a reusable document was drafted from (0069).
--
-- Three nullable columns on envelope_templates, expand-contract, safe on a
-- second run. They mirror the same three on envelopes (0051): a template made
-- by the drafting flow carries the questionnaire it was answered with, the
-- jurisdiction whose law governs the wording, and the effective date, so that
-- a document made from the template starts with the facts the template was
-- drafted under rather than with nothing.
--
-- Creation-time only. A template edit does not rewrite them: the wording was
-- drafted from these answers, and changing the answers without redrafting
-- would leave the two disagreeing about what the document says.
--
-- Existing rows read as null, which is honest: they were saved before the
-- questions were kept.
ALTER TABLE envelope_templates ADD COLUMN IF NOT EXISTS answers jsonb;
--> statement-breakpoint
ALTER TABLE envelope_templates ADD COLUMN IF NOT EXISTS jurisdiction text;
--> statement-breakpoint
ALTER TABLE envelope_templates ADD COLUMN IF NOT EXISTS effective_date text;
