-- 0030: price-book cost + inventory-lite fields, line-item cost snapshot.
-- Additive/idempotent per the expand-contract rule; all columns nullable so
-- existing rows and old writers are untouched.
ALTER TABLE price_book_items ADD COLUMN IF NOT EXISTS cost_price numeric(12,2);
--> statement-breakpoint
ALTER TABLE price_book_items ADD COLUMN IF NOT EXISTS qty_on_hand numeric(12,3);
--> statement-breakpoint
ALTER TABLE price_book_items ADD COLUMN IF NOT EXISTS reorder_point numeric(12,3);
--> statement-breakpoint
ALTER TABLE invoice_line_items ADD COLUMN IF NOT EXISTS cost numeric(12,2);
--> statement-breakpoint
ALTER TABLE invoice_line_items ADD COLUMN IF NOT EXISTS price_book_item_id text;
