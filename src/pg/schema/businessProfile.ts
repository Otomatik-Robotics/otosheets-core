import {
    pgTable, text, boolean, numeric, jsonb, timestamp, index,
} from 'drizzle-orm/pg-core';
import { orgs } from './identity';

/**
 * Unified business identity — the single home for the tax, contact, branding, and
 * AI-knowledge data that was previously fragmented across four locations on `orgs`
 * (top-level scalars, `tradeSettings`, `bookingSettings.businessProfile`, and the
 * per-invoice snapshot). See the monorepo plan "Unified business_profile table".
 *
 * Cardinality: an org owns many profiles (`org_id` FK); `orgs.business_profile_id`
 * points at the active one that every consumer resolves through. All operational
 * rows carry `business_profile_id` so multiple profiles under one org never
 * commingle. Postgres-native (no Dynamo mirror) — depends on `dual_pg`.
 *
 * Property names are camelCase to mirror the Zod DTO 1:1; column names are
 * snake_case. Timestamps use mode 'date' — the repo converts to/from ISO strings.
 */
export const businessProfiles = pgTable('business_profiles', {
    businessProfileId: text('business_profile_id').primaryKey(),
    orgId: text('org_id').notNull().references(() => orgs.orgId, { onDelete: 'cascade' }),

    // ─── Identity ───────────────────────────────────────────────
    businessName: text('business_name'),
    legalName: text('legal_name'),
    tradeName: text('trade_name'),
    abn: text('abn'),
    acn: text('acn'),
    // Legal structure (sole trader, company, partnership, trust, ...). Free text
    // rather than an enum so the set can grow without a migration; nullable
    // because every existing profile predates the question.
    entityType: text('entity_type'),

    // ─── Tax (single authoritative home) ────────────────────────
    gstRegistered: boolean('gst_registered'),
    taxRate: numeric('tax_rate', { precision: 6, scale: 3 }),
    taxLabel: text('tax_label'),

    // ─── Contact / address ──────────────────────────────────────
    phone: text('phone'),
    businessEmail: text('business_email'),
    website: text('website'),
    address: text('address'),
    suburb: text('suburb'),
    state: text('state'),
    postcode: text('postcode'),

    // ─── Banking ────────────────────────────────────────────────
    bankDetails: text('bank_details'),

    // Stripe Connect onboarding (representative + descriptors). Onboarding
    // collects the full set Stripe Express asks an Australian connected
    // account for, so Stripe is prefilled and the owner only confirms. The
    // representative is the person who signs (sole-trader ICP: the owner).
    // All nullable: every existing profile predates these questions.
    representativeFirstName: text('representative_first_name'),
    representativeLastName: text('representative_last_name'),
    representativeEmail: text('representative_email'),
    representativePhone: text('representative_phone'),
    representativeAddress: text('representative_address'),
    representativeSuburb: text('representative_suburb'),
    representativeState: text('representative_state'),
    representativePostcode: text('representative_postcode'),
    // Merchant category code, 4 digits (validated at the DTO, free text here).
    mcc: text('mcc'),
    // Card-statement descriptor, max 22 chars per Stripe (validated at the DTO).
    statementDescriptor: text('statement_descriptor'),
    /**
     * CIPHERTEXT ONLY, by contract. Holds the encrypted JSON blob
     * `{ dob: { day, month, year }, bank: { bsb, accountNumber, accountHolderName } }`
     * that Stripe needs for the representative + payout account. Core never
     * encrypts or decrypts: the backend encrypts with its org-keyed seam
     * BEFORE calling any repo write, so both Postgres and any mirror only
     * ever hold opaque text. Never log it. Cleared (set NULL) once forwarded
     * to Stripe; `connectSensitiveForwardedAt` remains as the audit stamp.
     */
    connectSensitive: text('connect_sensitive'),
    connectSensitiveForwardedAt: timestamp('connect_sensitive_forwarded_at', { withTimezone: true, mode: 'date' }),

    // ─── Branding ───────────────────────────────────────────────
    logoKey: text('logo_key'),
    brandColor: text('brand_color'),
    accentColor: text('accent_color'),
    template: text('template'),
    footerText: text('footer_text'),
    paymentInstructions: text('payment_instructions'),

    // ─── AI-knowledge / marketing (also feed the website builder) ─
    industry: text('industry'),
    businessSize: text('business_size'),
    operatingHours: jsonb('operating_hours'),
    about: text('about'),
    serviceAreas: jsonb('service_areas'),
    targetCustomers: jsonb('target_customers'),
    uniqueSellingPoints: jsonb('unique_selling_points'),
    commonQuestions: jsonb('common_questions'),
    chatbotTone: text('chatbot_tone'),
    chatbotInstructions: text('chatbot_instructions'),
    googleReviewUrl: text('google_review_url'),

    // Stamped once when account setup first hits 100% — permanent (never unset).
    setupCompletedAt: timestamp('setup_completed_at', { withTimezone: true, mode: 'date' }),
    // Stamped once when the setup modal first auto-opens (first login ever).
    setupModalSeenAt: timestamp('setup_modal_seen_at', { withTimezone: true, mode: 'date' }),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
    index('business_profiles_org_idx').on(t.orgId),
]);
