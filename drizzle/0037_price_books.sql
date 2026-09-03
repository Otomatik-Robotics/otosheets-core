-- Pricebooks (0037). A CATALOGUE ITEM (price_book_items) is the physical thing —
-- identity, unit, cost, stock, supplier. ONE row per thing. A PRICEBOOK is a named
-- set of PRICES over those items, and there are many per org.
--
-- price_books.type is MECHANICAL, not cosmetic:
--   standard → membership is IMPLICIT (every item is in it); a missing entry falls
--              through to the default book; order is meaningless; used for quoting.
--   catalog  → membership is EXPLICIT (being in it is the point); a missing entry
--              means NOT IN this catalogue; `position` MATTERS (it is a display list).
-- That difference costs exactly one column beyond what exists: entries.position.
-- Entries ARE the membership for catalog books — there is no separate join table.
--
-- Day one is invisible: one "Standard" book per org, is_default, holding a copy of
-- every item's current unit_price. price_book_items.unit_price stays a write-through
-- cache (the same relationship qty_on_hand already has to the atomic stock counter),
-- so a rollback of the `ops` domain flag to dual_dynamo still serves correct prices
-- from Dynamo. Dropping unit_price is the CONTRACT step and is NOT in this change.
--
-- Postgres-only: relational, joined, reported on. No DynamoDB mirror.

-- Composite unique keys so entries can be FK-bound to (org_id, X) and a
-- cross-tenant entry is structurally impossible, not merely unlikely.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'price_book_items_org_item_key') THEN
        ALTER TABLE price_book_items ADD CONSTRAINT price_book_items_org_item_key UNIQUE (org_id, item_id);
    END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS price_books (
    price_book_id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    business_profile_id text,
    name text NOT NULL,
    type text NOT NULL DEFAULT 'standard' CHECK (type IN ('standard', 'catalog')),
    is_default boolean NOT NULL DEFAULT false,
    description text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, price_book_id)
);
--> statement-breakpoint
-- Exactly one default book per org. This is also what makes the seed below idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS price_books_default_uidx
    ON price_books (org_id) WHERE is_default;
--> statement-breakpoint
-- A book is identified by its name in the UI, so names are unique per org (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS price_books_org_name_uidx
    ON price_books (org_id, lower(name));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS price_books_org_type_idx ON price_books (org_id, type);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS price_book_entries (
    org_id text NOT NULL,
    price_book_id text NOT NULL,
    item_id text NOT NULL,
    -- The item's price IN THIS BOOK. NULL = "in this book, inherit" — a catalogue can
    -- curate without restating prices. Fall-through: entry → default book → item.
    unit_price numeric(12,2),
    -- Display order for catalog books. Multiples of 100 so an append never renumbers.
    position integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (price_book_id, item_id),
    FOREIGN KEY (org_id, price_book_id) REFERENCES price_books (org_id, price_book_id) ON DELETE CASCADE,
    FOREIGN KEY (org_id, item_id) REFERENCES price_book_items (org_id, item_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS price_book_entries_book_pos_idx
    ON price_book_entries (price_book_id, position, item_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS price_book_entries_item_idx
    ON price_book_entries (org_id, item_id);
--> statement-breakpoint
-- Seed: one "Standard" book per org. The id is DERIVED from the org, never a fresh
-- ULID, so re-running this file cannot mint a second one — and neither can the
-- ensure-on-demand path in the repo, which uses the same id.
INSERT INTO price_books (price_book_id, org_id, name, type, is_default)
SELECT 'pb_std_' || o.org_id, o.org_id, 'Standard', 'standard', true
FROM orgs o
WHERE NOT EXISTS (SELECT 1 FROM price_books b WHERE b.org_id = o.org_id AND b.is_default)
ON CONFLICT (price_book_id) DO NOTHING;
--> statement-breakpoint
-- Copy each item's current unit_price into an entry against its org's default book.
-- Set-based, not a repo loop: a large org must not need N HTTP round trips.
INSERT INTO price_book_entries (org_id, price_book_id, item_id, unit_price, position)
SELECT i.org_id, b.price_book_id, i.item_id, i.unit_price, 0
FROM price_book_items i
JOIN price_books b ON b.org_id = i.org_id AND b.is_default
ON CONFLICT (price_book_id, item_id) DO NOTHING;
