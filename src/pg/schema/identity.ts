import { sql, type SQL } from 'drizzle-orm';
import {
    pgTable, text, boolean, integer, numeric, jsonb, timestamp,
    primaryKey, index, uniqueIndex, type PgColumn,
} from 'drizzle-orm/pg-core';

function sqlNotNull(col: PgColumn): SQL {
    return sql`${col} is not null`;
}

/**
 * Phase 1 (identity) tables — see docs/POSTGRES_MIGRATION_PLAN.md §4.
 *
 * Property names are camelCase to mirror the Zod DTOs 1:1; column names are
 * snake_case. Timestamps use mode 'date' — repos convert to/from ISO strings
 * at the boundary so DTOs are unchanged.
 *
 * Deviation from the plan DDL, matching the real Dynamo access patterns:
 *  - memberships are keyed (org_id, user_id) — the composite PK the repo API
 *    uses (`getMembership(orgId, userId)`); `membership_id` is a plain column.
 */

export const users = pgTable('users', {
    userId: text('user_id').primaryKey(),
    email: text('email').notNull(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    // Nullable in the DB: federated sign-ups can exist before a name is set
    // (found by the backfill report). The write contract still expects it.
    fullName: text('full_name'),
    userType: text('user_type'),
    businessName: text('business_name'),
    tradeName: text('trade_name'),
    slug: text('slug'),
    timezone: text('timezone').notNull().default('Australia/Sydney'),
    tagline: text('tagline'),
    brandColor: text('brand_color'),
    logoUrl: text('logo_url'),
    status: text('status').notNull().default('ACTIVE'),
    profilePictureKey: text('profile_picture_key'),
    phone: text('phone'),
    stripeAccountId: text('stripe_account_id'),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    subscriptionTier: text('subscription_tier'),
    subscriptionStatus: text('subscription_status'),
    categoryRules: jsonb('category_rules'),
    bookingSettings: jsonb('booking_settings'),
    calendarConnections: jsonb('calendar_connections'),
    metaPages: jsonb('meta_pages'),
    tradeSettings: jsonb('trade_settings'),
    emailConnections: jsonb('email_connections'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
    // Plain index, NOT unique: Cognito allows the same email across identity
    // providers (federated + native are distinct subs) — found in dev data.
    index('users_email_idx').on(t.email),
    uniqueIndex('users_slug_uq').on(t.slug).where(sqlNotNull(t.slug)),
]);

export const orgs = pgTable('orgs', {
    orgId: text('org_id').primaryKey(),
    name: text('name').notNull(),
    // Live attributes surfaced by the backfill drift report (2026-07-04):
    type: text('type'),                                        // e.g. advisor practice vs business org
    stripeOnboardingStatus: text('stripe_onboarding_status'),
    advisorFacts: jsonb('advisor_facts'),
    customRoles: jsonb('custom_roles'),
    timezone: text('timezone'),
    legalName: text('legal_name'),
    tradeName: text('trade_name'),
    slug: text('slug'),
    abn: text('abn'),
    gstRegistered: boolean('gst_registered').notNull().default(false),
    currency: text('currency').notNull().default('AUD'),
    taxRate: numeric('tax_rate', { precision: 6, scale: 3 }),
    logoUrl: text('logo_url'),
    brandColor: text('brand_color'),
    tagline: text('tagline'),
    emailSignature: text('email_signature'),
    bookingSettings: jsonb('booking_settings'),
    tradeSettings: jsonb('trade_settings'),
    stripeAccountId: text('stripe_account_id'),
    subscriptionTier: text('subscription_tier').notNull().default('free'),
    subscriptionStatus: text('subscription_status'),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    seatLimit: integer('seat_limit').notNull().default(0),
    encryptedDek: text('encrypted_dek'),
    dekVersion: integer('dek_version'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
    uniqueIndex('orgs_slug_uq').on(t.slug).where(sqlNotNull(t.slug)),
]);

export const memberships = pgTable('memberships', {
    orgId: text('org_id').notNull().references(() => orgs.orgId, { onDelete: 'cascade' }),
    // For accepted members this is the Cognito sub; for pending invites it is
    // the placeholder id the handlers mint — exactly what Dynamo stores as the SK.
    userId: text('user_id').notNull(),
    membershipId: text('membership_id'),
    role: text('role').notNull(),
    status: text('status').notNull().default('PENDING'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    inviteName: text('invite_name'),
    inviteToken: text('invite_token'),
    inviteExpiresAt: timestamp('invite_expires_at', { withTimezone: true, mode: 'date' }),
    inviteEmail: text('invite_email'),
    invitePhone: text('invite_phone'),
    invitedBy: text('invited_by'),
    invitedAt: timestamp('invited_at', { withTimezone: true, mode: 'date' }),
    joinedAt: timestamp('joined_at', { withTimezone: true, mode: 'date' }),
    availability: jsonb('availability'),
    calendarConnection: jsonb('calendar_connection'),
    /** @deprecated legacy single-team name; superseded by team_members. Kept for lossless migration; drop at contract step. */
    team: text('team'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
    primaryKey({ columns: [t.orgId, t.userId] }),
    uniqueIndex('memberships_invite_token_uq').on(t.inviteToken).where(sqlNotNull(t.inviteToken)),
    index('memberships_user_idx').on(t.userId),
]);

export const teams = pgTable('teams', {
    teamId: text('team_id').primaryKey(),
    orgId: text('org_id').notNull().references(() => orgs.orgId, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
    index('teams_org_idx').on(t.orgId),
]);

export const teamMembers = pgTable('team_members', {
    teamId: text('team_id').notNull().references(() => teams.teamId, { onDelete: 'cascade' }),
    // References memberships.user_id conceptually; no FK because the member key
    // is (org_id, user_id) and the org is implied by the team.
    memberId: text('member_id').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [
    primaryKey({ columns: [t.teamId, t.memberId] }),
]);
