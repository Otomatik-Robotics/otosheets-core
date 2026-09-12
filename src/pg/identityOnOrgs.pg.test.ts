/**
 * 0071: the identity lives on the organisation. The canonical profile's facts
 * land on `orgs` (the profile wins where it has a value, the org's own column
 * stands where it does not), the email and SMS tables key on the organisation
 * alone, and the step runs again to no effect.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import * as fs from 'fs';
import * as path from 'path';
import { runMigrations, splitStatements, migrationsDir, type SqlExecutor } from './migrate';

let pglite: PGlite;
let executor: SqlExecutor;

const FILE = '0071_identity_on_orgs.sql';

async function rerun0071() {
    const source = fs.readFileSync(path.join(migrationsDir(), FILE), 'utf-8');
    for (const statement of splitStatements(source)) await executor.exec(statement);
}

async function pkColumns(table: string): Promise<string[]> {
    const { rows } = await pglite.query<any>(
        `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
          WHERE i.indrelid = $1::regclass AND i.indisprimary ORDER BY array_position(i.indkey, a.attnum)`,
        [table],
    );
    return rows.map(r => r.attname);
}

beforeAll(async () => {
    pglite = new PGlite({ extensions: { pg_trgm } });
    executor = {
        exec: async (statement: string) => {
            const res = await pglite.query(statement);
            return { rows: res.rows as any[] };
        },
    };
    const ran = await runMigrations(executor);
    expect(ran).toContain(FILE);

    // An org whose profile holds most facts, its own row a stale legal name and
    // a brand colour the profile never set; plus an email thread and an SMS
    // link that were keyed on the profile.
    const seed = [
        `INSERT INTO orgs (org_id, name, legal_name, brand_color, subscription_tier, seat_limit, currency, created_at, updated_at)
         VALUES ('org_one', 'Silk Rd', 'Silk Road Pty Ltd (old)', '#2a2521', 'pro', 2, 'AUD', now(), now())`,
        `INSERT INTO business_profiles (business_profile_id, org_id, business_name, legal_name, abn, gst_registered, tax_rate, phone, industry, created_at)
         VALUES ('bp_one', 'org_one', 'Silk Rd', 'Silk Road Pty Ltd', '51 824 753 556', true, 10, '0400 000 000', 'Plumbing', now())`,
        `UPDATE orgs SET business_profile_id = 'bp_one' WHERE org_id = 'org_one'`,
        `INSERT INTO inbound_mailboxes (org_id, business_profile_id, address, created_at)
         VALUES ('org_one', 'bp_one', 'in-abc@mail.example', now()::text)`,
        `INSERT INTO email_conversations (org_id, business_profile_id, conversation_id, reply_address, invoice_id, customer_email, created_at)
         VALUES ('org_one', 'bp_one', 'conv_1', 're-abc@mail.example', 'inv_1', 'c@example.com', now()::text)`,
        `INSERT INTO sms_response_links (token_hash, org_id, business_profile_id, context, phone_hash, created_at, expires_at, delivery_state, attempts, processing_attempts)
         VALUES ('tok_1', 'org_one', 'bp_one', '{"source":"invoice","originId":"inv_1","recipient":{"id":"cl_1","ownerId":"u1","kind":"client"}}', 'ph', now()::text, now()::text, 'queued', 0, 0)`,
    ];
    for (const statement of seed) await pglite.query(statement);
    await rerun0071();
});

describe('0071 identity on orgs', () => {
    it("copies the canonical profile's facts onto the organisation, the profile winning where it has a value", async () => {
        const { rows } = await pglite.query<any>(
            `SELECT business_name, legal_name, abn, gst_registered, tax_rate::text AS tax_rate, phone, industry, brand_color FROM orgs WHERE org_id = 'org_one'`,
        );
        expect(rows[0]).toEqual({
            business_name: 'Silk Rd',
            legal_name: 'Silk Road Pty Ltd',
            abn: '51 824 753 556',
            gst_registered: true,
            tax_rate: '10.000',
            phone: '0400 000 000',
            industry: 'Plumbing',
            brand_color: '#2a2521',
        });
    });

    it('keys the email and SMS tables on the organisation alone', async () => {
        expect(await pkColumns('inbound_mailboxes')).toEqual(['org_id']);
        expect(await pkColumns('email_conversations')).toEqual(['org_id', 'conversation_id']);
        expect(await pkColumns('inbound_messages')).toEqual(['org_id', 'message_id']);
        expect(await pkColumns('email_delivery_claims')).toEqual(['org_id', 'delivery_id']);
        expect(await pkColumns('email_conversation_invoices')).toEqual(['org_id', 'conversation_id', 'invoice_id']);
        expect(await pkColumns('invoice_response_delivery_claims')).toEqual(['org_id', 'delivery_id']);
    });

    it('accepts rows that carry no profile', async () => {
        await pglite.query(`INSERT INTO inbound_messages (org_id, message_id, conversation_id, received_at, content) VALUES ('org_one', 'msg_1', 'conv_1', now()::text, '{}')`);
        await pglite.query(`INSERT INTO sms_response_links (token_hash, org_id, context, phone_hash, created_at, expires_at, delivery_state, attempts, processing_attempts)
            VALUES ('tok_2', 'org_one', '{"source":"invoice","originId":"inv_2","recipient":{"id":"cl_1","ownerId":"u1","kind":"client"}}', 'ph', now()::text, now()::text, 'queued', 0, 0)`);
        const { rows } = await pglite.query<any>(`SELECT count(*)::int AS n FROM sms_response_links WHERE org_id = 'org_one'`);
        expect(rows[0].n).toBe(2);
    });

    it('one SMS link per origin per organisation', async () => {
        await expect(pglite.query(`INSERT INTO sms_response_links (token_hash, org_id, context, phone_hash, created_at, expires_at, delivery_state, attempts, processing_attempts)
            VALUES ('tok_3', 'org_one', '{"source":"invoice","originId":"inv_1","recipient":{"id":"cl_1","ownerId":"u1","kind":"client"}}', 'ph', now()::text, now()::text, 'queued', 0, 0)`)).rejects.toThrow(/sms_response_origin_uq/);
    });

    it('runs again to no effect', async () => {
        const before = await pglite.query<any>(`SELECT legal_name, brand_color FROM orgs WHERE org_id = 'org_one'`);
        await rerun0071();
        const after = await pglite.query<any>(`SELECT legal_name, brand_color FROM orgs WHERE org_id = 'org_one'`);
        expect(after.rows).toEqual(before.rows);
        expect(await pkColumns('inbound_mailboxes')).toEqual(['org_id']);
    });
});
