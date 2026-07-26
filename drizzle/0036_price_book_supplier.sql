-- Who the business buys a price-book item from.
--
-- Additive and nullable: every existing row keeps working with no supplier, and
-- the column fills in as items are edited or a supplier's price list is
-- imported. No name is stored alongside it — the FK only, joined at render, so
-- renaming a supplier cannot leave stale copies through the price book.
--
-- Suppliers live in DynamoDB (otosheets-suppliers-{env}, PK orgId / SK
-- supplierId) rather than Postgres, so there is deliberately NO foreign key
-- constraint here. A deleted supplier leaves a dangling id, which the UI shows
-- as "supplier removed" rather than losing the item.
ALTER TABLE price_book_items ADD COLUMN IF NOT EXISTS supplier_id text;
--> statement-breakpoint
-- Answering "what do I buy from this supplier" is the point of the column.
CREATE INDEX IF NOT EXISTS price_book_supplier_idx ON price_book_items (org_id, supplier_id)
    WHERE supplier_id IS NOT NULL;
