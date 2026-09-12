import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { InboundEmailRepo } from './repo';
import type { PgDb } from '../pg/client';
import type { InboundMessageContent } from './schema';
import { runMigrations } from '../pg/migrate';
let pg: PGlite;
let repo: InboundEmailRepo;
const a = { orgId: 'org-a' };
const b = { orgId: 'org-b' };
const domain = 'inbound.example.com';
const content: InboundMessageContent = { sender: 'customer@example.com', recipients: [], subject: 'Reply', body: 'Please stop', rawKey: 'raw/test', references: [], kind: 'human', attachments: [] };
beforeAll(async () => {
    pg = new PGlite({ extensions: { pg_trgm } });
    await runMigrations({ exec: async (statement: string) => ({ rows: (await pg.query(statement)).rows as any[] }) });
    repo = new InboundEmailRepo(drizzle(pg) as unknown as PgDb);
});
afterAll(async () => { await pg.close(); });
describe('organisation-owned email repository', () => {
    it('creates one opaque, stable address per organisation', async () => {
        const [first, duplicate, other] = await Promise.all([repo.ensureMailbox(a, domain), repo.ensureMailbox(a, domain), repo.ensureMailbox(b, domain)]);
        expect(first.address).toBe(duplicate.address);
        expect(other.address).not.toBe(first.address);
        expect(first.address).toMatch(/^in-[a-f0-9]{48}@/);
        expect(await repo.resolveRecipient(first.address.toUpperCase())).toMatchObject(a);
        expect(await repo.resolveRecipient('missing@inbound.example.com')).toBeNull();
    });
    it('isolates direct conversation reads and rejects conflicting identities', async () => {
        const row = await repo.ensureConversation(a, { conversationId: 'invoice-1', invoiceId: 'inv-1', customerEmail: content.sender }, domain);
        expect(await repo.resolveRecipient(row.replyAddress)).toMatchObject({ ...a, conversationId: 'invoice-1' });
        expect(await repo.getConversation(b, row.conversationId)).toBeNull();
        await expect(repo.ensureConversation(a, { conversationId: 'invoice-1', invoiceId: 'inv-2', customerEmail: content.sender }, domain)).rejects.toThrow('identity conflict');
        await expect(repo.recordMessage(b, { messageId: 'cross', conversationId: row.conversationId, receivedAt: '2026-09-08', content })).rejects.toThrow('outside organisation');
    });
    it('pauses on human reply, deduplicates delivery, and never resumes after later automatic mail', async () => {
        const input = { messageId: 'reply-1', conversationId: 'invoice-1', receivedAt: '2026-09-08T01:00:00Z', content };
        expect(await repo.recordMessage(a, input)).toEqual({ inserted: true, paused: true });
        expect(await repo.recordMessage(a, input)).toEqual({ inserted: false, paused: false });
        expect(await repo.claimDelivery(a, 'invoice-1', 'send-later')).toBe('paused');
        await repo.recordMessage(a, { ...input, messageId: 'automatic', content: { ...content, kind: 'automatic' } });
        expect(await repo.isInvoicePaused(a, 'inv-1')).toBe(true);
        expect(await repo.isInvoicePaused(b, 'inv-1')).toBe(false);
        expect(await repo.getMessage(b, 'reply-1')).toBeNull();
    });
    it('permits one claim only and suppresses the next after a racing reply', async () => {
        await repo.ensureConversation(a, { conversationId: 'race', invoiceId: 'race-invoice', customerEmail: content.sender }, domain);
        const claims = await Promise.all([repo.claimDelivery(a, 'race', 'one'), repo.claimDelivery(a, 'race', 'one')]);
        expect(claims.sort()).toEqual(['claimed', 'duplicate']);
        await Promise.all([
            repo.recordMessage(a, { messageId: 'race-reply', conversationId: 'race', receivedAt: '2026-09-08T02:00:00Z', content }),
            repo.claimDelivery(a, 'race', 'racing'),
        ]);
        expect(await repo.claimDelivery(a, 'race', 'after')).toBe('paused');
    });
    it('does not pause for automated replies or delivery reports', async () => {
        await repo.ensureConversation(a, { conversationId: 'auto', invoiceId: 'auto-invoice', customerEmail: content.sender }, domain);
        for (const kind of ['automatic', 'bounce', 'loop', 'rejected', 'verification'] as const) {
            await repo.recordMessage(a, { messageId: kind, conversationId: 'auto', receivedAt: '2026-09-08T03:00:00Z', content: { ...content, kind } });
        }
        expect(await repo.claimDelivery(a, 'auto', 'automatic-safe')).toBe('claimed');
    });
    it('correlates supporting reply headers only within the envelope tenant', async () => {
        await repo.completeDelivery(a, 'automatic-safe', 'ses-provider-id');
        expect(await repo.conversationFromReferences(a, ['<ses-provider-id@email.amazonses.com>'])).toMatchObject({ conversationId: 'auto' });
        expect(await repo.conversationFromReferences(b, ['<ses-provider-id@email.amazonses.com>'])).toBeNull();
    });
    it('pauses every invoice covered by a statement, including separate reminder conversations', async () => {
        await repo.ensureConversation(a, { conversationId: 'statement', customerEmail: content.sender }, domain);
        await repo.linkInvoices(a, 'statement', ['statement-invoice-1', 'statement-invoice-2']);
        await repo.ensureConversation(a, { conversationId: 'individual', invoiceId: 'statement-invoice-2', customerEmail: content.sender }, domain);
        await repo.recordMessage(a, { messageId: 'statement-reply', conversationId: 'statement', receivedAt: '2026-09-08T04:00:00Z', content });
        expect(await repo.isInvoicePaused(a, 'statement-invoice-1')).toBe(true);
        expect(await repo.claimDelivery(a, 'individual', 'later-individual')).toBe('paused');
    });
    it('stores queued chase scope and rejects conflicting retry ownership', async () => {
        await repo.registerChaseAction(a, 'call-1', 'inv-1');
        await repo.registerChaseAction(a, 'call-1', 'inv-1');
        expect(await repo.getChaseAction(a.orgId, 'call-1')).toMatchObject(a);
        expect(await repo.getChaseAction('another-org', 'call-1')).toBeNull();
        await expect(repo.registerChaseAction(a, 'call-1', 'inv-2')).rejects.toThrow('identity conflict');
    });
    it('paginates in Postgres and refuses a cursor from another organisation', async () => {
        const first = await repo.listMessages(a, { limit: 2 });
        expect(first.items).toHaveLength(2);
        expect(first.nextToken).toBeTruthy();
        const second = await repo.listMessages(a, { limit: 2, nextToken: first.nextToken! });
        expect(second.items.every(item => !first.items.some(prior => prior.messageId === item.messageId))).toBe(true);
        await expect(repo.listMessages(b, { nextToken: first.nextToken! })).rejects.toThrow('Invalid nextToken');
        expect((await repo.listMessages(b)).items).toEqual([]);
    });
});
