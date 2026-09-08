import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readFileSync } from 'node:fs';
import { InboundEmailRepo } from './repo';
import type { PgDb } from '../pg/client';
import type { InboundMessageContent } from './schema';
let pg: PGlite;
let repo: InboundEmailRepo;
const a = { orgId: 'org', businessProfileId: 'a' };
const b = { orgId: 'org', businessProfileId: 'b' };
const domain = 'inbound.example.com';
const content: InboundMessageContent = { sender: 'customer@example.com', recipients: [], subject: 'Reply', body: 'Please stop', rawKey: 'raw/test', references: [], kind: 'human', attachments: [] };
beforeAll(async () => {
    pg = new PGlite();
    const migration = readFileSync('drizzle/0056_inbound_email.sql', 'utf8');
    await pg.exec(migration);
    await pg.exec(migration);
    repo = new InboundEmailRepo(drizzle(pg) as unknown as PgDb);
});
afterAll(async () => { await pg.close(); });
describe('profile-owned email repository', () => {
    it('creates opaque, stable, different addresses for profiles sharing an org', async () => {
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
        await expect(repo.recordMessage(b, { messageId: 'cross', conversationId: row.conversationId, receivedAt: '2026-09-08', content })).rejects.toThrow('outside profile');
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
    it('paginates in Postgres and refuses a cursor from another profile', async () => {
        const first = await repo.listMessages(a, { limit: 2 });
        expect(first.items).toHaveLength(2);
        expect(first.nextToken).toBeTruthy();
        const second = await repo.listMessages(a, { limit: 2, nextToken: first.nextToken! });
        expect(second.items.every(item => !first.items.some(prior => prior.messageId === item.messageId))).toBe(true);
        await expect(repo.listMessages(b, { nextToken: first.nextToken! })).rejects.toThrow('Invalid nextToken');
        expect((await repo.listMessages(b)).items).toEqual([]);
    });
});
