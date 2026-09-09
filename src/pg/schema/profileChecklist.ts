import { pgTable, text, integer, boolean, timestamp, primaryKey, foreignKey } from 'drizzle-orm/pg-core';
import { businessProfiles } from './businessProfile';
export const profileSetupChecklist = pgTable('profile_setup_checklist', {
    orgId: text('org_id').notNull(), businessProfileId: text('business_profile_id').notNull(), itemId: text('item_id').notNull(),
    done: boolean('done').notNull(), revision: integer('revision').notNull(), updatedBy: text('updated_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    doneBy: text('done_by'), doneAt: timestamp('done_at', { withTimezone: true, mode: 'date' }),
}, t => [primaryKey({ columns: [t.orgId,t.businessProfileId,t.itemId] }),
    foreignKey({ columns: [t.orgId,t.businessProfileId], foreignColumns: [businessProfiles.orgId,businessProfiles.businessProfileId] })]);
