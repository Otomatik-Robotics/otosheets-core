import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getPg, getPgTx, type PgDb } from '../pg/client';
import {
    profileDocumentRequests as requests,
    profileDocumentRequestFiles as files,
    profileDocumentRequestAttachments as attachments,
    profileDocumentRequestIngestions as ingestions,
} from '../pg/schema/documentRequests';
import { DocumentRequestConflict } from './repo.pg';
import { DOCUMENT_REQUEST_FILE_TYPES, DocumentRequestVerifiedObject } from './schema';

const identity = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const requestIdSchema = z.string().regex(/^dr_[a-f0-9]{64}$/);
const fileIdSchema = z.string().regex(/^df_[a-f0-9]{64}$/);
const revisionSchema = z.number().int().min(1).max(2147483646);
export const DocumentRequestIngestionInput = z.object({
    targetUserId: identity,
    financialYear: z.string().regex(/^\d{4}-\d{2}$/).refine(value =>
        Number(value.slice(5)) === (Number(value.slice(0, 4)) + 1) % 100,
    'Financial year must contain consecutive years').optional(),
}).strict();
export type DocumentRequestIngestionInput = z.input<typeof DocumentRequestIngestionInput>;

type SourceRows = { file: typeof files.$inferSelect; attachment: typeof attachments.$inferSelect };

/** Durable metadata admission only. It neither creates a statement/receipt nor
 * authorizes processing. Callers must freshly authorize the actor and explicit
 * target user in the selected client profile; never choose an implicit org owner.
 * Stored attachment evidence is not a fresh S3 byte or format verification.
 */
export class ProfileDocumentRequestIngestionPgRepo {
    private readonly scope: Readonly<{ orgId: string; businessProfileId: string; advisorUserId: string }>;

    constructor(orgId: string, businessProfileId: string, advisorUserId: string, private readonly injected?: PgDb) {
        [orgId, businessProfileId, advisorUserId].forEach(value => identity.parse(value));
        this.scope = Object.freeze({ orgId, businessProfileId, advisorUserId });
    }

    private owned(requestId: string) {
        return and(eq(requests.orgId, this.scope.orgId), eq(requests.businessProfileId, this.scope.businessProfileId),
            eq(requests.advisorUserId, this.scope.advisorUserId), eq(requests.requestId, requestId));
    }

    private source(rows: SourceRows, docType: string) {
        const { file, attachment } = rows;
        const type = file.contentType as keyof typeof DOCUMENT_REQUEST_FILE_TYPES;
        const extension = DOCUMENT_REQUEST_FILE_TYPES[type];
        const allowed = docType === 'BANK_STATEMENT' ? ['application/pdf', 'text/csv']
            : docType === 'EXPENSE_DOC' ? ['application/pdf', 'image/jpeg', 'image/png'] : [];
        const expectedKey = `doc-requests/${this.scope.orgId}/profiles/${this.scope.businessProfileId}/${file.requestId}/${file.fileId}.${extension}`;
        if (!allowed.includes(type) || !extension || file.extension !== extension || file.fileKey !== expectedKey ||
            attachment.fileKey !== file.fileKey || attachment.sha256 !== file.sha256 || attachment.sizeBytes !== file.sizeBytes ||
            attachment.attachedBy !== file.uploadedBy ||
            [file, attachment].some(row => row.orgId !== this.scope.orgId || row.businessProfileId !== this.scope.businessProfileId ||
                row.advisorUserId !== this.scope.advisorUserId || row.requestId !== file.requestId || row.fileId !== file.fileId)) {
            throw new DocumentRequestConflict('Financial source attachment is unavailable');
        }
        const proof = DocumentRequestVerifiedObject.parse({ bucketName: attachment.bucketName, versionId: attachment.versionId,
            sha256: attachment.sha256, sizeBytes: attachment.sizeBytes });
        return Object.freeze({ ...proof, fileKey: file.fileKey, fileName: file.fileName, contentType: type });
    }

    /** Same owned file and payload replays the same target without another write.
     * Changed target user/FY conflicts, and every closed-parent admission denies.
     * No caller-supplied target ID, bucket, key, version or processing status.
     */
    async reserve(requestId: string, fileId: string, actorUserId: string, expectedRevision: number, input: DocumentRequestIngestionInput) {
        requestIdSchema.parse(requestId); fileIdSchema.parse(fileId); identity.parse(actorUserId); revisionSchema.parse(expectedRevision);
        const payload = DocumentRequestIngestionInput.parse(input);
        return (this.injected ?? getPgTx()).transaction(async tx => {
            const [parent] = await tx.select().from(requests).where(this.owned(requestId)).for('update');
            if (!parent || parent.status !== 'OPEN' || !['BANK_STATEMENT', 'EXPENSE_DOC'].includes(parent.docType))
                throw new DocumentRequestConflict('Financial request is unavailable');
            if ((parent.docType === 'BANK_STATEMENT') !== (payload.financialYear !== undefined))
                throw new DocumentRequestConflict('Financial year does not match request type');
            const [rows] = await tx.select({ file: files, attachment: attachments }).from(attachments)
                .innerJoin(files, eq(files.fileId, attachments.fileId))
                .where(and(eq(attachments.fileId, fileId), eq(attachments.requestId, requestId))).limit(1);
            if (!rows) throw new DocumentRequestConflict('Verified source attachment required');
            const source = this.source(rows, parent.docType);
            const [existing] = await tx.select().from(ingestions).where(eq(ingestions.fileId, fileId)).limit(1);
            if (existing) {
                if (existing.targetUserId !== payload.targetUserId || existing.financialYear !== (payload.financialYear ?? null))
                    throw new DocumentRequestConflict('Financial ingestion target conflicts');
                return { admission: existing, source };
            }
            if (parent.revision !== expectedRevision) throw new DocumentRequestConflict('Request changed; verify again');
            const digest = createHash('sha256').update(JSON.stringify([
                this.scope.orgId, this.scope.businessProfileId, this.scope.advisorUserId, requestId, fileId, parent.docType,
            ])).digest('hex');
            const targetId = (parent.docType === 'BANK_STATEMENT' ? 'dsi_' : 'dri_') + digest;
            const [admission] = await tx.insert(ingestions).values({ ...this.scope, requestId, fileId, docType: parent.docType,
                targetId, targetUserId: payload.targetUserId, financialYear: payload.financialYear ?? null,
                admittedBy: actorUserId, admittedRevision: expectedRevision }).returning();
            await tx.update(requests).set({ revision: expectedRevision + 1, updatedBy: actorUserId, updatedAt: new Date() })
                .where(this.owned(requestId));
            return { admission, source };
        });
    }

    /** Exact owned metadata lookup, including closed parents, for audit/status.
     * This read is not a worker claim or permission to process the source.
     */
    async get(requestId: string, fileId: string) {
        requestIdSchema.parse(requestId); fileIdSchema.parse(fileId);
        const [row] = await (this.injected ?? getPg()).select({ admission: ingestions, file: files, attachment: attachments,
            parentStatus: requests.status, parentRevision: requests.revision }).from(ingestions)
            .innerJoin(requests, eq(requests.requestId, ingestions.requestId))
            .innerJoin(attachments, eq(attachments.fileId, ingestions.fileId))
            .innerJoin(files, eq(files.fileId, attachments.fileId))
            .where(and(this.owned(requestId), eq(ingestions.fileId, fileId))).limit(1);
        if (!row) return null;
        return { admission: row.admission, source: this.source(row, row.admission.docType),
            parentStatus: row.parentStatus, parentRevision: row.parentRevision };
    }
}
