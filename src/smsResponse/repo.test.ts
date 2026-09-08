import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readFileSync } from 'node:fs';
import { SmsResponseRepo } from './repo';
import { InboundEmailRepo } from '../inboundEmail/repo';
let pg: PGlite, repo: SmsResponseRepo;
const scope = { orgId: 'org', businessProfileId: 'profile' };
const context = { source: 'test', originId: 'message', recipient: { kind: 'lead' as const, id: 'lead', ownerId: 'owner' }, invoiceId: 'invoice' };
beforeEach(async () => {
    pg = new PGlite();
    await pg.exec(readFileSync('drizzle/0059_sms_response_links.sql', 'utf8'));
    await pg.exec(`CREATE TABLE invoices(invoice_id text,org_id text,business_profile_id text,client_id text);
      INSERT INTO invoices VALUES('invoice','org','profile','client');
      CREATE TABLE leads (lead_id text,org_id text,business_profile_id text,owner_id text,client_phone text);
      CREATE TABLE clients (client_id text,org_id text,business_profile_id text,created_by text,phone text,archived boolean);
      CREATE TABLE client_contacts(contact_id text,client_id text,phone text);
      CREATE TABLE bookings(booking_id text,org_id text,business_profile_id text,owner_id text,client_phone text);
      INSERT INTO leads VALUES ('lead','org','profile','owner','0422 819 869'),('other','org','other-profile','other','0422 819 869');`);
    repo = new SmsResponseRepo(drizzle(pg) as any);
});
afterEach(async () => pg.close());
describe('SMS public replies', () => {
    it('normalizes phones only inside the intended profile and record', async () => {
        expect(await repo.findRecipient(scope, '+61422819869')).toEqual(context.recipient);
        expect(await repo.findRecipient(scope, '+61422819869', { kind: 'lead', id: 'other' })).toBeNull();
        const { token } = await repo.create(scope, context, '+61422819869');
        expect((await repo.submit(token, '0422 819 869', 'request1234567890', 'Reply')).status).toBe('accepted');
        expect(await repo.isInvoicePaused(scope, 'invoice')).toBe(true);
        expect(await repo.isInvoicePaused({ ...scope, businessProfileId: 'other-profile' }, 'invoice')).toBe(false);
    });
    it('rejects forged, expired, revoked and failed-delivery links', async () => {
        expect(await repo.resolve('a'.repeat(32))).toBeNull();
        const old = await repo.create(scope, context, '+61422819869', new Date('2020-01-01'));
        expect(await repo.resolve(old.token)).toBeNull();
        const link = await repo.create(scope, context, '+61422819869');
        await repo.revoke({ ...scope, businessProfileId: 'wrong' }, link.tokenHash);
        expect(await repo.resolve(link.token)).not.toBeNull();
        await repo.revoke(scope, link.tokenHash);
        expect(await repo.resolve(link.token)).toBeNull();
        const failed = await repo.create(scope, context, '+61422819869');
        await repo.finishDelivery(scope, failed.tokenHash, 'failed');
        expect(await repo.resolve(failed.token)).toBeNull();
    });
    it('replays identical submissions without another outbox entry or replacing text', async () => {
        const { token } = await repo.create(scope, context, '+61422819869');
        expect((await repo.submit(token, '+61422819869', 'request1234567890', 'Original')).status).toBe('accepted');
        expect((await repo.submit(token, '+61422819869', 'request1234567890', 'Original')).status).toBe('accepted');
        expect((await repo.submit(token, '+61422819869', 'request1234567891', 'Changed')).status).toBe('unavailable');
        expect(await repo.listPending()).toHaveLength(1);
        expect((await repo.listReplies(scope)).items[0].responseText).toBe('Original');
        expect((await repo.listReplies({ ...scope, businessProfileId: 'other-profile' })).items).toEqual([]);
    });
    it('limits guesses and never pauses an invoice for a mismatch', async () => {
        const now = new Date();
        const { token } = await repo.create(scope, context, '+61422819869', now);
        for (let i = 0; i < 10; i++) expect((await repo.submit(token, '+61400000000', 'request1234567890', 'Bad', new Date(now.getTime() + i * 2100))).status).toBe('invalid');
        expect((await repo.submit(token, '+61422819869', 'request1234567890', 'Good', new Date(now.getTime() + 22000))).status).toBe('limited');
        expect(await repo.isInvoicePaused(scope, 'invoice')).toBe(false);
    });
    it('rejects a moved/deleted recipient even when the old phone is known', async () => {
        const { token } = await repo.create(scope, context, '+61422819869');
        await pg.exec("UPDATE leads SET business_profile_id='moved' WHERE lead_id='lead'");
        expect((await repo.submit(token, '+61422819869', 'request1234567890', 'Reply')).status).toBe('invalid');
    });
    it('does not guess between duplicate records', async () => {
        await pg.exec("INSERT INTO leads VALUES('duplicate','org','profile','owner','+61422819869')");
        expect(await repo.findRecipient(scope, '+61422819869')).toBeNull();
        expect(await repo.findRecipient(scope, '+61422819869', context.recipient)).toEqual(context.recipient);
    });
});

it('leases serialize overlapping processors and permit recovery after expiry', async () => {
    const link = await repo.create(scope, context, '+61422819869');
    await repo.submit(link.token, '+61422819869', 'request1234567890', 'Reply');
    const now = new Date();
    const claims = await Promise.all([repo.claimProcessing(scope, link.tokenHash, 'first', now), repo.claimProcessing(scope, link.tokenHash, 'second', now)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await repo.listPending()).toHaveLength(0);
    expect(await repo.claimProcessing(scope, link.tokenHash, 'recover', new Date(now.getTime() + 121000))).not.toBeNull();
    await repo.markPublished(scope, link.tokenHash, 'stale');
    expect((await repo.resolve(link.token))?.publishedAt).toBeNull();
    await repo.markPublished(scope, link.tokenHash, 'recover');
    expect((await repo.resolve(link.token))?.publishedAt).not.toBeNull();
});

it('SMS reply pauses the same email delivery arbitration without SES message fabrication', async () => {
    await pg.exec(readFileSync('drizzle/0056_inbound_email.sql', 'utf8'));
    await pg.exec(readFileSync('drizzle/0057_invoice_reply_links.sql', 'utf8'));
    const email = new InboundEmailRepo(drizzle(pg) as any);
    await email.ensureConversation(scope, { conversationId: 'email', invoiceId: 'invoice', customerEmail: 'customer@example.com' }, 'in.example.com');
    const link = await repo.create(scope, context, '+61422819869');
    await repo.submit(link.token, '+61422819869', 'request1234567890', 'Please review');
    expect(await email.claimDelivery(scope, 'email', 'later-reminder')).toBe('paused');
    expect(await email.claimInvoiceDelivery(scope, 'invoice', 'later-text')).toBe('paused');
    expect(await email.isInvoicePaused({ ...scope, businessProfileId: 'other' }, 'invoice')).toBe(false);
    expect((await email.listMessages(scope)).items).toEqual([]);
});

it('rejects an originating invoice outside the recipient profile', async () => {
    await expect(repo.create(scope, { ...context, invoiceId: 'foreign' }, '+61422819869')).rejects.toThrow('Invoice outside');
});

it('generic invoice delivery claims deduplicate without SES conversations', async () => {
    await pg.exec(readFileSync('drizzle/0056_inbound_email.sql', 'utf8'));
    await pg.exec(readFileSync('drizzle/0057_invoice_reply_links.sql', 'utf8'));
    const email = new InboundEmailRepo(drizzle(pg) as any);
    expect(await email.claimInvoiceDelivery(scope, 'invoice', 'first')).toBe('claimed');
    expect(await email.claimInvoiceDelivery(scope, 'invoice', 'first')).toBe('duplicate');
    const link = await repo.create(scope, context, '+61422819869');
    await repo.submit(link.token, '+61422819869', 'request1234567890', 'Review');
    expect(await email.claimInvoiceDelivery(scope, 'invoice', 'after')).toBe('paused');
});
