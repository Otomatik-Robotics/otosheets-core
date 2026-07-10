import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from './migrate';
import type { PgDb } from './client';
import { BusinessProfilePgRepo } from '../businessProfile/repo.pg';

let db: PgDb;
let pglite: PGlite;

// The two seed statements from 0015 — re-run in-test against an org inserted
// after migrations, to exercise the backfill precedence on known input.
const SEED_INSERT = `
INSERT INTO business_profiles (
    business_profile_id, org_id,
    business_name, legal_name, trade_name, abn, acn,
    gst_registered, tax_rate, tax_label,
    phone, business_email, website, address, suburb, state, postcode,
    bank_details,
    logo_key, brand_color, accent_color, template, footer_text, payment_instructions,
    about, service_areas, target_customers, unique_selling_points, common_questions,
    chatbot_tone, chatbot_instructions, google_review_url
)
SELECT
    gen_random_uuid()::text, o.org_id,
    COALESCE(bp->>'businessName', o.trade_name, o.name),
    o.legal_name, o.trade_name,
    COALESCE(bp->>'abn', o.abn), bp->>'acn',
    COALESCE((bp->>'gstRegistered')::boolean, o.gst_registered),
    COALESCE(o.tax_rate, NULLIF(bp->>'taxRate','')::numeric, NULLIF(ts->>'taxRate','')::numeric, 10),
    COALESCE(ts->>'taxLabel', bp->>'taxLabel', 'GST'),
    bp->>'phone', COALESCE(bp->>'businessEmail', ts->>'email'), bp->>'website',
    COALESCE(bp->>'address', ts->>'address'), COALESCE(bp->>'suburb', ts->>'suburb'),
    COALESCE(bp->>'state', ts->>'state'), COALESCE(bp->>'postcode', ts->>'postcode'),
    bp->>'bankDetails',
    COALESCE(ts->'branding'->>'logoKey', o.logo_url),
    COALESCE(ts->'branding'->>'primaryColor', o.brand_color),
    ts->'branding'->>'accentColor', ts->'branding'->>'template',
    ts->'branding'->>'footerText', ts->'branding'->>'paymentInstructions',
    bp->>'about', bp->'serviceAreas', bp->'targetCustomers',
    bp->'uniqueSellingPoints', bp->'commonQuestions',
    bp->>'chatbotTone', bp->>'chatbotInstructions', bp->>'googleReviewUrl'
FROM (
    SELECT o.*, (o.booking_settings->'businessProfile') AS bp, o.trade_settings AS ts
    FROM orgs o
    WHERE o.business_profile_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM business_profiles p WHERE p.org_id = o.org_id)
) o;`;

const SEED_POINTER = `
UPDATE orgs o SET business_profile_id = p.business_profile_id
FROM business_profiles p
WHERE p.org_id = o.org_id AND o.business_profile_id IS NULL;`;

beforeAll(async () => {
    pglite = new PGlite({ extensions: { pg_trgm } });
    const executor: SqlExecutor = {
        exec: async (statement: string) => {
            const res = await pglite.query(statement);
            return { rows: res.rows as any[] };
        },
    };
    const ran = await runMigrations(executor);
    expect(ran).toContain('0015_business_profile.sql');
    // Idempotent: a second pass applies nothing.
    expect(await runMigrations(executor)).toEqual([]);
    db = drizzle(pglite) as unknown as PgDb;
});

describe('0015 backfill precedence', () => {
    it('merges the four legacy locations with documented precedence', async () => {
        // Legacy org: gst/contact/about in bookingSettings.businessProfile;
        // taxLabel + branding in tradeSettings; top-level taxRate authoritative.
        await pglite.query(`
            INSERT INTO orgs (org_id, name, trade_name, abn, gst_registered, tax_rate, brand_color, logo_url,
                booking_settings, trade_settings, subscription_tier, seat_limit, currency, created_at, updated_at)
            VALUES ('org_legacy', 'Acme Pty Ltd', 'Acme Plumbing', '11111111111', NULL, 12.5, '#123456', 'logo/x.png',
                $1::jsonb, $2::jsonb, 'free', 0, 'AUD', now(), now());
        `, [
            JSON.stringify({ businessProfile: {
                businessName: 'Acme Plumbing Co', abn: '22222222222', gstRegistered: true,
                taxLabel: 'GST-BP', taxRate: 9, phone: '0400000000', businessEmail: 'a@acme.test',
                about: 'We plumb', serviceAreas: ['Perth', 'Fremantle'], bankDetails: 'BSB 000 ACC 111',
                chatbotInstructions: 'Be nice',
            } }),
            JSON.stringify({ taxLabel: 'VAT', taxRate: 20, branding: { logoKey: 'brand/logo.png', primaryColor: '#abcdef', template: 'modern' } }),
        ]);

        await pglite.query(SEED_INSERT);
        await pglite.query(SEED_POINTER);

        const { rows } = await pglite.query<any>(
            `SELECT p.* FROM business_profiles p JOIN orgs o ON o.business_profile_id = p.business_profile_id WHERE o.org_id = 'org_legacy'`,
        );
        expect(rows).toHaveLength(1);
        const p = rows[0];
        expect(p.business_name).toBe('Acme Plumbing Co');   // bp wins over trade_name/name
        expect(p.abn).toBe('22222222222');                  // bp wins over top-level
        expect(p.gst_registered).toBe(true);                // bp authoritative
        expect(Number(p.tax_rate)).toBe(12.5);              // top-level org.taxRate wins
        expect(p.tax_label).toBe('VAT');                    // tradeSettings wins over bp
        expect(p.phone).toBe('0400000000');
        expect(p.business_email).toBe('a@acme.test');
        expect(p.about).toBe('We plumb');
        expect(p.service_areas).toEqual(['Perth', 'Fremantle']);
        expect(p.bank_details).toBe('BSB 000 ACC 111');
        expect(p.logo_key).toBe('brand/logo.png');          // tradeSettings.branding wins over org.logo_url
        expect(p.brand_color).toBe('#abcdef');              // tradeSettings.branding.primaryColor wins
    });

    it('re-running the seed is a no-op (idempotent)', async () => {
        await pglite.query(SEED_INSERT);
        await pglite.query(SEED_POINTER);
        const { rows } = await pglite.query<any>(`SELECT count(*)::int AS n FROM business_profiles WHERE org_id = 'org_legacy'`);
        expect(rows[0].n).toBe(1);
    });

    it('defaults tax when no legacy data present', async () => {
        await pglite.query(`
            INSERT INTO orgs (org_id, name, subscription_tier, seat_limit, currency, created_at, updated_at)
            VALUES ('org_bare', 'Bare Co', 'free', 0, 'AUD', now(), now());
        `);
        await pglite.query(SEED_INSERT);
        await pglite.query(SEED_POINTER);
        const { rows } = await pglite.query<any>(
            `SELECT p.* FROM business_profiles p JOIN orgs o ON o.business_profile_id = p.business_profile_id WHERE o.org_id = 'org_bare'`,
        );
        expect(rows[0].tax_label).toBe('GST');
        expect(Number(rows[0].tax_rate)).toBe(10);
        expect(rows[0].business_name).toBe('Bare Co');
    });
});

describe('BusinessProfilePgRepo', () => {
    const repo = () => new BusinessProfilePgRepo(db);

    it('creates, reads, lists, updates', async () => {
        await pglite.query(`INSERT INTO orgs (org_id, name, subscription_tier, seat_limit, currency, created_at, updated_at)
            VALUES ('org_repo', 'Repo Co', 'free', 0, 'AUD', now(), now());`);
        const id = await repo().create({ orgId: 'org_repo', businessName: 'First', taxRate: 15, gstRegistered: true, serviceAreas: ['A'] });
        const got = await repo().getById(id);
        expect(got).toMatchObject({ businessProfileId: id, orgId: 'org_repo', businessName: 'First', taxRate: 15, gstRegistered: true });
        expect(got?.serviceAreas).toEqual(['A']);

        await repo().create({ orgId: 'org_repo', businessName: 'Second' });
        const list = await repo().listByOrg('org_repo');
        expect(list).toHaveLength(2);

        await repo().update(id, { businessName: 'First Renamed', taxLabel: 'VAT' });
        const updated = await repo().getById(id);
        expect(updated).toMatchObject({ businessName: 'First Renamed', taxLabel: 'VAT' });
    });
});
