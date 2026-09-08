import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull, isNotNull, desc, lt, or, sql } from 'drizzle-orm';
import { getPg, getPgTx, type PgDb } from '../pg/client';
import { smsResponseLinks as links } from '../pg/schema/smsResponse';
import { leads, bookings } from '../pg/schema/leadsPipelines';
import { clients, clientContacts, invoices } from '../pg/schema/billingCore';
import { SmsResponseScopeSchema, SmsResponseContextSchema, type SmsResponseScope, type SmsResponseContext, type SmsRecipient } from './schema';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const scoped = (scope: SmsResponseScope) => { SmsResponseScopeSchema.parse(scope); return and(eq(links.orgId, scope.orgId), eq(links.businessProfileId, scope.businessProfileId)); };
const phone = (value: string) => { const p = value.replace(/[\s()-]/g, ''); return p.startsWith('04') ? `+61${p.slice(1)}` : p.startsWith('61') ? `+${p}` : p; };
export type SmsResponseLink = typeof links.$inferSelect;
/** Operational state is Postgres-only. Tokens contain no recipient information. */
export class SmsResponseRepo {
    constructor(private readonly injectedDb?: PgDb) {}
    private db() { return this.injectedDb ?? getPg(); }
    private tx() { return this.injectedDb ?? getPgTx(); }
    /** Resolve only within the explicit profile. Ambiguous recipients need an explicit record reference. */
    async findRecipient(scope: SmsResponseScope, normalizedPhone: string, hint?: { kind: SmsRecipient['kind']; id: string }): Promise<SmsRecipient | null> {
        SmsResponseScopeSchema.parse(scope);
        if (!/^\+[1-9]\d{7,14}$/.test(normalizedPhone)) return null;
        const matches = (column: any) => sql`(case when regexp_replace(coalesce(${column}, ''), '[[:space:]()-]', '', 'g') like '04%' then '+61' || substring(regexp_replace(${column}, '[[:space:]()-]', '', 'g') from 2) when regexp_replace(coalesce(${column}, ''), '[[:space:]()-]', '', 'g') like '61%' then '+' || regexp_replace(${column}, '[[:space:]()-]', '', 'g') else regexp_replace(coalesce(${column}, ''), '[[:space:]()-]', '', 'g') end) = ${normalizedPhone}`;
        const result: SmsRecipient[] = [];
        if (!hint || hint.kind === 'lead') {
            const rows = await this.db().select({ id: leads.leadId, ownerId: leads.ownerId }).from(leads).where(and(eq(leads.orgId, scope.orgId), eq(leads.businessProfileId, scope.businessProfileId), matches(leads.clientPhone), hint ? eq(leads.leadId, hint.id) : undefined)).limit(2);
            result.push(...rows.map(r => ({ ...r, kind: 'lead' as const })));
        }
        if (!hint || hint.kind === 'client') {
            const rows = await this.db().selectDistinct({ id: clients.clientId, ownerId: clients.createdBy }).from(clients).leftJoin(clientContacts, eq(clientContacts.clientId, clients.clientId)).where(and(eq(clients.orgId, scope.orgId), eq(clients.businessProfileId, scope.businessProfileId), or(eq(clients.archived, false), isNull(clients.archived)), or(matches(clients.phone), matches(clientContacts.phone)), hint ? eq(clients.clientId, hint.id) : undefined)).limit(2);
            result.push(...rows.map(r => ({ ...r, kind: 'client' as const })));
        }
        if (!hint || hint.kind === 'booking') {
            const rows = await this.db().select({ id: bookings.bookingId, ownerId: bookings.ownerId }).from(bookings).where(and(eq(bookings.orgId, scope.orgId), eq(bookings.businessProfileId, scope.businessProfileId), matches(bookings.clientPhone), hint ? eq(bookings.bookingId, hint.id) : undefined)).limit(2);
            result.push(...rows.map(r => ({ ...r, kind: 'booking' as const })));
        }
        return result.length === 1 ? result[0] : null;
    }
    async create(scope: SmsResponseScope, context: SmsResponseContext, normalizedPhone: string, now = new Date()) {
        SmsResponseScopeSchema.parse(scope); SmsResponseContextSchema.parse(context);
        const recipient = await this.findRecipient(scope, normalizedPhone, context.recipient);
        if (!recipient || recipient.ownerId !== context.recipient.ownerId) throw new Error('Recipient unavailable');
        if (context.invoiceId) {
            const invoice = (await this.db().select({ clientId: invoices.clientId }).from(invoices).where(and(eq(invoices.orgId, scope.orgId), eq(invoices.businessProfileId, scope.businessProfileId), eq(invoices.invoiceId, context.invoiceId))).limit(1))[0];
            if (!invoice || (context.recipient.kind === 'client' && invoice.clientId !== context.recipient.id)) throw new Error('Invoice outside recipient context');
        }
        const token = randomBytes(24).toString('base64url'), tokenHash = hash(token);
        const inserted = await this.db().insert(links).values({ ...scope, tokenHash, context, phoneHash: hash(`${tokenHash}:${normalizedPhone}`), createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 7 * 86400000).toISOString(), deliveryState: 'pending', attempts: 0, processingAttempts: 0 }).onConflictDoNothing().returning({ tokenHash: links.tokenHash });
        if (!inserted.length) {
            const error = new Error('This text action was already prepared. Check its delivery before sending a new message.');
            error.name = 'SmsResponseDeliveryConflict';
            throw error;
        }
        return { token, tokenHash };
    }
    async resolve(token: string, now = new Date()): Promise<SmsResponseLink | null> {
        if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
        const row = (await this.db().select().from(links).where(eq(links.tokenHash, hash(token))).limit(1))[0];
        return row && !row.revokedAt && row.expiresAt > now.toISOString() && row.deliveryState !== 'failed' ? row : null;
    }
    async finishDelivery(scope: SmsResponseScope, tokenHash: string, state: 'accepted' | 'unknown' | 'failed', providerMessageId?: string) {
        await this.db().update(links).set({ deliveryState: state, providerMessageId }).where(and(scoped(scope), eq(links.tokenHash, tokenHash), eq(links.deliveryState, 'pending')));
    }
    async revoke(scope: SmsResponseScope, tokenHash: string) {
        await this.db().update(links).set({ revokedAt: new Date().toISOString() }).where(and(scoped(scope), eq(links.tokenHash, tokenHash)));
    }
    /** One reply per link. Same request and text replay safely; a different submission cannot overwrite it. */
    async submit(token: string, enteredPhone: string, responseId: string, responseText: string, now = new Date()) {
        if (!/^[A-Za-z0-9_-]{16,100}$/.test(responseId) || !responseText.trim() || responseText.trim().length > 4000 || enteredPhone.length > 40) return { status: 'invalid' as const };
        const candidate = await this.resolve(token, now);
        if (!candidate) return { status: 'unavailable' as const };
        return this.tx().transaction(async tx => {
            const invoiceId = candidate.context.invoiceId;
            if (invoiceId) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([candidate.orgId, candidate.businessProfileId, invoiceId])}, 0))`);
            const row = (await tx.select().from(links).where(eq(links.tokenHash, candidate.tokenHash)).for('update'))[0];
            if (!row || row.revokedAt || row.expiresAt <= now.toISOString() || row.deliveryState === 'failed') return { status: 'unavailable' as const };
            const normalized = phone(enteredPhone);
            const correct = timingSafeEqual(Buffer.from(hash(`${row.tokenHash}:${normalized}`)), Buffer.from(row.phoneHash));
            if (row.responseId) return correct && row.responseId === responseId && row.responseText === responseText.trim() ? { status: 'accepted' as const, row } : { status: 'unavailable' as const };
            if (row.attempts >= 10 || (row.lastAttemptAt && now.getTime() - Date.parse(row.lastAttemptAt) < 2000)) return { status: 'limited' as const };
            await tx.update(links).set({ attempts: row.attempts + 1, lastAttemptAt: now.toISOString() }).where(eq(links.tokenHash, row.tokenHash));
            const recipient = correct ? await new SmsResponseRepo(tx).findRecipient(row, normalized, row.context.recipient) : null;
            if (!recipient || recipient.ownerId !== row.context.recipient.ownerId) return { status: 'invalid' as const };
            const saved = (await tx.update(links).set({ responsePhone: normalized, responseId, responseText: responseText.trim(), receivedAt: now.toISOString() }).where(eq(links.tokenHash, row.tokenHash)).returning())[0];
            return { status: 'accepted' as const, row: saved };
        });
    }
    async claimProcessing(scope: SmsResponseScope, tokenHash: string, processingId: string, now = new Date()) {
        const rows = await this.db().update(links).set({ processingId, processingUntil: new Date(now.getTime() + 120000).toISOString(), processingAttempts: sql`${links.processingAttempts} + 1` }).where(and(scoped(scope), eq(links.tokenHash, tokenHash), isNotNull(links.receivedAt), isNull(links.publishedAt), or(isNull(links.processingUntil), lt(links.processingUntil, now.toISOString())), or(isNull(links.retryAt), lt(links.retryAt, now.toISOString())))).returning();
        return rows[0] ?? null;
    }
    async markPublished(scope: SmsResponseScope, tokenHash: string, processingId: string) {
        await this.db().update(links).set({ publishedAt: new Date().toISOString(), processingUntil: null }).where(and(scoped(scope), eq(links.tokenHash, tokenHash), eq(links.processingId, processingId), isNotNull(links.receivedAt)));
    }
    async retryProcessing(scope: SmsResponseScope, tokenHash: string, processingId: string) {
        await this.db().update(links).set({ processingUntil: null, retryAt: new Date(Date.now() + 60000).toISOString() }).where(and(scoped(scope), eq(links.tokenHash, tokenHash), eq(links.processingId, processingId), isNull(links.publishedAt)));
    }
    async listPending(limit = 20) {
        return this.db().select().from(links).where(and(isNotNull(links.receivedAt), isNull(links.publishedAt), or(isNull(links.processingUntil), lt(links.processingUntil, new Date().toISOString())), or(isNull(links.retryAt), lt(links.retryAt, new Date().toISOString())))).orderBy(links.processingAttempts, links.receivedAt).limit(Math.max(1, Math.min(limit, 100)));
    }
    async isInvoicePaused(scope: SmsResponseScope, invoiceId: string) {
        return (await this.db().select({ id: links.tokenHash }).from(links).where(and(scoped(scope), sql`${links.context}->>'invoiceId' = ${invoiceId}`, isNotNull(links.receivedAt))).limit(1)).length > 0;
    }
    async listReplies(scope: SmsResponseScope, options: { limit?: number; nextToken?: string; ownerId?: string } = {}) {
        const limit = Math.max(1, Math.min(100, options.limit ?? 20));
        let after;
        if (options.nextToken) {
            const c = JSON.parse(Buffer.from(options.nextToken, 'base64').toString());
            if (c.orgId !== scope.orgId || c.businessProfileId !== scope.businessProfileId || c.ownerId !== options.ownerId || typeof c.receivedAt !== 'string' || typeof c.tokenHash !== 'string') throw new Error('Invalid nextToken');
            after = or(lt(links.receivedAt, c.receivedAt), and(eq(links.receivedAt, c.receivedAt), lt(links.tokenHash, c.tokenHash)));
        }
        const rows = await this.db().select().from(links).where(and(scoped(scope), isNotNull(links.receivedAt), options.ownerId ? sql`${links.context}->'recipient'->>'ownerId' = ${options.ownerId}` : undefined, after)).orderBy(desc(links.receivedAt), desc(links.tokenHash)).limit(limit + 1);
        const items = rows.slice(0, limit), last = items[items.length - 1];
        return { items, nextToken: rows.length > limit ? Buffer.from(JSON.stringify({ ...scope, ownerId: options.ownerId, receivedAt: last.receivedAt, tokenHash: last.tokenHash })).toString('base64') : null };
    }
}
