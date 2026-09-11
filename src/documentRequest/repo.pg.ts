import { createHash } from 'node:crypto';
import { and, eq, gt, isNotNull } from 'drizzle-orm';
import { getPg, getPgTx, type PgDb } from '../pg/client';
import { profileDocumentRequests as requests, profileDocumentRequestFiles as files, profileDocumentRequestAttachments as attachments } from '../pg/schema/documentRequests';
import { DocumentRequestInput, DocumentRequestFileInput, DocumentRequestVerifiedObject, DocumentRequestListFilter, DOCUMENT_REQUEST_FILE_TYPES } from './schema';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const safe = (value: string) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const revision = (value: number) => { if (!Number.isInteger(value) || value < 1 || value >= 2147483647) throw new Error('Current revision required'); };
export class DocumentRequestConflict extends Error {}
/** Source-only metadata/reservations. Caller supplies fresh authorized context.
 * No upload signing, ingestion, reminders or legacy import.
 */
export class ProfileDocumentRequestPgRepo {
    private readonly scope: Readonly<{orgId:string;businessProfileId:string;advisorUserId:string}>;
    constructor(orgId:string,businessProfileId:string,advisorUserId:string,private readonly injected?:PgDb) {
        if (![orgId,businessProfileId,advisorUserId].every(safe)) throw new Error('Document request scope required');
        this.scope=Object.freeze({orgId,businessProfileId,advisorUserId});
    }
    private get db() { return this.injected ?? getPg(); }
    private owned(requestId?:string) { return and(eq(requests.orgId,this.scope.orgId),eq(requests.businessProfileId,this.scope.businessProfileId),eq(requests.advisorUserId,this.scope.advisorUserId),requestId===undefined?undefined:eq(requests.requestId,requestId)); }
    async get(requestId:string):Promise<typeof requests.$inferSelect|null> { return (await this.db.select().from(requests).where(this.owned(requestId)).limit(1))[0] ?? null; }
    async create(input:DocumentRequestInput) {
        const payload=DocumentRequestInput.parse(input), requestId='dr_'+hash([...Object.values(this.scope),payload.clientRequestKey]), payloadFingerprint=hash(payload);
        await this.db.insert(requests).values({...payload,...this.scope,requestId,payloadFingerprint,updatedBy:this.scope.advisorUserId}).onConflictDoNothing();
        const current=await this.get(requestId);
        if (!current || current.payloadFingerprint!==payloadFingerprint) throw new DocumentRequestConflict('Request key conflicts');
        return current;
    }
    async list(limit=25,afterRequestId?:string,filter:DocumentRequestListFilter={}) {
        const where=DocumentRequestListFilter.parse(filter);
        if (!Number.isInteger(limit)||limit<1||limit>100||(afterRequestId!==undefined&&!/^dr_[a-f0-9]{64}$/.test(afterRequestId))) throw new Error('Invalid request page');
        return this.db.select().from(requests).where(and(this.owned(),afterRequestId?gt(requests.requestId,afterRequestId):undefined,where.docType?eq(requests.docType,where.docType):undefined,where.status?eq(requests.status,where.status):undefined)).orderBy(requests.requestId).limit(limit);
    }
    async cancel(requestId:string,expectedRevision:number) {
        revision(expectedRevision);
        const [row]=await this.db.update(requests).set({status:'CANCELLED',revision:expectedRevision+1,updatedBy:this.scope.advisorUserId,updatedAt:new Date()})
            .where(and(this.owned(requestId),eq(requests.status,'OPEN'),eq(requests.revision,expectedRevision))).returning();
        if (!row) throw new DocumentRequestConflict('Request changed; refresh');
        return row;
    }
    /** Replay returns the same reservation without incrementing revision. Closed parents always deny.
     * Declared hash/size are constraints for the future verifier, not proof of uploaded bytes.
     */
    async reserveFile(requestId:string,uploaderUserId:string,expectedRevision:number,input:DocumentRequestFileInput) {
        revision(expectedRevision);
        if (!safe(uploaderUserId)) throw new Error('Uploader required');
        const payload=DocumentRequestFileInput.parse(input), fileId='df_'+hash([requestId,uploaderUserId,payload.clientFileKey]), payloadFingerprint=hash(payload);
        return (this.injected ?? getPgTx()).transaction(async tx=>{
            const [parent]=await tx.select().from(requests).where(this.owned(requestId)).for('update');
            if (!parent || parent.status!=='OPEN') throw new DocumentRequestConflict('Request unavailable');
            const [existing]=await tx.select().from(files).where(and(eq(files.requestId,requestId),eq(files.fileId,fileId))).limit(1);
            if (existing) {
                if (existing.payloadFingerprint!==payloadFingerprint) throw new DocumentRequestConflict('File key conflicts');
                return existing;
            }
            if (parent.revision!==expectedRevision) throw new DocumentRequestConflict('Request changed; refresh');
            const extension=DOCUMENT_REQUEST_FILE_TYPES[payload.contentType];
            const fileKey=`doc-requests/${this.scope.orgId}/profiles/${this.scope.businessProfileId}/${requestId}/${fileId}.${extension}`;
            const [file]=await tx.insert(files).values({...payload,...this.scope,requestId,fileId,uploadedBy:uploaderUserId,payloadFingerprint,extension,fileKey}).returning();
            await tx.update(requests).set({revision:expectedRevision+1,updatedBy:uploaderUserId,updatedAt:new Date()}).where(this.owned(requestId));
            return file;
        });
    }
    async getFile(requestId:string,fileId:string):Promise<typeof files.$inferSelect|null> {
        const [row]=await this.db.select({file:files}).from(files).innerJoin(requests,eq(requests.requestId,files.requestId))
            .where(and(this.owned(requestId),eq(files.fileId,fileId))).limit(1);
        return row?.file ?? null;
    }
    /** Persist actual verifier evidence under the same parent revision. Caller must
     * freshly authorize the uploader; SQL cannot prove S3 bytes or bucket policy.
     * Reservations remain immutable. This does not fulfill or ingest the request.
     */
    async attachVerified(requestId:string,fileId:string,uploaderUserId:string,expectedRevision:number,input:DocumentRequestVerifiedObject) {
        revision(expectedRevision);
        if (!safe(uploaderUserId)) throw new Error('Uploader required');
        const proof=DocumentRequestVerifiedObject.parse(input);
        return (this.injected ?? getPgTx()).transaction(async tx=>{
            const [parent]=await tx.select().from(requests).where(this.owned(requestId)).for('update');
            if (!parent || parent.status!=='OPEN') throw new DocumentRequestConflict('Request unavailable');
            const [file]=await tx.select().from(files).where(and(eq(files.requestId,requestId),eq(files.fileId,fileId))).limit(1);
            if (!file || file.uploadedBy!==uploaderUserId || file.sha256!==proof.sha256 || file.sizeBytes!==proof.sizeBytes) throw new DocumentRequestConflict('Verified file differs from reservation');
            const [existing]=await tx.select().from(attachments).where(eq(attachments.fileId,fileId)).limit(1);
            if (existing) {
                if (existing.bucketName!==proof.bucketName || existing.versionId!==proof.versionId || existing.sha256!==proof.sha256 || existing.sizeBytes!==proof.sizeBytes || existing.attachedBy!==uploaderUserId) throw new DocumentRequestConflict('Attachment conflicts');
                return existing;
            }
            if (parent.revision!==expectedRevision) throw new DocumentRequestConflict('Request changed; verify again');
            const [attachment]=await tx.insert(attachments).values({...this.scope,...proof,requestId,fileId,fileKey:file.fileKey,attachedBy:uploaderUserId}).returning();
            await tx.update(requests).set({revision:expectedRevision+1,updatedBy:uploaderUserId,updatedAt:new Date()}).where(this.owned(requestId));
            return attachment;
        });
    }
    /** Metadata only; caller must freshly authorize download and use stored VersionId. */
    async getAttachment(requestId:string,fileId:string):Promise<typeof attachments.$inferSelect|null> {
        const [row]=await this.db.select({attachment:attachments}).from(attachments).innerJoin(requests,eq(requests.requestId,attachments.requestId))
            .where(and(this.owned(requestId),eq(attachments.fileId,fileId))).limit(1);
        return row?.attachment ?? null;
    }

    async listFiles(requestId:string,limit=25,afterFileId?:string,attachedOnly=false) {
        if (!Number.isInteger(limit)||limit<1||limit>100||(afterFileId!==undefined&&!/^df_[a-f0-9]{64}$/.test(afterFileId))) throw new Error('Invalid file page');
        return this.db.select({file:files,attachment:attachments}).from(files).innerJoin(requests,eq(requests.requestId,files.requestId))
            .leftJoin(attachments,eq(attachments.fileId,files.fileId))
            .where(and(this.owned(requestId),afterFileId?gt(files.fileId,afterFileId):undefined,attachedOnly?isNotNull(attachments.fileId):undefined)).orderBy(files.fileId).limit(limit);
    }
    /** GENERAL requires no statement/receipt ingestion. A verified attachment is
     * mandatory; financial kinds cannot be fulfilled through this transition.
     */
    async fulfillGeneral(requestId:string,actorUserId:string,expectedRevision:number) {
        revision(expectedRevision);if (!safe(actorUserId)) throw new Error('Actor required');
        return (this.injected??getPgTx()).transaction(async tx=>{
            const [parent]=await tx.select().from(requests).where(this.owned(requestId)).for('update');
            if (!parent||parent.docType!=='GENERAL') throw new DocumentRequestConflict('General request unavailable');
            if (parent.status==='FULFILLED') return parent;
            if (parent.status!=='OPEN'||parent.revision!==expectedRevision) throw new DocumentRequestConflict('Request changed; refresh');
            const [attached]=await tx.select({id:attachments.fileId}).from(attachments).where(eq(attachments.requestId,requestId)).limit(1);
            if (!attached) throw new DocumentRequestConflict('A verified attachment is required');
            const [done]=await tx.update(requests).set({status:'FULFILLED',revision:expectedRevision+1,updatedBy:actorUserId,updatedAt:new Date()}).where(this.owned(requestId)).returning();
            return done;
        });
    }

}

/** Client-side discovery within one explicit business profile. The API must freshly
 * authorize an active client member; no account-wide or cross-profile fallback.
 * Returned adviser identity is persisted metadata for selecting the request port,
 * never an adviser identity supplied by the HTTP body.
 */
export class ProfileDocumentRequestClientPgRepo {
    private readonly scope: Readonly<{orgId:string;businessProfileId:string}>;
    constructor(orgId:string,businessProfileId:string,private readonly injected?:PgDb) {
        if (![orgId,businessProfileId].every(safe)) throw new Error('Document request client scope required');
        this.scope=Object.freeze({orgId,businessProfileId});
    }
    private get db() { return this.injected ?? getPg(); }
    private owned(requestId?:string) { return and(eq(requests.orgId,this.scope.orgId),eq(requests.businessProfileId,this.scope.businessProfileId),requestId===undefined?undefined:eq(requests.requestId,requestId)); }
    async get(requestId:string):Promise<typeof requests.$inferSelect|null> {
        return (await this.db.select().from(requests).where(this.owned(requestId)).limit(1))[0] ?? null;
    }
    async list(limit=25,afterRequestId?:string,filter:DocumentRequestListFilter={}) {
        const where=DocumentRequestListFilter.parse(filter);
        if (!Number.isInteger(limit)||limit<1||limit>100||(afterRequestId!==undefined&&!/^dr_[a-f0-9]{64}$/.test(afterRequestId))) throw new Error('Invalid request page');
        return this.db.select().from(requests).where(and(this.owned(),afterRequestId?gt(requests.requestId,afterRequestId):undefined,where.docType?eq(requests.docType,where.docType):undefined,where.status?eq(requests.status,where.status):undefined)).orderBy(requests.requestId).limit(limit);
    }
}
