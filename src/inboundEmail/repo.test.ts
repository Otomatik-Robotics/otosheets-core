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
    it('records a triage verdict on a message and reads the latest one back for its thread', async () => {
        await repo.ensureConversation(a, { conversationId: 'triage', customerEmail: content.sender }, domain);
        await repo.recordMessage(a, { messageId: 't1', conversationId: 'triage', receivedAt: '2026-09-08T04:00:00Z', content });
        await repo.recordMessage(a, { messageId: 't2', conversationId: 'triage', receivedAt: '2026-09-08T05:00:00Z', content });
        expect(await repo.latestTriage(a, 'triage')).toBeNull();
        await repo.setTriage(a, 't1', { verdict: 'not_job', reason: 'newsletter', by: 'model', at: '2026-09-08T04:00:01Z' });
        await repo.setTriage(a, 't2', { verdict: 'job', reason: 'owner said so', by: 'owner', at: '2026-09-08T05:00:01Z' });
        expect(await repo.latestTriage(a, 'triage')).toMatchObject({ verdict: 'job', by: 'owner' });
        expect((await repo.getMessage(a, 't1'))?.content).toMatchObject({ body: 'Please stop', triage: { verdict: 'not_job' } });
        expect(await repo.latestTriage(b, 'triage')).toBeNull();
    });
    it('correlates supporting reply headers only within the envelope tenant', async () => {
        await repo.completeDelivery(a, 'automatic-safe', 'ses-provider-id');
        expect(await repo.conversationFromReferences(a, ['<ses-provider-id@email.amazonses.com>'])).toMatchObject({ conversationId: 'auto' });
        expect(await repo.conversationFromReferences(b, ['<ses-provider-id@email.amazonses.com>'])).toBeNull();
    });
    it('applies filtered email selection before pagination and binds cursors to the organisation and filter', async () => {
        const scope = { orgId: 'filtered-org' };
        await repo.ensureConversation(scope, { conversationId: 'filtered-thread', customerEmail: content.sender }, domain);
        for (let i = 0; i < 25; i++) {
            await repo.recordMessage(scope, { messageId: `filtered-${String(i).padStart(2, '0')}`, conversationId: 'filtered-thread', receivedAt: '2026-09-13T00:00:00Z', content: { ...content, triage: { verdict: i < 3 ? 'not_job' : 'job', reason: 'test', by: 'model', at: '2026-09-13T00:00:01Z' } } });
        }
        const first = await repo.listMessages(scope, { verdict: 'not_job', limit: 2 });
        expect(first.total).toBe(3);
        expect(first.items.map(message => message.messageId)).toEqual(['filtered-02', 'filtered-01']);
        const second = await repo.listMessages(scope, { verdict: 'not_job', limit: 2, nextToken: first.nextToken! });
        expect(second.items.map(message => message.messageId)).toEqual(['filtered-00']);
        expect(second.nextToken).toBeNull();
        await expect(repo.listMessages(b, { verdict: 'not_job', nextToken: first.nextToken! })).rejects.toThrow('Invalid nextToken');
        await expect(repo.listMessages(scope, { nextToken: first.nextToken! })).rejects.toThrow('Invalid nextToken');
        await expect(repo.listMessages(scope, { verdict: 'job', nextToken: first.nextToken! })).rejects.toThrow('Invalid nextToken');
        await expect(repo.listMessages(scope, { nextToken: 'broken' })).rejects.toThrow('Invalid nextToken');
        expect((await repo.listMessages(b, { verdict: 'not_job' })).total).toBe(0);
        await repo.setTriage(scope, 'filtered-01', { verdict: 'job', reason: 'owner decision', by: 'owner', at: '2026-09-15T00:00:00Z' });
        expect((await repo.listMessages(scope, { verdict: 'not_job' })).total).toBe(2);
        await repo.ignoreMessage(b, 'filtered-02');
        expect((await repo.listMessages(scope, { verdict: 'not_job' })).total).toBe(2);
        const triage = await repo.latestTriage(scope, 'filtered-thread');
        await repo.ignoreMessage(scope, 'filtered-02');
        const ignored = await repo.getMessage(scope, 'filtered-02');
        expect(ignored?.content.ignoredAt).toBeTruthy();
        await repo.ignoreMessage(scope, 'filtered-02');
        expect(await repo.getMessage(scope, 'filtered-02')).toEqual(ignored);
        expect(await repo.latestTriage(scope, 'filtered-thread')).toEqual(triage);
        const remaining = await repo.listMessages(scope, { verdict: 'not_job', limit: 1 });
        expect(remaining.total).toBe(1);
        expect(remaining.items.map(message => message.messageId)).toEqual(['filtered-00']);
        expect(remaining.nextToken).toBeNull();
        await repo.ignoreMessage(scope, 'filtered-01');
        expect((await repo.getMessage(scope, 'filtered-01'))?.content.ignoredAt).toBeUndefined();
    });
    it('uses a new owner verdict on an older message for subsequent replies', async () => {
        await repo.setTriage(a, 't1', { verdict: 'not_job', reason: 'owner decision', by: 'owner', at: '2026-09-15T00:00:00Z' });
        expect(await repo.latestTriage(a, 'triage')).toMatchObject({ verdict: 'not_job', by: 'owner' });
        await repo.recordMessage(a, { messageId: 't-racing', conversationId: 'triage', receivedAt: '2026-09-16T00:00:00Z', content: { ...content, triage: { verdict: 'job', reason: 'inherited a stale verdict', by: 'rule', at: '2026-09-16T00:00:01Z' } } });
        expect(await repo.latestTriage(a, 'triage')).toMatchObject({ verdict: 'not_job', by: 'owner' });
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
