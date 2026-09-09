import { createHash } from 'node:crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { profileSignatureRequests as requests } from '../pg/schema/signatureRequests';
import { SignatureRequestInput } from './schema';

export class SignatureRequestConflict extends Error {}
export type ProfileSignatureRequest = typeof requests.$inferSelect;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const safe = (value: string) => typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value);

/** PostgreSQL-only. Caller must freshly authenticate the adviser/client relationship.
 * Scope and actor are trusted server context, never request-body fields. No legacy fallback.
 */
export class ProfileSignatureRequestPgRepo {
    private readonly scope: Readonly<{ orgId: string; businessProfileId: string; advisorUserId: string }>;
    constructor(orgId: string, businessProfileId: string, advisorUserId: string, private readonly injected?: PgDb) {
        if (![orgId, businessProfileId, advisorUserId].every(safe)) throw new Error('Signature request scope is required');
        this.scope = Object.freeze({ orgId, businessProfileId, advisorUserId });
    }
    private get db(): PgDb { return this.injected ?? getPg(); }
    private owned(requestId?: string) {
        return and(eq(requests.orgId, this.scope.orgId), eq(requests.businessProfileId, this.scope.businessProfileId),
            eq(requests.advisorUserId, this.scope.advisorUserId), requestId === undefined ? undefined : eq(requests.requestId, requestId));
    }
    async get(requestId: string): Promise<ProfileSignatureRequest | null> {
        return (await this.db.select().from(requests).where(this.owned(requestId)).limit(1))[0] ?? null;
    }
    async create(input: SignatureRequestInput): Promise<ProfileSignatureRequest> {
        const payload = SignatureRequestInput.parse(input);
        const requestId = 'sr_' + hash([this.scope.orgId, this.scope.businessProfileId, this.scope.advisorUserId, payload.clientRequestKey]);
        const payloadFingerprint = hash(payload);
        await this.db.insert(requests).values({ ...payload, ...this.scope, requestId, payloadFingerprint, provider: 'otosheets' }).onConflictDoNothing();
        const current = await this.get(requestId);
        if (!current || current.payloadFingerprint !== payloadFingerprint) throw new SignatureRequestConflict('Request key conflicts with an existing request');
        return current;
    }
    async list(limit = 25, afterRequestId?: string): Promise<ProfileSignatureRequest[]> {
        if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (afterRequestId !== undefined && !/^sr_[a-f0-9]{64}$/.test(afterRequestId))) throw new Error('Invalid signature request page');
        return this.db.select().from(requests).where(and(this.owned(), afterRequestId ? gt(requests.requestId, afterRequestId) : undefined))
            .orderBy(requests.requestId).limit(limit);
    }
    /** One immutable upload reservation; only this canonical key can become send input. */
    async reserveUpload(requestId: string, extension: 'pdf' | 'docx'): Promise<ProfileSignatureRequest> {
        if (!/^sr_[a-f0-9]{64}$/.test(requestId) || !['pdf', 'docx'].includes(extension)) throw new Error('Invalid signature upload');
        const key = `documents/${this.scope.orgId}/profiles/${this.scope.businessProfileId}/originals/${requestId}.${extension}`;
        const rows = await this.db.update(requests).set({ documentKey: key, updatedAt: new Date() })
            .where(and(this.owned(requestId), eq(requests.status, 'DRAFT'), sql`(${requests.documentKey} IS NULL OR ${requests.documentKey} = ${key})`)).returning();
        if (!rows[0]) throw new SignatureRequestConflict('Upload is unavailable');
        return rows[0];
    }
    async claimSend(requestId: string, attemptId: string): Promise<{ claimed: boolean; request: ProfileSignatureRequest }> {
        if (!safe(attemptId) || attemptId.length < 16 || attemptId.length > 128) throw new Error('Invalid send attempt');
        const rows = await this.db.update(requests).set({ status: 'SENDING', attemptId, updatedAt: new Date() })
            .where(and(this.owned(requestId), eq(requests.status, 'DRAFT'), sql`${requests.documentKey} IS NOT NULL`)).returning();
        if (rows[0]) return { claimed: true, request: rows[0] };
        const request = await this.get(requestId);
        if (!request || !['SENDING', 'SENT'].includes(request.status)) throw new SignatureRequestConflict('Send is unavailable');
        return { claimed: false, request };
    }
    async completeSend(requestId: string, attemptId: string, providerRef: string): Promise<ProfileSignatureRequest> {
        if (providerRef !== `env_${requestId}`) throw new Error('Invalid signature provider reference');
        const rows = await this.db.update(requests).set({ status: 'SENT', providerRef, updatedAt: new Date() })
            .where(and(this.owned(requestId), eq(requests.status, 'SENDING'), eq(requests.attemptId, attemptId))).returning();
        if (rows[0]) return rows[0];
        const request = await this.get(requestId);
        if (request?.status === 'SENT' && request.attemptId === attemptId && request.providerRef === providerRef) return request;
        throw new SignatureRequestConflict('Send completion conflicts with the persisted attempt');
    }
    async claimCancel(requestId: string, attemptId: string): Promise<{ claimed: boolean; request: ProfileSignatureRequest }> {
        if (!safe(attemptId) || attemptId.length < 16 || attemptId.length > 128) throw new Error('Invalid cancellation attempt');
        const rows = await this.db.update(requests).set({ status: 'CANCELLING', attemptId, updatedAt: new Date() })
            .where(and(this.owned(requestId), eq(requests.status, 'SENT'))).returning();
        if (rows[0]) return { claimed: true, request: rows[0] };
        const draft = await this.db.update(requests).set({ status: 'CANCELLED', attemptId, updatedAt: new Date() })
            .where(and(this.owned(requestId), eq(requests.status, 'DRAFT'))).returning();
        if (draft[0]) return { claimed: false, request: draft[0] };
        const request = await this.get(requestId);
        if (!request || !['CANCELLING', 'CANCELLED'].includes(request.status)) throw new SignatureRequestConflict('Cancellation is unavailable');
        return { claimed: false, request };
    }
    async completeCancel(requestId: string, attemptId: string): Promise<ProfileSignatureRequest> {
        const rows = await this.db.update(requests).set({ status: 'CANCELLED', updatedAt: new Date() })
            .where(and(this.owned(requestId), eq(requests.status, 'CANCELLING'), eq(requests.attemptId, attemptId))).returning();
        if (rows[0]) return rows[0];
        const request = await this.get(requestId);
        if (request?.status === 'CANCELLED' && request.attemptId === attemptId) return request;
        throw new SignatureRequestConflict('Cancellation completion conflicts with the persisted attempt');
    }
}
