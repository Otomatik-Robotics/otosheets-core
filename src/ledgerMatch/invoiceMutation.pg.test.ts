import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import { LedgerMatchPgRepo } from './repo.pg';
import { scopedMatchPaymentId, type InvoiceMatchMutationInput } from './invoiceMutation.pg';

let pg: PGlite;
let repo: LedgerMatchPgRepo;
const input = (overrides: Partial<InvoiceMatchMutationInput> = {}): InvoiceMatchMutationInput => ({
    userId: 'user', source: 'statement', txnId: 'row-a', invoiceId: 'inv-a', action: 'accept', ...overrides,
});
const state = async () => ({
    invoices: (await pg.query('SELECT invoice_id, paid_amount, status FROM invoices ORDER BY invoice_id')).rows,
    payments: (await pg.query('SELECT * FROM invoice_payments ORDER BY payment_id')).rows,
    rows: (await pg.query('SELECT txn_id, matched_invoice_id, match_source FROM statement_transactions ORDER BY txn_id')).rows,
    feed: (await pg.query('SELECT txn_id, matched_invoice_id, match_source FROM bank_transactions ORDER BY txn_id')).rows,
    rejected: (await pg.query('SELECT * FROM match_rejections ORDER BY txn_id')).rows,
});
beforeAll(async () => {
    pg = new PGlite({ extensions: { pg_trgm } });
    await runMigrations({ exec: async s => ({ rows: (await pg.query(s)).rows as any[] }) });
    repo = new LedgerMatchPgRepo(drizzle(pg) as unknown as PgDb).withScope('org', 'A');
    await pg.exec("INSERT INTO orgs (org_id,name) VALUES ('org','Org'),('foreign','Foreign')");
});
beforeEach(async () => {
    vi.stubEnv('DATA_BACKEND_BILLING_CORE', 'pg');
    await pg.exec(`DELETE FROM match_rejections; DELETE FROM invoice_payments; DELETE FROM invoices;
        DELETE FROM statement_transactions; DELETE FROM statements; DELETE FROM bank_transactions; DELETE FROM bank_accounts;
        INSERT INTO statements (statement_id,user_id,organization_id,business_profile_id,fy,s3_key) VALUES
            ('a','user','org','A','2026-27','a'),('b','user','org','B','2026-27','b'),('legacy','user','org',NULL,'2026-27','legacy'),('foreign','user','foreign','A','2026-27','foreign');
        INSERT INTO statement_transactions (txn_id,statement_id,user_id,fy,seq,amount_cents,txn_date) VALUES
            ('row-a','a','user','2026-27',1,10000,'2026-07-01'),('row-a2','a','user','2026-27',2,10000,'2026-07-01'),
            ('row-b','b','user','2026-27',1,10000,'2026-07-01'),('row-legacy','legacy','user','2026-27',1,10000,'2026-07-01'),('row-foreign','foreign','user','2026-27',1,10000,'2026-07-01');
        INSERT INTO bank_accounts (account_id,user_id,organization_id,business_profile_id) VALUES ('acct-a','user','org','A'),('acct-b','user','org','B');
        INSERT INTO bank_transactions (txn_id,account_id,user_id,fy,amount_cents,txn_date) VALUES ('feed-a','acct-a','user','2026-27',10000,'2026-07-01'),('feed-b','acct-b','user','2026-27',10000,'2026-07-01');
        INSERT INTO invoices (invoice_id,org_id,business_profile_id,owner_id,created_by,invoice_number,total_amount,paid_amount,status) VALUES
            ('inv-a','org','A','user','user','A',200,0,'SENT'),('inv-a2','org','A','user','user','A2',200,0,'SENT'),
            ('inv-b','org','B','user','user','B',200,0,'SENT'),('inv-legacy','org',NULL,'user','user','L',200,0,'SENT'),('inv-foreign','foreign','A','user','user','F',200,0,'SENT');`);
});
afterEach(async () => {
    vi.unstubAllEnvs();
    await pg.exec('DROP TRIGGER IF EXISTS fail_match_invoice ON invoices; DROP TRIGGER IF EXISTS fail_match_stamp ON statement_transactions;');
});

describe('scoped atomic invoice matching', () => {
    it.each(['dynamo', 'dual_dynamo', 'dual_pg'])('%s is unavailable before effects', async mode => {
        vi.stubEnv('DATA_BACKEND_BILLING_CORE', mode);
        const before = await state();
        await expect(repo.mutateInvoiceMatch(input())).rejects.toThrow('requires billing-core pg');
        await expect(repo.mutateInvoiceMatch(input({ action: 'reverse' }))).rejects.toThrow('requires billing-core pg');
        expect(await state()).toEqual(before);
    });
    it.each(['b','legacy','foreign','missing'])('refuses %s source or target without any effects', async label => {
        const before = await state();
        for (const action of ['accept','reverse'] as const) {
            expect(await repo.mutateInvoiceMatch(input({ txnId: `row-${label}`, action }))).toEqual({ kind: 'not_found' });
            expect(await repo.mutateInvoiceMatch(input({ invoiceId: `inv-${label}`, action }))).toEqual({ kind: 'not_found' });
        }
        expect(await state()).toEqual(before);
    });
    it.each(['b', 'legacy', 'foreign', 'missing'])('transactional accept/reverse quarantine %s transfer references without effects', async label => {
        await pg.query("UPDATE statement_transactions SET transfer_pair_id=$1 WHERE txn_id='row-a'", [`row-${label}`]);
        expect(await repo.getRowForMatching('user', 'statement', 'row-a')).toBeNull();
        const before = await state();
        expect(await repo.mutateInvoiceMatch(input())).toEqual({ kind: 'not_found' });
        expect(await state()).toEqual(before);
        await pg.exec("UPDATE statement_transactions SET transfer_pair_id=NULL WHERE txn_id='row-a'");
        expect(await repo.mutateInvoiceMatch(input())).toMatchObject({ kind: 'applied' });
        await pg.query("UPDATE statement_transactions SET transfer_pair_id=$1 WHERE txn_id='row-a'", [`row-${label}`]);
        const accepted = await state();
        expect(await repo.mutateInvoiceMatch(input({ action: 'reverse' }))).toEqual({ kind: 'not_found' });
        expect(await state()).toEqual(accepted);
    });
    it('retains eligible same-profile references in the atomic path', async () => {
        await pg.exec("UPDATE statement_transactions SET transfer_pair_id='row-a2' WHERE txn_id='row-a'");
        expect(await repo.getRowForMatching('user', 'statement', 'row-a')).not.toBeNull();
        expect(await repo.mutateInvoiceMatch(input())).toMatchObject({ kind: 'applied' });
        expect(await repo.mutateInvoiceMatch(input({ action: 'reverse' }))).toMatchObject({ kind: 'applied' });
    });
    it('refuses a foreign feed parent and wrong user', async () => {
        const before = await state();
        expect(await repo.mutateInvoiceMatch(input({ source: 'feed', txnId: 'feed-b' }))).toEqual({ kind: 'not_found' });
        expect(await repo.mutateInvoiceMatch(input({ userId: 'intruder' }))).toEqual({ kind: 'not_found' });
        expect(await state()).toEqual(before);
    });
    it.each([['statement','row-a'],['feed','feed-a']] as const)('%s accept/reverse are replay-safe and preserve all three records together', async (source, txnId) => {
        const request = input({ source, txnId });
        expect(await repo.mutateInvoiceMatch(request)).toMatchObject({ kind: 'applied', invoicePaidAmount: 100, invoiceStatus: 'PARTIAL' });
        const accepted = await state();
        expect(accepted.payments).toHaveLength(1);
        expect(accepted.payments[0]).toMatchObject({ org_id: 'org', business_profile_id: 'A', invoice_id: 'inv-a', user_id: 'user' });
        expect(await repo.mutateInvoiceMatch(request)).toMatchObject({ kind: 'replayed', invoicePaidAmount: 100 });
        expect(await state()).toEqual(accepted);
        expect(await repo.mutateInvoiceMatch({ ...request, action: 'reverse' })).toMatchObject({ kind: 'applied', invoicePaidAmount: 0, invoiceStatus: 'SENT' });
        const reversed = await state(); expect(reversed.payments).toHaveLength(0); expect(reversed.rejected).toHaveLength(1);
        expect(await repo.mutateInvoiceMatch({ ...request, action: 'reverse' })).toMatchObject({ kind: 'replayed', invoicePaidAmount: 0 });
        expect(await state()).toEqual(reversed);
    });
    it('serializes competing accepts without an extra payment or invoice balance', async () => {
        const results = await Promise.all([repo.mutateInvoiceMatch(input()), repo.mutateInvoiceMatch(input({ invoiceId: 'inv-a2' }))]);
        expect(results.map(r => r.kind).sort()).toEqual(['applied','conflict']);
        expect((await state()).payments).toHaveLength(1);
        expect((await pg.query('SELECT SUM(paid_amount)::text AS paid FROM invoices')).rows).toEqual([{ paid: '100.00' }]);
    });
    it('serializes different credits to one invoice and concurrent accept/reverse', async () => {
        await Promise.all([repo.mutateInvoiceMatch(input()), repo.mutateInvoiceMatch(input({ txnId: 'row-a2' }))]);
        expect((await pg.query("SELECT paid_amount,status FROM invoices WHERE invoice_id='inv-a'")).rows).toEqual([{ paid_amount: '200.00', status: 'PAID' }]);
        await Promise.all([repo.mutateInvoiceMatch(input()), repo.mutateInvoiceMatch(input({ action: 'reverse' }))]);
        expect((await state()).payments).toHaveLength(1);
        expect((await pg.query("SELECT paid_amount,status FROM invoices WHERE invoice_id='inv-a'")).rows).toEqual([{ paid_amount: '100.00', status: 'PARTIAL' }]);
    });
    it('rolls back payment and invoice when the final stamp fails', async () => {
        await pg.exec(`CREATE OR REPLACE FUNCTION fail_match() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected match storage failure'; END $$;
            CREATE TRIGGER fail_match_stamp BEFORE UPDATE ON statement_transactions FOR EACH ROW EXECUTE FUNCTION fail_match();`);
        const before = await state();
        await expect(repo.mutateInvoiceMatch(input())).rejects.toThrow();
        expect(await state()).toEqual(before);
    });
    it('rolls back deletion and invoice changes when reversal stamp fails', async () => {
        await repo.mutateInvoiceMatch(input());
        await pg.exec(`CREATE OR REPLACE FUNCTION fail_match() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected match storage failure'; END $$;
            CREATE TRIGGER fail_match_stamp BEFORE UPDATE ON statement_transactions FOR EACH ROW EXECUTE FUNCTION fail_match();`);
        const before = await state();
        await expect(repo.mutateInvoiceMatch(input({ action: 'reverse' }))).rejects.toThrow();
        expect(await state()).toEqual(before);
    });
    it('rolls back when the conditional stamp returns no row', async () => {
        await pg.exec(`CREATE OR REPLACE FUNCTION skip_match() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
            CREATE TRIGGER fail_match_stamp BEFORE UPDATE ON statement_transactions FOR EACH ROW EXECUTE FUNCTION skip_match();`);
        const before = await state();
        await expect(repo.mutateInvoiceMatch(input())).rejects.toThrow('stamp conflict');
        expect(await state()).toEqual(before);
    });
    it('rolls back payment deletion when the reversal invoice update is suppressed', async () => {
        await repo.mutateInvoiceMatch(input());
        await pg.exec(`CREATE OR REPLACE FUNCTION skip_match() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
            CREATE TRIGGER fail_match_invoice BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION skip_match();`);
        const before = await state();
        await expect(repo.mutateInvoiceMatch(input({ action: 'reverse' }))).rejects.toThrow('balance conflict');
        expect(await state()).toEqual(before);
    });
    it('quarantines legacy links and foreign conflicting payment IDs', async () => {
        await pg.exec("UPDATE statement_transactions SET matched_invoice_id='inv-a' WHERE txn_id='row-a'");
        const legacy = await state();
        expect(await repo.mutateInvoiceMatch(input())).toEqual({ kind: 'conflict' });
        expect(await repo.mutateInvoiceMatch(input({ action: 'reverse' }))).toEqual({ kind: 'conflict' });
        expect(await state()).toEqual(legacy);
        await pg.exec("UPDATE statement_transactions SET matched_invoice_id=NULL WHERE txn_id='row-a'");
        await pg.query("INSERT INTO invoice_payments (payment_id,invoice_id,org_id,business_profile_id,user_id,amount,method) VALUES ($1,'inv-b','org','B','user',100,'BANK_TRANSFER')", [scopedMatchPaymentId('statement','row-a')]);
        const foreign = await state();
        expect(await repo.mutateInvoiceMatch(input())).toEqual({ kind: 'conflict' });
        expect(await repo.mutateInvoiceMatch(input({ action: 'reverse' }))).toEqual({ kind: 'conflict' });
        expect(await state()).toEqual(foreign);
    });
    it('binds payment identity to source and exact unsanitized transaction ID', () => {
        expect(scopedMatchPaymentId('statement','a#b')).not.toBe(scopedMatchPaymentId('statement','a_b'));
        expect(scopedMatchPaymentId('statement','a#b')).not.toBe(scopedMatchPaymentId('feed','a#b'));
    });
});
