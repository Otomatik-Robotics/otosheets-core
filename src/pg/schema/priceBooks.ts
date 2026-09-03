import { pgTable, text, boolean, integer, numeric, timestamp, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { orgs } from './identity';

/**
 * Pricebooks (0037) — the layer between a CATALOGUE ITEM and a PRICE.
 *
 * `price_book_items` (opsEntities) is the catalogue item: the physical thing, one
 * row per thing, owning identity, unit, cost, stock and supplier. A PRICEBOOK is
 * a named set of PRICES over those items, and an org has many.
 *
 * `type` is MECHANICAL, not a label:
 *   standard → membership is IMPLICIT (every item is in it), a missing entry falls
 *              through to the default book, order is meaningless. Quoting/invoicing.
 *   catalog  → membership is EXPLICIT (being in it IS the point), a missing entry
 *              means NOT IN this catalogue, and `position` matters because the book
 *              is a display list (a storefront collection, a list sent to a client).
 *
 * The whole difference costs one column beyond what already exists: entries.position.
 * Entries ARE the membership for catalog books — there is deliberately no separate
 * join table.
 *
 * Postgres-only (relational, joined, reported on). No DynamoDB mirror.
 */
export const priceBooks = pgTable('price_books', {
    priceBookId: text('price_book_id').primaryKey(),
    orgId: text('org_id').notNull().references(() => orgs.orgId, { onDelete: 'cascade' }),
    businessProfileId: text('business_profile_id'),
    name: text('name').notNull(),
    type: text('type').notNull().default('standard').$type<'standard' | 'catalog'>(),
    isDefault: boolean('is_default').notNull().default(false),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
    // Exactly one default book per org — also what makes the 0037 seed and
    // `ensureDefaultBook` idempotent rather than merely usually-correct.
    uniqueIndex('price_books_default_uidx').on(t.orgId).where(sql`is_default`),
    uniqueIndex('price_books_org_name_uidx').on(t.orgId, sql`lower(${t.name})`),
    index('price_books_org_type_idx').on(t.orgId, t.type),
]);

/**
 * An item's price IN A BOOK — and, for catalog books, its membership of that book.
 *
 * `unitPrice` NULL means "in this book, inherit": a catalogue can curate without
 * restating prices. Resolution falls through entry → default book → item.
 *
 * The composite FKs on (org_id, price_book_id) and (org_id, item_id) are enforced
 * in SQL (0037) against the matching composite unique keys, so a cross-tenant entry
 * is structurally impossible rather than merely unlikely.
 */
export const priceBookEntries = pgTable('price_book_entries', {
    orgId: text('org_id').notNull(),
    priceBookId: text('price_book_id').notNull(),
    itemId: text('item_id').notNull(),
    unitPrice: numeric('unit_price', { precision: 12, scale: 2 }),   // null = inherit
    /** Display order for catalog books. Multiples of 100 so an append never renumbers. */
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
    primaryKey({ columns: [t.priceBookId, t.itemId] }),
    index('price_book_entries_book_pos_idx').on(t.priceBookId, t.position, t.itemId),
    index('price_book_entries_item_idx').on(t.orgId, t.itemId),
    // composite FKs are enforced in SQL (0037); declared there, not here
]);
