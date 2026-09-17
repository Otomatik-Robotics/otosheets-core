import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import { InvoicePgRepo } from './repo.pg';
import { QuoteConversionConflictError, QuoteUnavailableError, type ConvertQuoteInput } from './acceptance';

const tokenA = 'a'.repeat(64), tokenB = 'b'.repeat(64);
let database: PGlite, repo: InvoicePgRepo;
const now = new Date().toISOString(), today = now.slice(0, 10);
let sequence = 0;
const input = (quoteId: string, overrides: Partial<ConvertQuoteInput> = {}): ConvertQuoteInput => ({
    orgId: 'accept-org', ownerId: 'quote-owner', quoteId, invoiceId: `inv-${quoteId}`, invoiceNumber: `INV-${quoteId}`,
    now, today, dueDate: '2099-12-31', tokenHash: tokenA, ...overrides,
});
async function quote(overrides: Record<string, any> = {}) {
    const id = `quote-${++sequence}`;
    await repo.createInvoice('accept-org', 'quote-owner', id, {
        invoiceNumber: `QUO-${id}`, isQuote: true, status: 'SENT', date: today, dueDate: '2099-12-31',
        clientId: 'accept-client', subtotal: 200, gstMode: 'EXCLUSIVE', gstAmount: 14, totalAmount: 214,
        taxRate: 0.07, taxLabel: 'Agreed tax', notes: 'Agreed scope', paidAmount: 0,
        items: [{ id: `line-${id}`, description: 'Work', quantity: 2, unitPrice: 100, total: 200, cost: 41, priceBookItemId: 'old-price', sortOrder: 0 }],
        ...overrides,
    });
    if (['DRAFT', 'SENT'].includes(overrides.status ?? 'SENT')) await repo.issueQuoteAcceptanceToken('accept-org', 'quote-owner', id, tokenA);
    return id;
}
beforeAll(async () => {
    database = new PGlite({ extensions: { pg_trgm } });
    await runMigrations({ exec: async statement => ({ rows: (await database.query(statement)).rows as any[] }) });
    await database.exec("INSERT INTO orgs (org_id,name) VALUES ('accept-org','Business'),('other-org','Other'); INSERT INTO clients (client_id,org_id,created_by,name) VALUES ('accept-client','accept-org','quote-owner','Client')");
    const db = drizzle(database) as unknown as PgDb;
    repo = new InvoicePgRepo(db, db);
}, 30000);
afterAll(async () => { await database?.close(); });

describe('atomic quote acceptance in Postgres', () => {
    it('copies agreed values and costs into one draft invoice owned by the quote owner', async () => {
        const id = await quote();
        const result = await repo.convertQuote(input(id));
        expect(result.alreadyConverted).toBe(false);
        expect(result.quote).toMatchObject({ status: 'CONVERTED', convertedInvoiceId: `inv-${id}`, quoteAcceptedAt: now, quoteAcceptedEventId: `quote-accepted:accept-org:${id}` });
        expect(result.invoice).toMatchObject({ status: 'DRAFT', isQuote: false, createdBy: 'quote-owner', sourceQuoteId: id, subtotal: 200, gstAmount: 14, taxRate: 0.07, taxLabel: 'Agreed tax', totalAmount: 214, paidAmount: 0, notes: 'Agreed scope' });
        expect(result.invoice.items[0]).toMatchObject({ id: `inv-${id}#0`, cost: 41, priceBookItemId: 'old-price', unitPrice: 100 });
        expect(result.invoice).not.toHaveProperty('paymentUrl');
        expect(result.quote).not.toHaveProperty('quoteAcceptanceTokenHashes');
    });
    it('concurrent acceptances and different proposed invoice IDs return the original conversion', async () => {
        const id = await quote();
        const results = await Promise.all([repo.convertQuote(input(id)), repo.convertQuote(input(id, { invoiceId: 'other-attempt', invoiceNumber: 'INV-OTHER' }))]);
        expect(results.filter(result => !result.alreadyConverted)).toHaveLength(1);
        expect(results[0].invoice.invoiceId).toBe(results[1].invoice.invoiceId);
        await repo.updateInvoice('accept-org', 'quote-owner', results[0].invoice.invoiceId, { notes: 'Owner edited invoice after acceptance' });
        const replay = await repo.convertQuote(input(id));
        expect(replay.invoice.notes).toBe('Owner edited invoice after acceptance');
        expect(replay.invoice.sk).toBe(`quote-owner#${replay.invoice.invoiceId}`);
    });
    it('keeps the durable outbox pending until the matching event is acknowledged exactly once', async () => {
        const id = await quote();
        const { quote: converted } = await repo.convertQuote(input(id));
        expect((await repo.listPendingQuoteAcceptances()).map(row => row.quote.invoiceId)).toContain(id);
        await expect(repo.markQuoteAcceptancePublished('other-org', 'quote-owner', id, converted.quoteAcceptedEventId!)).rejects.toThrow(QuoteUnavailableError);
        await expect(repo.markQuoteAcceptancePublished('accept-org', 'quote-owner', id, 'wrong-event')).rejects.toThrow(QuoteUnavailableError);
        const results = await Promise.all([repo.markQuoteAcceptancePublished('accept-org', 'quote-owner', id, converted.quoteAcceptedEventId!), repo.markQuoteAcceptancePublished('accept-org', 'quote-owner', id, converted.quoteAcceptedEventId!)]);
        expect(results.sort()).toEqual([false, true]);
        expect((await repo.listPendingQuoteAcceptances()).map(row => row.quote.invoiceId)).not.toContain(id);
    });
    it('keeps multiple emailed tokens valid and private, but invalidates them on material edits', async () => {
        const id = await quote({ status: 'DRAFT' });
        await repo.issueQuoteAcceptanceToken('accept-org', 'quote-owner', id, tokenB);
        await repo.issueQuoteAcceptanceToken('accept-org', 'quote-owner', id, tokenA);
        await repo.updateInvoice('accept-org', 'quote-owner', id, { status: 'SENT' });
        expect((await repo.getInvoiceForMirror('accept-org', 'quote-owner', id))?.quoteAcceptanceTokenHashes).toEqual([tokenA, tokenB]);
        expect(await repo.getQuoteForAcceptance('accept-org', id, tokenA)).not.toBeNull();
        expect(await repo.getQuoteForAcceptance('accept-org', id, tokenB)).not.toBeNull();
        expect(await repo.getInvoice('accept-org', 'quote-owner', id)).not.toHaveProperty('quoteAcceptanceTokenHashes');
        expect((await repo.findInvoiceByIdInOrg('accept-org', id))?.invoice).not.toHaveProperty('quoteAcceptanceTokenHashes');
        expect((await repo.listOrgInvoicesPaginated({ orgId: 'accept-org', isQuote: true })).items.every(row => !('quoteAcceptanceTokenHashes' in row))).toBe(true);
        await repo.updateInvoice('accept-org', 'quote-owner', id, { notes: 'Revised scope' });
        expect(await repo.getQuoteForAcceptance('accept-org', id, tokenA)).toBeNull();
        expect((await repo.findInvoiceByIdInOrg('accept-org', id))?.ownerId).toBe('quote-owner');
    });
    it('rejects wrong tokens, cross-organisation and cross-owner acceptance without creating invoices', async () => {
        const id = await quote();
        for (const overrides of [{ tokenHash: tokenB }, { orgId: 'other-org' }, { ownerId: 'other-owner' }]) {
            await expect(repo.convertQuote(input(id, overrides))).rejects.toThrow(QuoteUnavailableError);
        }
        expect(await repo.getInvoice('accept-org', 'quote-owner', `inv-${id}`)).toBeNull();
        expect(await repo.getQuoteForAcceptance('other-org', id, tokenA)).toBeNull();
    });
    it.each(['VOID', 'DECLINED', 'DRAFT'])('never accepts a customer quote in %s', async status => {
        const id = await quote();
        await repo.updateInvoice('accept-org', 'quote-owner', id, { status });
        await expect(repo.convertQuote(input(id))).rejects.toThrow(QuoteUnavailableError);
        expect(await repo.getQuoteForAcceptance('accept-org', id, tokenA)).toBeNull();
    });
    it('rejects expired customer quotes while manual draft conversion has no acceptance event', async () => {
        const expired = await quote({ dueDate: '2000-01-01' });
        expect(await repo.getQuoteForAcceptance('accept-org', expired, tokenA)).not.toBeNull();
        await expect(repo.convertQuote(input(expired))).rejects.toThrow(QuoteUnavailableError);
        const draft = await quote({ status: 'DRAFT' });
        const result = await repo.convertQuote(input(draft, { tokenHash: undefined }));
        expect(result.quote.quoteAcceptedAt).toBeUndefined();
        expect(result.quote.quoteAcceptedEventId).toBeUndefined();
        expect(result.invoice.status).toBe('DRAFT');
    });
    it('rolls back conversion on invoice ID collision', async () => {
        const id = await quote();
        await repo.createInvoice('accept-org', 'quote-owner', `inv-${id}`, { invoiceNumber: 'EXISTING', status: 'PAID', paidAmount: 99, items: [] });
        await expect(repo.convertQuote(input(id))).rejects.toThrow(QuoteConversionConflictError);
        expect((await repo.getInvoice('accept-org', 'quote-owner', id))?.status).toBe('SENT');
        expect((await repo.getInvoice('accept-org', 'quote-owner', `inv-${id}`))?.status).toBe('PAID');
    });
    it('refuses stale sent/void/edit writes after conversion and direct acceptance-marker writes', async () => {
        const id = await quote();
        await repo.convertQuote(input(id));
        for (const changes of [{ status: 'SENT' }, { status: 'VOID' }, { notes: 'Stale edit' }]) {
            await expect(repo.updateInvoice('accept-org', 'quote-owner', id, changes)).rejects.toThrow(QuoteConversionConflictError);
        }
        const fresh = await quote();
        await expect(repo.updateInvoice('accept-org', 'quote-owner', fresh, { status: 'ACCEPTED' })).rejects.toThrow(QuoteConversionConflictError);
        await expect(repo.updateInvoice('accept-org', 'quote-owner', fresh, { convertedInvoiceId: 'fake' })).rejects.toThrow(QuoteConversionConflictError);
    });
    it('void and acceptance contend on the same quote lock', async () => {
        const id = await quote();
        const results = await Promise.allSettled([repo.updateInvoice('accept-org', 'quote-owner', id, { status: 'VOID' }), repo.convertQuote(input(id))]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        const saved = await repo.getInvoice('accept-org', 'quote-owner', id);
        expect(['VOID', 'CONVERTED']).toContain(saved?.status);
        expect(!!await repo.getInvoice('accept-org', 'quote-owner', `inv-${id}`)).toBe(saved?.status === 'CONVERTED');
    });
    it('a stale delete cannot remove the accepted source quote or its pending notification', async () => {
        const id = await quote();
        await repo.convertQuote(input(id));
        await expect(repo.deleteInvoice('accept-org', 'quote-owner', id)).rejects.toThrow(QuoteConversionConflictError);
        expect((await repo.getInvoice('accept-org', 'quote-owner', id))?.status).toBe('CONVERTED');
        expect((await repo.listPendingQuoteAcceptances()).map(row => row.quote.invoiceId)).toContain(id);
        const draft = await quote({ status: 'DRAFT' });
        await repo.deleteInvoice('accept-org', 'quote-owner', draft);
        expect(await repo.getInvoice('accept-org', 'quote-owner', draft)).toBeNull();
    });
});
