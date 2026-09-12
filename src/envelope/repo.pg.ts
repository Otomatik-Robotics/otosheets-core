import { and, asc, desc, eq, gte, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { makeSweepQueries } from './sweep.pg';
import { getPg, getPgTx, type PgDb } from '../pg/client';
import {
    envelopes, envelopeVersions, envelopeRecipients, envelopeFields,
    envelopeSignatures, envelopeEvents, envelopeArtifacts, envelopeComments,
    envelopeTemplates, envelopeTemplateRoles, envelopeTemplateFields,
} from '../pg/schema/envelopes';
import { hashChainEntry, verifyChain, type ChainEntryInput, type ChainVerdict, type ChainValue } from './chain';
import {
    tierForKind, isRefusedKind, canHoldFields, canSign, canReturnVerdict,
    type ArtifactKind, type EnvelopeDTO, type EnvelopeStatus, type FieldType,
    type RecipientRole, type ReviewVerdict,
} from './schema';

export interface AppendEventInput {
    type: string;
    actorType: 'owner' | 'recipient' | 'system';
    actorId?: string | null;
    actorLabel?: string | null;
    versionId?: string | null;
    recipientId?: string | null;
    detail?: Record<string, ChainValue> | null;
    ip?: string | null;
    userAgent?: string | null;
}

export interface CreateEnvelopeInput {
    envelopeId: string;
    orgId: string;
    businessProfileId?: string | null;
    createdBy: string;
    createdByLabel?: string | null;
    title: string;
    kind: string;
    versionId: string;
    bodyMarkdown?: string | null;
    s3Key?: string | null;
    sha256?: string | null;
    holdSignersForReview?: boolean;
    signatureMethod?: 'digital' | 'wet' | null;
    /** Named draft parties; an email may be supplied before sending. */
    recipients?: Omit<AddRecipientInput, 'envelopeId'>[];
    /**
     * What the questionnaire was answered with, and the two facts that shape
     * the wording rather than describe it. Kept on the envelope so a regenerate
     * can prefill, and so the chain can say which jurisdiction a contract was
     * drafted under: without them the answers exist only as a request body that
     * is thrown away after one model call.
     */
    answers?: Record<string, unknown> | null;
    jurisdiction?: string | null;
    effectiveDate?: string | null;
}

export interface AddRecipientInput {
    roleLabel?: string | null;
    signingCapacity?: 'principal' | 'witness' | null;
    recipientId: string;
    envelopeId: string;
    role: RecipientRole;
    email: string;
    name?: string | null;
    orderNo?: number;
    /** Which template role this person fills. Null on an ad hoc document. */
    roleKey?: string | null;
}

export interface DispatchInput {
    /** Server-only persisted request attempt. Required for request-owned recipients. */
    signatureRequest?: { requestId: string; attemptId: string; orgId: string; businessProfileId: string };
    recipientId: string;
    /**
     * Supply this ONLY when a new link is genuinely being issued. The stored
     * hash is the only copy of the credential that exists, so writing a new one
     * stops the link already sitting in somebody's inbox from resolving.
     * Omitting it keeps the credential the recipient already has, which is what
     * lets a caller record a message id, or re-mark a send, without silently
     * cancelling the link it is about.
     *
     * The expiry and the access code travel with the token: a new link gets its
     * own, and a call that is not issuing one leaves all of them alone.
     */
    tokenHash?: string | null;
    expiresAt?: string | null;
    sesMessageId?: string | null;
    accessCodeHash?: string | null;
    accessCodeSalt?: string | null;
    accessCodeParams?: Record<string, unknown> | null;
    accessCodeChannel?: string | null;
}

/**
 * The credential state a recipient held before a dispatch claimed them, so a
 * caller whose send was refused can put it back exactly as it was rather than
 * leaving a live link dead and nothing delivered in its place.
 */
export interface DispatchSnapshot {
    tokenHash: string | null;
    expiresAt: string | null;
    sesMessageId: string | null;
    accessCodeHash: string | null;
    accessCodeSalt: string | null;
    accessCodeParams: Record<string, unknown> | null;
    accessCodeChannel: string | null;
    status: string;
    dispatchedAt: string | null;
}

export interface AddFieldInput {
    fieldId: string;
    versionId: string;
    recipientId?: string | null;
    type: FieldType;
    label?: string | null;
    required?: boolean;
    page: number;
    x: number | string;
    y: number | string;
    w: number | string;
    h: number | string;
}

export interface CreateVersionInput {
    versionId: string;
    envelopeId: string;
    createdBy: string;
    bodyMarkdown?: string | null;
    s3Key?: string | null;
    sha256?: string | null;
    createdReason?: string;
}

export interface AddCommentInput {
    commentId: string;
    envelopeId: string;
    versionId: string;
    recipientId?: string | null;
    authorLabel: string;
    page?: number | null;
    x?: number | string | null;
    y?: number | string | null;
    anchorQuote?: string | null;
    body: string;
    proposedText?: string | null;
}

export interface CreateTemplateInput {
    signatureMethod?: 'digital' | 'wet' | null;
    templateId: string;
    orgId: string;
    businessProfileId?: string | null;
    createdBy: string;
    name: string;
    description?: string | null;
    kind: string;
    bodyMarkdown?: string | null;
    s3Key?: string | null;
    /**
     * What the template was drafted from. Creation-time only: updateTemplate
     * deliberately does not accept them, since the wording was drafted from
     * these answers and rewriting one without the other leaves them disagreeing.
     */
    answers?: Record<string, unknown> | null;
    jurisdiction?: string | null;
    effectiveDate?: string | null;
}

export interface TemplateRoleInput {
    signingCapacity?: 'principal' | 'witness' | null;
    templateRoleId: string;
    templateId: string;
    roleKey: string;
    label: string;
    signingRole: RecipientRole;
    orderNo?: number;
    required?: boolean;
}

export interface TemplateFieldInput {
    templateFieldId: string;
    templateId: string;
    roleKey: string;
    type: FieldType;
    label?: string | null;
    required?: boolean;
    page: number;
    x: number | string;
    y: number | string;
    w: number | string;
    h: number | string;
}

/** One person, and which slot on the template they are filling. */
export interface RoleAssignment {
    roleKey: string;
    recipientId: string;
    email: string;
    name?: string | null;
}

export interface CreateFromTemplateInput {
    prepareOnly?: boolean;
    envelopeId: string;
    versionId: string;
    templateId: string;
    orgId: string;
    createdBy: string;
    createdByLabel?: string | null;
    /** Overrides the template name for this one document. */
    title?: string;
    /**
     * Who fills each role. Every required role must be given somebody, because
     * a field with nobody to fill it is a document that can never complete.
     */
    roleAssignments?: RoleAssignment[];
}

export interface EnvelopeCursor { createdAt: string; envelopeId: string }

export interface ListEnvelopesParams {
    orgId: string;
    businessProfileId?: string;
    limit?: number;
    cursor?: EnvelopeCursor | null;
    status?: EnvelopeStatus;
    /** Matched against the title with ILIKE. Trimmed; blank is not a search. */
    search?: string | null;
}

export interface ListEnvelopesResult {
    items: EnvelopeDTO[];
    nextCursor: EnvelopeCursor | null;
}

export interface RecordSignatureInput {
    signatureId: string;
    versionId: string;
    recipientId: string;
    typedName?: string | null;
    signatureImageKey?: string | null;
    signedCopyKey?: string | null;
    signedCopySha256?: string | null;
    ip?: string | null;
    userAgent?: string | null;
}

export interface SealArtifactInput {
    artifactId: string;
    envelopeId: string;
    versionId?: string | null;
    kind: ArtifactKind;
    s3Key: string;
    sha256: string;
    byteSize: number;
}

/** How many times a losing chain writer retries for the next free position. */
const APPEND_ATTEMPTS = 5;

export class EnvelopePgRepo {
    constructor(private readonly injected?: PgDb, private readonly injectedTx?: PgDb,
        private readonly templateScope?: Readonly<{ orgId: string; businessProfileId: string }>) {}

    /** Scope reusable-template operations; document/recipient operations require their own authorization. */
    withTemplateScope(orgId: string, businessProfileId: string): EnvelopePgRepo {
        if (!orgId.trim() || !businessProfileId.trim()) throw new Error('Template scope is required');
        if (this.templateScope && (this.templateScope.orgId !== orgId || this.templateScope.businessProfileId !== businessProfileId)) throw new Error('Template scope mismatch');
        return new EnvelopePgRepo(this.injected, this.injectedTx, Object.freeze({ orgId, businessProfileId }));
    }
    private withinTemplate(...conditions: (SQL | undefined)[]) {
        return and(...conditions, ...(this.templateScope ? [eq(envelopeTemplates.orgId, this.templateScope.orgId), eq(envelopeTemplates.businessProfileId, this.templateScope.businessProfileId)] : []));
    }
    private ownedTemplate(templateId: SQL): SQL {
        return this.templateScope ? sql`EXISTS (SELECT 1 FROM envelope_templates owned_template
            WHERE owned_template.template_id = ${templateId} AND owned_template.org_id = ${this.templateScope.orgId}
            AND owned_template.business_profile_id = ${this.templateScope.businessProfileId})` : sql`true`;
    }
    private async assertTemplate(templateId: string) {
        if (this.templateScope && !await this.getTemplate(templateId)) throw new Error('No such template');
    }
    private get db(): PgDb { return this.injected ?? getPg(); }
    private get tx(): PgDb { return this.injectedTx ?? this.injected ?? getPgTx(); }

    // ── the chain ────────────────────────────────────────────────────────

    /**
     * Append one entry, atomically, at the next free position.
     *
     * Read-max-then-insert is not safe on its own: two concurrent appends read
     * the same max and both try to take it. The UNIQUE (envelope_id, seq) index
     * is what makes that a lost insert rather than a fork, and the loser simply
     * takes the next position. That constraint is the reason this is correct,
     * not the transaction on its own.
     *
     * The timestamp is taken here, from the server clock. It is never accepted
     * from a caller: the inherited implementation hashed a client-supplied
     * `timestamp` into the chain, so a signer could attest to any moment they
     * liked and the chain would agree with them.
     */
    async appendEvent(envelopeId: string, input: AppendEventInput, eventIdFor: (seq: number) => string): Promise<{ seq: number; hash: string }> {
        let lastError: unknown;

        for (let attempt = 0; attempt < APPEND_ATTEMPTS; attempt++) {
            try {
                return await (this.tx as any).transaction(async (tx: any) => {
                    const tail = await tx.select({ seq: envelopeEvents.seq, hash: envelopeEvents.hash })
                        .from(envelopeEvents)
                        .where(eq(envelopeEvents.envelopeId, envelopeId))
                        .orderBy(desc(envelopeEvents.seq))
                        .limit(1);

                    const seq = (tail[0]?.seq ?? 0) + 1;
                    const prevHash = tail[0]?.hash ?? null;
                    const createdAt = new Date().toISOString();

                    const entry: ChainEntryInput = {
                        envelopeId,
                        seq,
                        type: input.type,
                        actorType: input.actorType,
                        actorId: input.actorId ?? null,
                        actorLabel: input.actorLabel ?? null,
                        versionId: input.versionId ?? null,
                        recipientId: input.recipientId ?? null,
                        detail: input.detail ?? null,
                        ip: input.ip ?? null,
                        userAgent: input.userAgent ?? null,
                        createdAt,
                        prevHash,
                    };
                    const { canonical, hash } = hashChainEntry(entry);

                    await tx.insert(envelopeEvents).values({
                        eventId: eventIdFor(seq),
                        envelopeId,
                        seq,
                        type: entry.type,
                        actorType: entry.actorType,
                        actorId: entry.actorId,
                        actorLabel: entry.actorLabel,
                        versionId: entry.versionId,
                        recipientId: entry.recipientId,
                        detail: entry.detail as any,
                        ip: entry.ip,
                        userAgent: entry.userAgent,
                        canonical,
                        prevHash,
                        hash,
                        createdAt,
                    });

                    return { seq, hash };
                });
            } catch (err) {
                lastError = err;
                // A unique violation here means someone else took this position
                // while we were computing. Try again for the next one.
                if (!isUniqueViolation(err)) throw err;
            }
        }
        throw new Error(`Could not append to the chain for ${envelopeId} after ${APPEND_ATTEMPTS} attempts: ${String(lastError)}`);
    }

    /** Re-verify a whole chain from what is stored, not from anything rebuilt. */
    async verifyChainFor(envelopeId: string): Promise<ChainVerdict> {
        const rows = await this.db.select({
            seq: envelopeEvents.seq,
            canonical: envelopeEvents.canonical,
            prevHash: envelopeEvents.prevHash,
            hash: envelopeEvents.hash,
        }).from(envelopeEvents)
            .where(eq(envelopeEvents.envelopeId, envelopeId))
            .orderBy(asc(envelopeEvents.seq));

        return verifyChain(rows as any);
    }

    /**
     * The chain, oldest first, bounded.
     *
     * A document's chain grows for as long as anyone touches it, and every
     * refused access attempt is an entry, so an unbounded read here is a
     * payload that gets slower for exactly the documents that saw the most
     * activity. The default is generous because a chain is usually short and
     * the owner wants all of it; `fromSeq` walks the rest.
     */
    async listEvents(
        envelopeId: string,
        opts: { limit?: number; fromSeq?: number } = {},
    ): Promise<{ items: any[]; nextSeq: number | null }> {
        const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
        const rows = await this.db.select().from(envelopeEvents)
            .where(and(
                eq(envelopeEvents.envelopeId, envelopeId),
                opts.fromSeq ? gte(envelopeEvents.seq, opts.fromSeq) : undefined,
            ))
            .orderBy(asc(envelopeEvents.seq))
            .limit(limit + 1);

        const items = rows.slice(0, limit);
        const nextSeq = rows.length > limit ? Number((rows[limit] as any).seq) : null;
        return { items, nextSeq };
    }

    /**
     * Every signature on one version, voided ones included.
     *
     * A voided signature is kept and returned rather than hidden: the record
     * still has to say consent was given, and when it stopped applying.
     */
    async listSignatures(versionId: string) {
        return this.db.select().from(envelopeSignatures)
            .where(eq(envelopeSignatures.versionId, versionId))
            .orderBy(asc(envelopeSignatures.signedAt));
    }

    /**
     * Attach a rendered PDF to a version that was authored as markdown.
     *
     * Separate from createVersion, which only ever inserts and supersedes, so
     * rendering a draft cannot mint a version number and orphan the fields
     * placed against the one before it.
     *
     * Scoped by envelope for the same reason revokeRecipient is: the caller has
     * proved which document it owns, and a version id on its own is a string
     * they sent us. Refuses to overwrite a version that already has bytes,
     * because a rendered document that has been signed against must not change
     * underneath the signature.
     */
    async attachRendered(
        envelopeId: string,
        versionId: string,
        input: { s3Key: string; sha256: string },
    ): Promise<{ attached: boolean }> {
        const rows = await (this.db as any).update(envelopeVersions)
            .set({ s3Key: input.s3Key, sha256: input.sha256 })
            .where(and(
                eq(envelopeVersions.versionId, versionId),
                eq(envelopeVersions.envelopeId, envelopeId),
                sql`${envelopeVersions.s3Key} IS NULL`,
            ))
            .returning({ id: envelopeVersions.versionId });
        return { attached: rows.length > 0 };
    }

    // ── envelopes ────────────────────────────────────────────────────────

    /**
     * Create an envelope, its first version and the chain's first entry
     * together. The tier is derived from the kind here and is not a parameter,
     * so there is no call site that can set it.
     */
    async create(input: CreateEnvelopeInput): Promise<EnvelopeDTO> {
        if (isRefusedKind(input.kind)) {
            throw new Error(`Documents of kind "${input.kind}" are not handled here`);
        }
        const tier = tierForKind(input.kind);
        const now = new Date().toISOString();

        return await (this.tx as any).transaction(async (tx: any) => {
            const inserted = await tx.insert(envelopes).values({
                envelopeId: input.envelopeId,
                orgId: input.orgId,
                businessProfileId: input.businessProfileId ?? null,
                createdBy: input.createdBy,
                title: input.title,
                kind: input.kind,
                tier,
                status: 'draft',
                currentVersionNo: 1,
                signatureMethod: input.signatureMethod ?? null,
                holdSignersForReview: input.holdSignersForReview ?? true,
                answers: (input.answers ?? null) as any,
                jurisdiction: input.jurisdiction ?? null,
                effectiveDate: input.effectiveDate ?? null,
                createdAt: now,
                updatedAt: now,
            }).onConflictDoNothing({ target: envelopes.envelopeId }).returning({ id: envelopes.envelopeId });

            // INSERT's conflict wait and this row lock serialize competing creators.
            // Validate before child writes and return the locked snapshot, never an
            // unscoped post-transaction read of a potentially foreign winner.
            const [owned] = await tx.select().from(envelopes)
                .where(eq(envelopes.envelopeId, input.envelopeId)).for('update');
            if (!owned || owned.orgId !== input.orgId || (owned.businessProfileId ?? null) !== (input.businessProfileId ?? null)) {
                throw new Error('No such document');
            }
            if (inserted.length === 0) return owned as EnvelopeDTO;

            await tx.insert(envelopeVersions).values({
                versionId: input.versionId,
                envelopeId: input.envelopeId,
                versionNo: 1,
                bodyMarkdown: input.bodyMarkdown ?? null,
                s3Key: input.s3Key ?? null,
                sha256: input.sha256 ?? null,
                createdBy: input.createdBy,
                createdReason: 'original',
                createdAt: now,
            });

            for (const recipient of input.recipients ?? []) {
                await tx.insert(envelopeRecipients).values({ ...recipient, envelopeId: input.envelopeId,
                    status: 'pending', createdAt: now, updatedAt: now,
                });
            }
            const entry: ChainEntryInput = {
                envelopeId: input.envelopeId, seq: 1, type: 'created', actorType: 'owner',
                actorId: input.createdBy, actorLabel: input.createdByLabel ?? null,
                versionId: input.versionId, recipientId: null,
                detail: { kind: input.kind, tier, title: input.title },
                ip: null, userAgent: null, createdAt: now, prevHash: null,
            };
            const { canonical, hash } = hashChainEntry(entry);
            await tx.insert(envelopeEvents).values({ ...entry, eventId: `${input.envelopeId}:1`, canonical, hash })
                .onConflictDoNothing({ target: envelopeEvents.eventId });
            return owned as EnvelopeDTO;
        });
    }

    /** Edits are scoped and locked against send; old PDF bytes are never overwritten. */
    async saveDraft(input: {
        envelopeId: string; orgId: string; expectedVersionNo: number; versionId: string;
        createdBy: string; bodyMarkdown?: string;
        recipients?: Array<{ recipientId: string; name: string | null; email: string }>;
    }): Promise<{ versionNo: number; changed: boolean }> {
        return await (this.tx as any).transaction(async (tx: any) => {
            const [env] = await tx.select().from(envelopes).where(and(
                eq(envelopes.envelopeId, input.envelopeId), eq(envelopes.orgId, input.orgId),
            )).for('update');
            if (!env) throw new Error('No such document');
            if (env.status !== 'draft') throw new Error('This document has already been sent');
            const [replayed] = await tx.select().from(envelopeVersions)
                .where(and(eq(envelopeVersions.versionId, input.versionId), eq(envelopeVersions.envelopeId, input.envelopeId)));
            if (replayed) return { versionNo: replayed.versionNo, changed: false };
            if (env.currentVersionNo !== input.expectedVersionNo) throw new Error('The document changed. Reload before editing.');
            const [current] = await tx.select().from(envelopeVersions).where(and(
                eq(envelopeVersions.envelopeId, input.envelopeId), eq(envelopeVersions.versionNo, env.currentVersionNo),
            ));
            if (!current) throw new Error('No current document version');
            const people = await tx.select().from(envelopeRecipients)
                .where(eq(envelopeRecipients.envelopeId, input.envelopeId)).for('update');
            if (people.some((r: any) => r.dispatchedAt)) throw new Error('This document has already been sent');
            let changedNames = false;
            for (const patch of input.recipients ?? []) {
                const person = people.find((r: any) => r.recipientId === patch.recipientId);
                if (!person) throw new Error('No such recipient on this document');
                changedNames ||= !person.roleLabel && (person.name ?? '') !== (patch.name ?? '');
                await tx.update(envelopeRecipients).set({ name: patch.name, email: patch.email, updatedAt: new Date().toISOString() })
                    .where(and(eq(envelopeRecipients.recipientId, patch.recipientId), eq(envelopeRecipients.envelopeId, input.envelopeId)));
            }
            const changedBody = input.bodyMarkdown !== undefined && input.bodyMarkdown !== current.bodyMarkdown;
            if (changedBody && current.s3Key && !current.bodyMarkdown) throw new Error('Edit an uploaded document in its original file');
            if (!changedBody && !(changedNames && current.bodyMarkdown)) {
                return { versionNo: current.versionNo, changed: false };
            }
            const now = new Date().toISOString();
            const versionNo = current.versionNo + 1;
            await tx.update(envelopeVersions).set({ supersededAt: now }).where(eq(envelopeVersions.versionId, current.versionId));
            await tx.insert(envelopeVersions).values({ versionId: input.versionId, envelopeId: input.envelopeId,
                versionNo, bodyMarkdown: input.bodyMarkdown ?? current.bodyMarkdown,
                createdBy: input.createdBy, createdReason: 'draft_edited', createdAt: now,
            });
            await tx.update(envelopes).set({ currentVersionNo: versionNo, updatedAt: now }).where(eq(envelopes.envelopeId, input.envelopeId));
            return { versionNo, changed: true };
        });
    }

    /** Replace draft setup atomically. Every change advances the version, including on uploads.
     * A replay uses the same version id; a stale editor cannot replace newer roles. */
    async saveSetup(input: {
        envelopeId: string; orgId: string; expectedVersionNo: number; versionId: string; createdBy: string;
        signatureMethod: 'digital' | 'wet';
        recipients: Array<{ recipientId: string; name: string; email: string; role: RecipientRole;
            signingCapacity: 'principal' | 'witness' }>;
    }): Promise<{ versionNo: number; changed: boolean }> {
        if (!['digital', 'wet'].includes(input.signatureMethod)) throw new Error('Invalid signature method');
        if (!input.recipients.length || !input.recipients.some(r => r.role === 'signer') ||
            new Set(input.recipients.map(r => r.recipientId)).size !== input.recipients.length ||
            input.recipients.some(r => !r.name.trim() || !['signer', 'reviewer', 'viewer'].includes(r.role) ||
                !['principal', 'witness'].includes(r.signingCapacity) || (r.role !== 'signer' && r.signingCapacity === 'witness'))) {
            throw new Error('Invalid document roles');
        }
        return await (this.tx as any).transaction(async (tx: any) => {
            const [env] = await tx.select().from(envelopes).where(and(
                eq(envelopes.envelopeId, input.envelopeId), eq(envelopes.orgId, input.orgId),
            )).for('update');
            if (!env) throw new Error('No such document');
            if (env.status !== 'draft') throw new Error('This document has already been sent');
            const [replayed] = await tx.select().from(envelopeVersions).where(and(
                eq(envelopeVersions.versionId, input.versionId), eq(envelopeVersions.envelopeId, input.envelopeId)));
            if (replayed) return { versionNo: replayed.versionNo, changed: false };
            if (env.currentVersionNo !== input.expectedVersionNo) throw new Error('The document changed. Reload before editing.');
            const [current] = await tx.select().from(envelopeVersions).where(and(
                eq(envelopeVersions.envelopeId, input.envelopeId), eq(envelopeVersions.versionNo, env.currentVersionNo)));
            if (!current) throw new Error('No current document version');
            const people = await tx.select().from(envelopeRecipients)
                .where(eq(envelopeRecipients.envelopeId, input.envelopeId)).for('update');
            if (people.some((r: any) => r.dispatchedAt)) throw new Error('This document has already been sent');
            const unchanged = (env.signatureMethod ?? 'digital') === input.signatureMethod && people.length === input.recipients.length &&
                input.recipients.every((r, index) => people.some((p: any) => p.recipientId === r.recipientId &&
                    (p.roleLabel ?? p.name) === r.name && p.email === r.email && p.role === r.role && p.orderNo === index &&
                    (p.signingCapacity ?? 'principal') === r.signingCapacity));
            if (unchanged) return { versionNo: current.versionNo, changed: false };
            const now = new Date().toISOString();
            for (const person of people) {
                if (!input.recipients.some(r => r.recipientId === person.recipientId)) {
                    await tx.delete(envelopeFields).where(eq(envelopeFields.recipientId, person.recipientId));
                    await tx.delete(envelopeRecipients).where(and(eq(envelopeRecipients.envelopeId, input.envelopeId),
                        eq(envelopeRecipients.recipientId, person.recipientId)));
                }
            }
            for (const [orderNo, person] of input.recipients.entries()) {
                const previous = people.find((r: any) => r.recipientId === person.recipientId);
                if (previous) {
                    if (person.role !== 'signer') await tx.delete(envelopeFields).where(eq(envelopeFields.recipientId, person.recipientId));
                    await tx.update(envelopeRecipients).set({ roleLabel: person.name, email: person.email, role: person.role, signingCapacity: person.signingCapacity, orderNo, updatedAt: now }).where(and(
                        eq(envelopeRecipients.recipientId, person.recipientId), eq(envelopeRecipients.envelopeId, input.envelopeId)));
                } else {
                    await tx.insert(envelopeRecipients).values({ ...person, name: null, roleLabel: person.name, orderNo, envelopeId: input.envelopeId,
                        roleKey: person.recipientId, status: 'pending', createdAt: now, updatedAt: now });
                }
            }
            const versionNo = current.versionNo + 1;
            await tx.update(envelopeVersions).set({ supersededAt: now }).where(eq(envelopeVersions.versionId, current.versionId));
            await tx.insert(envelopeVersions).values({ versionId: input.versionId, envelopeId: input.envelopeId, versionNo,
                bodyMarkdown: current.bodyMarkdown, s3Key: current.bodyMarkdown ? null : current.s3Key,
                sha256: current.bodyMarkdown ? null : current.sha256, createdBy: input.createdBy,
                createdReason: 'signing_setup_changed', createdAt: now });
            if (!current.bodyMarkdown) {
                const fields = await tx.select().from(envelopeFields).where(eq(envelopeFields.versionId, current.versionId));
                for (const field of fields) await tx.insert(envelopeFields).values({ ...field,
                    fieldId: `${input.versionId}:${field.fieldId}`, versionId: input.versionId });
            }
            await tx.update(envelopes).set({ signatureMethod: input.signatureMethod, currentVersionNo: versionNo, updatedAt: now })
                .where(eq(envelopes.envelopeId, input.envelopeId));
            return { versionNo, changed: true };
        });
    }

    /** Claim only the reviewed version. Draft edits and a second Send cannot race it. */
    async beginDraftSend(envelopeId: string, orgId: string, versionNo: number, status: 'in_review' | 'out_for_signing'): Promise<boolean> {
        const rows = await (this.db as any).update(envelopes).set({ status, updatedAt: new Date().toISOString() })
            .where(and(eq(envelopes.envelopeId, envelopeId), eq(envelopes.orgId, orgId),
                eq(envelopes.status, 'draft'), eq(envelopes.currentVersionNo, versionNo),
                sql`NOT EXISTS (SELECT 1 FROM profile_signature_requests sr WHERE 'env_' || sr.request_id = ${envelopes.envelopeId})`))
            .returning({ id: envelopes.envelopeId });
        return rows.length > 0;
    }

    async listVersions(envelopeId: string) {
        return this.db.select().from(envelopeVersions)
            .where(eq(envelopeVersions.envelopeId, envelopeId))
            .orderBy(asc(envelopeVersions.versionNo));
    }

    /**
     * How many signers still owe a signature on this version.
     *
     * Computed in the database rather than by walking a recipients list the
     * caller loaded earlier. This is a READ, and a read is never enough to
     * decide completion on its own: see `completeOnce` for why.
     *
     * A revoked signer is not outstanding, and a voided signature does not
     * count as given.
     */
    async countOutstandingSigners(envelopeId: string, versionId: string): Promise<number> {
        const rows = await this.db.select({ n: sql<number>`count(*)::int` })
            .from(envelopeRecipients)
            .where(and(
                eq(envelopeRecipients.envelopeId, envelopeId),
                eq(envelopeRecipients.role, 'signer'),
                sql`${envelopeRecipients.revokedAt} IS NULL`,
                sql`NOT EXISTS (
                    SELECT 1 FROM envelope_signatures s
                     WHERE s.recipient_id = ${envelopeRecipients.recipientId}
                       AND s.version_id = ${versionId}
                       AND s.voided_at IS NULL
                )`,
            ));
        return Number((rows[0] as any)?.n ?? 0);
    }

    /**
     * Complete the document once, and only if nobody still owes a signature.
     *
     * The count and the status write are ONE statement on purpose. Counting and
     * then writing lets two final signers whose signature rows both commit
     * before either counts read the same zero and both conclude they were last,
     * so the document completes, and is emailed, twice. Nothing in the schema
     * stopped that: what happened to absorb it was the chain's unique index
     * refusing the second completed entry, which is an accident of a constraint
     * meant for something else and surfaces as a thrown error rather than a
     * quiet no-op.
     *
     * `status <> 'completed'` is the wall now, and the boolean says who won, so
     * the completion entry, the seal and the completion email happen once.
     * A caller that did not win still gets the outstanding count, because
     * losing the flip and still owing signatures are different answers.
     */
    async completeOnce(envelopeId: string, versionId: string): Promise<{ completed: boolean; outstanding: number }> {
        const now = new Date().toISOString();
        const rows = await (this.db as any).update(envelopes)
            .set({ status: 'completed', completedAt: now, updatedAt: now })
            .where(and(
                eq(envelopes.envelopeId, envelopeId),
                sql`${envelopes.status} <> 'completed'`,
                sql`NOT EXISTS (
                    SELECT 1 FROM envelope_recipients r
                     WHERE r.envelope_id = ${envelopes.envelopeId}
                       AND r.role = 'signer'
                       AND r.revoked_at IS NULL
                       AND NOT EXISTS (
                           SELECT 1 FROM envelope_signatures s
                            WHERE s.recipient_id = r.recipient_id
                              AND s.version_id = ${versionId}
                              AND s.voided_at IS NULL
                       )
                )`,
            ))
            .returning({ id: envelopes.envelopeId });

        if (rows.length > 0) return { completed: true, outstanding: 0 };
        return { completed: false, outstanding: await this.countOutstandingSigners(envelopeId, versionId) };
    }

    async get(envelopeId: string): Promise<EnvelopeDTO | null> {
        const r = await this.db.select().from(envelopes).where(eq(envelopes.envelopeId, envelopeId)).limit(1);
        return (r[0] as any) ?? null;
    }

    // ── recipients and signing ───────────────────────────────────────────

    async getRecipient(recipientId: string) {
        const r = await this.db.select().from(envelopeRecipients)
            .where(eq(envelopeRecipients.recipientId, recipientId)).limit(1);
        return (r[0] as any) ?? null;
    }

    /**
     * Resolve a presented token to its recipient, refusing anything expired or
     * revoked. Only the hash is ever compared, and the caller hashes the token
     * before it gets here so the raw value is never in a query.
     */
    async resolveByTokenHash(tokenHash: string, now = new Date().toISOString()) {
        const r = await this.db.select().from(envelopeRecipients)
            .where(and(
                eq(envelopeRecipients.tokenHash, tokenHash),
                sql`${envelopeRecipients.revokedAt} IS NULL`,
                sql`(${envelopeRecipients.expiresAt} IS NULL OR ${envelopeRecipients.expiresAt} > ${now})`,
            ))
            .limit(1);
        return (r[0] as any) ?? null;
    }

    /**
     * Record a signature. The unique index on (version_id, recipient_id) is the
     * idempotency wall: a replayed POST loses the insert and gets the prior row
     * back instead of appending a second chain entry and re-sending the email.
     * Returns whether this call was the one that actually signed.
     */
    /** Public signing revalidates the exact owned parent under the cancellation lock. */
    async recordScopedSignature(scope: { orgId: string; businessProfileId: string; envelopeId: string; s3Key: string | null; sha256: string | null }, input: RecordSignatureInput) {
        scope = { ...scope }; input = { ...input };
        if (!scope.orgId || !scope.businessProfileId || !scope.envelopeId) throw new Error('Signature scope is required');
        return (this.tx as any).transaction(async (tx: any) => {
            const [parent] = await tx.select().from(envelopes).where(and(eq(envelopes.envelopeId, scope.envelopeId),
                eq(envelopes.orgId, scope.orgId), eq(envelopes.businessProfileId, scope.businessProfileId))).for('update');
            if (!parent || !['out_for_signing','in_review','completed'].includes(parent.status)) throw new Error('Signature document is unavailable');
            const [version] = await tx.select().from(envelopeVersions).where(and(eq(envelopeVersions.versionId, input.versionId),
                eq(envelopeVersions.envelopeId, parent.envelopeId), eq(envelopeVersions.versionNo, parent.currentVersionNo))).for('update');
            const [recipient] = await tx.select().from(envelopeRecipients).where(and(eq(envelopeRecipients.recipientId, input.recipientId),
                eq(envelopeRecipients.envelopeId, parent.envelopeId))).for('update');
            if (!version || version.s3Key !== scope.s3Key || version.sha256 !== scope.sha256 || !recipient || recipient.revokedAt ||
                ['revoked','declined','bounced'].includes(recipient.status)) throw new Error('Signature document is unavailable');
            return new EnvelopePgRepo(tx, tx).recordSignature(input);
        });
    }

    async recordSignature(input: RecordSignatureInput): Promise<{ created: boolean; signatureId: string }> {
        const recipient = await this.getRecipient(input.recipientId);
        if (!recipient) throw new Error('Unknown recipient');
        if (!canSign(recipient.role as RecipientRole)) {
            throw new Error(`A ${recipient.role} cannot sign`);
        }

        const inserted = await (this.db as any).insert(envelopeSignatures).values({
            signatureId: input.signatureId,
            versionId: input.versionId,
            recipientId: input.recipientId,
            typedName: input.typedName ?? null,
            signatureImageKey: input.signatureImageKey ?? null,
            signedCopyKey: input.signedCopyKey ?? null,
            signedCopySha256: input.signedCopySha256 ?? null,
            signedAt: new Date().toISOString(),
            ip: input.ip ?? null,
            userAgent: input.userAgent ?? null,
        }).onConflictDoNothing({
            target: [envelopeSignatures.versionId, envelopeSignatures.recipientId],
        }).returning({ id: envelopeSignatures.signatureId });

        if (inserted.length > 0) return { created: true, signatureId: inserted[0].id };

        const existing = await this.db.select({ id: envelopeSignatures.signatureId })
            .from(envelopeSignatures)
            .where(and(
                eq(envelopeSignatures.versionId, input.versionId),
                eq(envelopeSignatures.recipientId, input.recipientId),
            )).limit(1);
        return { created: false, signatureId: (existing[0] as any).id };
    }

    /**
     * Void every signature collected against a version. Used when a reviewer's
     * proposed edit is accepted after someone has already signed: consent to v1
     * does not carry to v2, and the rows stay so the record can still say what
     * was agreed and when it stopped applying.
     */
    async voidSignaturesForVersion(versionId: string, reason: string): Promise<number> {
        const rows = await (this.db as any).update(envelopeSignatures)
            .set({ voidedAt: new Date().toISOString(), voidedReason: reason })
            .where(and(
                eq(envelopeSignatures.versionId, versionId),
                sql`${envelopeSignatures.voidedAt} IS NULL`,
            ))
            .returning({ id: envelopeSignatures.signatureId });
        return rows.length;
    }

    /**
     * Add a recipient. Idempotent on the id so a retried prepare does not create
     * the person twice. A reviewer is added the same way a signer is: the role
     * column, not a separate table, is what keeps one recipients list while the
     * two lifecycles stay distinct.
     */
    async addRecipient(input: AddRecipientInput): Promise<{ recipientId: string; created: boolean }> {
        const now = new Date().toISOString();
        const inserted = await (this.db as any).insert(envelopeRecipients).values({
            recipientId: input.recipientId,
            envelopeId: input.envelopeId,
            role: input.role,
            orderNo: input.orderNo ?? 0,
            name: input.name ?? null,
            email: input.email,
            roleKey: input.roleKey ?? null,
            roleLabel: input.roleLabel ?? null,
            signingCapacity: input.signingCapacity ?? null,
            status: 'pending',
            createdAt: now,
            updatedAt: now,
        }).onConflictDoNothing({ target: envelopeRecipients.recipientId })
            .returning({ id: envelopeRecipients.recipientId });

        return { recipientId: input.recipientId, created: inserted.length > 0 };
    }

    async listRecipients(envelopeId: string) {
        return this.db.select().from(envelopeRecipients)
            .where(eq(envelopeRecipients.envelopeId, envelopeId))
            .orderBy(asc(envelopeRecipients.orderNo));
    }

    /**
     * Claim the dispatch: attach the credential and mark the link as sent.
     *
     * This is the sent-marker, and it is written BEFORE the email leaves. Every
     * trigger that reaches it is at-least-once, so a send that SES accepts and
     * whose marker is then lost is a second link mailed to the same person by
     * the next attempt.
     *
     * The claim is refused for a revoked recipient, so a link the owner pulled
     * cannot be re-issued by a retry that was already in flight. The caller is
     * told whether it claimed, rather than being left to assume it did.
     *
     * Only the columns the caller actually supplies are written. Omitting
     * `tokenHash` keeps the credential the recipient already has: the stored
     * hash is the only copy of the link, so replacing it has to be an explicit
     * act, not what a caller gets for recording a message id after the send.
     * The message id itself only exists once SES has answered, which is why
     * recording it is a second call and not part of the claim.
     *
     * The previous credential comes back so a refused send can be put back
     * exactly as it was. Two dispatches racing the same recipient both read the
     * same previous state under READ COMMITTED; the loser's link is the one
     * that dies, which is the same outcome as sending twice in any order.
     */
    async markDispatched(input: DispatchInput): Promise<{ claimed: boolean; previous: DispatchSnapshot | null }> {
        input = { ...input, signatureRequest: input.signatureRequest ? { ...input.signatureRequest } : undefined };
        const now = new Date().toISOString();
        const authority = input.signatureRequest;
        return await (this.tx as any).transaction(async (tx: any) => {
            const before = await tx.select({
                tokenHash: envelopeRecipients.tokenHash,
                expiresAt: envelopeRecipients.expiresAt,
                sesMessageId: envelopeRecipients.sesMessageId,
                accessCodeHash: envelopeRecipients.accessCodeHash,
                accessCodeSalt: envelopeRecipients.accessCodeSalt,
                accessCodeParams: envelopeRecipients.accessCodeParams,
                accessCodeChannel: envelopeRecipients.accessCodeChannel,
                status: envelopeRecipients.status,
                dispatchedAt: envelopeRecipients.dispatchedAt,
            }).from(envelopeRecipients)
                .where(eq(envelopeRecipients.recipientId, input.recipientId))
                .limit(1);
            const previous = (before[0] as DispatchSnapshot | undefined) ?? null;

            const set: Record<string, unknown> = {
                updatedAt: now,
            };
            if (input.sesMessageId !== undefined) set.sesMessageId = input.sesMessageId ?? null;
            if (input.tokenHash) {
                set.status = 'dispatched'; set.dispatchedAt = now;
                set.tokenHash = input.tokenHash;
                set.expiresAt = input.expiresAt ?? null;
                set.accessCodeHash = input.accessCodeHash ?? null;
                set.accessCodeSalt = input.accessCodeSalt ?? null;
                set.accessCodeParams = (input.accessCodeParams ?? null) as any;
                set.accessCodeChannel = input.accessCodeChannel ?? null;
            }

            const rows = await tx.update(envelopeRecipients).set(set)
                .where(and(
                    eq(envelopeRecipients.recipientId, input.recipientId),
                    sql`${envelopeRecipients.revokedAt} IS NULL`,
                    sql`(NOT EXISTS (SELECT 1 FROM profile_signature_requests sr WHERE 'env_' || sr.request_id = ${envelopeRecipients.envelopeId})
                        OR EXISTS (SELECT 1 FROM profile_signature_requests sr JOIN envelopes e ON e.envelope_id = 'env_' || sr.request_id
                            WHERE e.envelope_id = ${envelopeRecipients.envelopeId} AND e.org_id = sr.org_id AND e.business_profile_id = sr.business_profile_id
                            AND sr.request_id = ${authority?.requestId ?? ''} AND sr.attempt_id = ${authority?.attemptId ?? ''}
                            AND sr.org_id = ${authority?.orgId ?? ''} AND sr.business_profile_id = ${authority?.businessProfileId ?? ''}
                            AND sr.status = 'SENDING' AND ${envelopeRecipients.recipientId} = 'rcp_' || sr.request_id
                            AND (${!input.tokenHash} OR (e.status = 'out_for_signing' AND e.current_version_no = 1
                                AND ${envelopeRecipients.status} = 'pending' AND ${envelopeRecipients.tokenHash} IS NULL))))`,
                ))
                .returning({ id: envelopeRecipients.recipientId });

            return { claimed: rows.length > 0, previous };
        });
    }

    /**
     * Undo a claim whose send was refused, so the attempt costs nothing.
     *
     * Restoring the previous credential is the point: without it a refused
     * resend leaves the recipient holding a token nobody was ever told, and the
     * link they already had stops working because its hash was overwritten.
     *
     * Guarded on the hash this caller wrote. If another dispatch has claimed
     * the recipient since, that one owns the live link and putting an older
     * credential back over it would break the email that did go out.
     */
    async rollbackDispatch(
        recipientId: string,
        claimedTokenHash: string | null,
        previous: DispatchSnapshot | null,
    ): Promise<{ restored: boolean }> {
        // A first send has nothing to restore TO, so the undo is to clear the
        // claim rather than to do nothing. Leaving it would mark a recipient
        // dispatched, holding a token nobody was ever told, for an email that
        // was refused, and the owner's screen would read "sent".
        const undo = previous ?? {
            tokenHash: null, expiresAt: null, sesMessageId: null,
            accessCodeHash: null, accessCodeSalt: null, accessCodeParams: null,
            accessCodeChannel: 'none', status: 'pending', dispatchedAt: null,
        } as unknown as DispatchSnapshot;

        const rows = await (this.db as any).update(envelopeRecipients).set({
            tokenHash: undo.tokenHash,
            expiresAt: undo.expiresAt,
            sesMessageId: undo.sesMessageId,
            accessCodeHash: undo.accessCodeHash,
            accessCodeSalt: undo.accessCodeSalt,
            accessCodeParams: undo.accessCodeParams as any,
            accessCodeChannel: undo.accessCodeChannel,
            status: undo.status,
            dispatchedAt: undo.dispatchedAt,
            updatedAt: new Date().toISOString(),
        }).where(and(
            eq(envelopeRecipients.recipientId, recipientId),
            claimedTokenHash
                ? eq(envelopeRecipients.tokenHash, claimedTokenHash)
                : sql`${envelopeRecipients.tokenHash} IS NULL`,
        )).returning({ id: envelopeRecipients.recipientId });
        return { restored: rows.length > 0 };
    }

    /** First open only. Re-opening is not a new fact worth another chain entry. */
    async markOpened(recipientId: string): Promise<{ firstOpen: boolean }> {
        const now = new Date().toISOString();
        const rows = await (this.db as any).update(envelopeRecipients)
            .set({ firstOpenedAt: now, status: 'opened', updatedAt: now })
            .where(and(
                eq(envelopeRecipients.recipientId, recipientId),
                sql`${envelopeRecipients.firstOpenedAt} IS NULL`,
            ))
            .returning({ id: envelopeRecipients.recipientId });
        return { firstOpen: rows.length > 0 };
    }

    /**
     * Correlate a bounce back to the recipient by the message id captured at
     * send. Returns the recipients it matched so the caller can write the chain
     * entry and stop reminding them.
     */
    async markBouncedByMessageId(sesMessageId: string, bounceType: string, reason: string) {
        const now = new Date().toISOString();
        return await (this.db as any).update(envelopeRecipients)
            .set({ status: 'bounced', bouncedAt: now, bounceType, bounceReason: reason, updatedAt: now })
            .where(and(
                eq(envelopeRecipients.sesMessageId, sesMessageId),
                sql`${envelopeRecipients.bouncedAt} IS NULL`,
            ))
            .returning({ recipientId: envelopeRecipients.recipientId, envelopeId: envelopeRecipients.envelopeId });
    }

    /** Only a reviewer returns a verdict, and only once. */
    async recordVerdict(recipientId: string, verdict: ReviewVerdict, note?: string | null): Promise<{ recorded: boolean }> {
        const recipient = await this.getRecipient(recipientId);
        if (!recipient) throw new Error('Unknown recipient');
        if (!canReturnVerdict(recipient.role as RecipientRole)) {
            throw new Error(`A ${recipient.role} cannot return a verdict`);
        }
        const now = new Date().toISOString();
        const rows = await (this.db as any).update(envelopeRecipients)
            .set({ verdict, verdictAt: now, verdictNote: note ?? null, status: 'reviewed', updatedAt: now })
            .where(and(
                eq(envelopeRecipients.recipientId, recipientId),
                sql`${envelopeRecipients.verdict} IS NULL`,
            ))
            .returning({ id: envelopeRecipients.recipientId });
        return { recorded: rows.length > 0 };
    }

    /**
     * Revoking is a column write, which is the whole reason the token is stored
     * rather than keyed.
     *
     * The envelope id is required and is part of the WHERE clause. Its callers
     * check the ENVELOPE against the acting org and then pass a child id
     * straight off the path, so scoping this by recipient id alone let one org
     * revoke another org's link by naming it. The parameter is deliberately not
     * optional: a default would put the hole back the first time somebody added
     * a call site and did not have an envelope id to hand.
     *
     * Returns whether it matched, so a caller can answer "no such recipient on
     * this document" rather than reporting a revocation that never happened.
     */
    async revokeRecipient(envelopeId: string, recipientId: string, reason: string): Promise<{ revoked: boolean }> {
        const now = new Date().toISOString();
        const rows = await (this.db as any).update(envelopeRecipients)
            .set({ revokedAt: now, revokedReason: reason, status: 'revoked', updatedAt: now })
            .where(and(
                eq(envelopeRecipients.recipientId, recipientId),
                eq(envelopeRecipients.envelopeId, envelopeId),
            ))
            .returning({ id: envelopeRecipients.recipientId });
        return { revoked: rows.length > 0 };
    }

    async setEnvelopeStatus(envelopeId: string, status: EnvelopeStatus): Promise<void> {
        await (this.db as any).update(envelopes)
            .set({ status, updatedAt: new Date().toISOString() })
            .where(eq(envelopes.envelopeId, envelopeId));
    }

    /**
     * Count a wrong access code and lock the link once there have been too many.
     * Incremented in the statement rather than read-modify-written, so parallel
     * guesses cannot each read the same low count.
     */
    async registerFailedCodeAttempt(recipientId: string, maxAttempts: number, lockedUntil: string): Promise<{ attempts: number; locked: boolean }> {
        const now = new Date().toISOString();
        // A lock that has already passed starts the count again at this
        // attempt. Without that, the counter carries over and the recipient is
        // for ever one wrong code from another full lockout, which is not the
        // window the lockout promised. Still one statement: every expression
        // reads the row as it was, so parallel guesses cannot share a count.
        const lockExpired = sql`(${envelopeRecipients.lockedUntil} IS NOT NULL AND ${envelopeRecipients.lockedUntil} < ${now})`;
        const nextAttempts = sql`CASE WHEN ${lockExpired} THEN 1 ELSE ${envelopeRecipients.failedAttempts} + 1 END`;
        const rows = await (this.db as any).update(envelopeRecipients)
            .set({
                failedAttempts: nextAttempts,
                lockedUntil: sql`CASE WHEN ${nextAttempts} >= ${maxAttempts} THEN ${lockedUntil} WHEN ${lockExpired} THEN NULL ELSE ${envelopeRecipients.lockedUntil} END`,
                updatedAt: now,
            })
            .where(eq(envelopeRecipients.recipientId, recipientId))
            .returning({ attempts: envelopeRecipients.failedAttempts, lockedUntil: envelopeRecipients.lockedUntil });
        const attempts = rows[0]?.attempts ?? 0;
        return { attempts, locked: attempts >= maxAttempts };
    }

    /** A correct code clears the counter so an honest typo does not accumulate for ever. */
    async clearFailedCodeAttempts(recipientId: string): Promise<void> {
        await (this.db as any).update(envelopeRecipients)
            .set({ failedAttempts: 0, lockedUntil: null, updatedAt: new Date().toISOString() })
            .where(eq(envelopeRecipients.recipientId, recipientId));
    }

    // ── fields ───────────────────────────────────────────────────────────

    /** Only a signer may hold a field. A reviewer holding one is how a reviewer ends up signing. */
    async assertFieldAssignable(recipientId: string): Promise<void> {
        const recipient = await this.getRecipient(recipientId);
        if (!recipient) throw new Error('Unknown recipient');
        if (!canHoldFields(recipient.role as RecipientRole)) {
            throw new Error(`A ${recipient.role} cannot be assigned a field`);
        }
    }

    async listFields(versionId: string) {
        return this.db.select().from(envelopeFields)
            .where(eq(envelopeFields.versionId, versionId))
            .orderBy(asc(envelopeFields.page));
    }

    /**
     * Place a field. Refuses a recipient who cannot hold one, so the rule lives
     * with the write rather than only in whatever screen happens to call it.
     */
    async addField(input: AddFieldInput): Promise<{ fieldId: string; created: boolean }> {
        return await (this.tx as any).transaction(async (tx: any) => {
            const [version] = await tx.select({ envelopeId: envelopeVersions.envelopeId }).from(envelopeVersions)
                .where(eq(envelopeVersions.versionId, input.versionId)).for('update');
            if (!version) throw new Error('No such document version');
            if (input.recipientId) {
                const [recipient] = await tx.select().from(envelopeRecipients).where(and(
                    eq(envelopeRecipients.recipientId, input.recipientId), eq(envelopeRecipients.envelopeId, version.envelopeId),
                )).for('update');
                if (!recipient) throw new Error('No such recipient on this document');
                if (!canHoldFields(recipient.role as RecipientRole)) throw new Error(`A ${recipient.role} cannot be assigned a field`);
            }
            const inserted = await tx.insert(envelopeFields).values({
                fieldId: input.fieldId,
                versionId: input.versionId,
                recipientId: input.recipientId ?? null,
                type: input.type,
                label: input.label ?? null,
                required: input.required ?? true,
                page: input.page,
                x: String(input.x), y: String(input.y), w: String(input.w), h: String(input.h),
                createdAt: new Date().toISOString(),
            }).onConflictDoNothing({ target: envelopeFields.fieldId })
                .returning({ id: envelopeFields.fieldId });
            return { fieldId: input.fieldId, created: inserted.length > 0 };
        });
    }

    /**
     * Remove a field, scoped to the document it is on.
     *
     * A field hangs off a version rather than an envelope, so the envelope id
     * has to be reached through `envelope_versions`. Deleting by field id alone
     * meant a handler that had checked the envelope against the acting org then
     * deleted whatever field id it was handed, including one belonging to
     * another org. Required, not optional, for the same reason as
     * `revokeRecipient`.
     */
    async removeField(envelopeId: string, fieldId: string): Promise<{ removed: boolean }> {
        const rows = await (this.db as any).delete(envelopeFields)
            .where(and(
                eq(envelopeFields.fieldId, fieldId),
                sql`${envelopeFields.versionId} IN (
                    SELECT version_id FROM envelope_versions WHERE envelope_id = ${envelopeId}
                )`,
            ))
            .returning({ id: envelopeFields.fieldId });
        return { removed: rows.length > 0 };
    }

    /** Only the current draft can move. Keep assignment, requirement and id intact. */
    async moveField(envelopeId: string, orgId: string, fieldId: string, rect: { x: number; y: number; w: number; h: number }): Promise<boolean> {
        return (this.tx as any).transaction(async (tx: any) => {
            const [env] = await tx.select().from(envelopes).where(and(eq(envelopes.envelopeId, envelopeId), eq(envelopes.orgId, orgId))).for('update');
            if (!env || env.status !== 'draft') return false;
            const rows = await tx.update(envelopeFields)
                .set({ x: String(rect.x), y: String(rect.y), w: String(rect.w), h: String(rect.h) })
                .where(and(eq(envelopeFields.fieldId, fieldId), sql`${envelopeFields.versionId} IN (
                    SELECT version_id FROM envelope_versions WHERE envelope_id = ${envelopeId} AND version_no = ${env.currentVersionNo}
                )`)).returning({ id: envelopeFields.fieldId });
            return rows.length > 0;
        });
    }

    /** Fill one field as part of signing. */
    async fillField(fieldId: string, value: string): Promise<void> {
        await (this.db as any).update(envelopeFields)
            .set({ value, filledAt: new Date().toISOString() })
            .where(eq(envelopeFields.fieldId, fieldId));
    }

    // ── versions ─────────────────────────────────────────────────────────

    /**
     * Supersede the current version with a new one. Used when a reviewer's
     * proposed edit is accepted: the caller voids the signatures on the old
     * version separately, because consent to v1 does not carry to v2.
     */
    async createVersion(input: CreateVersionInput): Promise<{ versionId: string; versionNo: number }> {
        return await (this.tx as any).transaction(async (tx: any) => {
            const latest = await tx.select({ n: envelopeVersions.versionNo })
                .from(envelopeVersions)
                .where(eq(envelopeVersions.envelopeId, input.envelopeId))
                .orderBy(desc(envelopeVersions.versionNo))
                .limit(1);
            const versionNo = (latest[0]?.n ?? 0) + 1;
            const now = new Date().toISOString();

            await tx.update(envelopeVersions)
                .set({ supersededAt: now })
                .where(and(
                    eq(envelopeVersions.envelopeId, input.envelopeId),
                    sql`${envelopeVersions.supersededAt} IS NULL`,
                ));

            await tx.insert(envelopeVersions).values({
                versionId: input.versionId,
                envelopeId: input.envelopeId,
                versionNo,
                bodyMarkdown: input.bodyMarkdown ?? null,
                s3Key: input.s3Key ?? null,
                sha256: input.sha256 ?? null,
                createdBy: input.createdBy,
                createdReason: input.createdReason ?? 'reviewer_edit_accepted',
                createdAt: now,
            });

            await tx.update(envelopes)
                .set({ currentVersionNo: versionNo, updatedAt: now })
                .where(eq(envelopes.envelopeId, input.envelopeId));

            return { versionId: input.versionId, versionNo };
        });
    }

    // ── comments ─────────────────────────────────────────────────────────

    async addComment(input: AddCommentInput): Promise<{ commentId: string; created: boolean }> {
        const inserted = await (this.db as any).insert(envelopeComments).values({
            commentId: input.commentId,
            envelopeId: input.envelopeId,
            versionId: input.versionId,
            recipientId: input.recipientId ?? null,
            authorLabel: input.authorLabel,
            page: input.page ?? null,
            x: input.x != null ? String(input.x) : null,
            y: input.y != null ? String(input.y) : null,
            anchorQuote: input.anchorQuote ?? null,
            body: input.body,
            proposedText: input.proposedText ?? null,
            createdAt: new Date().toISOString(),
        }).onConflictDoNothing({ target: envelopeComments.commentId })
            .returning({ id: envelopeComments.commentId });
        return { commentId: input.commentId, created: inserted.length > 0 };
    }

    async listComments(versionId: string) {
        return this.db.select().from(envelopeComments)
            .where(eq(envelopeComments.versionId, versionId))
            .orderBy(asc(envelopeComments.createdAt));
    }

    async resolveComment(commentId: string): Promise<void> {
        await (this.db as any).update(envelopeComments)
            .set({ resolvedAt: new Date().toISOString() })
            .where(and(
                eq(envelopeComments.commentId, commentId),
                sql`${envelopeComments.resolvedAt} IS NULL`,
            ));
    }

    // ── reusable documents ───────────────────────────────────────────────

    async createTemplate(input: CreateTemplateInput): Promise<{ templateId: string; created: boolean }> {
        if (this.templateScope) {
            if (input.orgId !== this.templateScope.orgId || (input.businessProfileId != null && input.businessProfileId !== this.templateScope.businessProfileId)) throw new Error('Template scope mismatch');
            input = { ...input, businessProfileId: this.templateScope.businessProfileId };
        }
        if (isRefusedKind(input.kind)) {
            throw new Error(`Documents of kind "${input.kind}" are not handled here`);
        }
        const now = new Date().toISOString();
        const inserted = await (this.db as any).insert(envelopeTemplates).values({
            templateId: input.templateId,
            orgId: input.orgId,
            businessProfileId: input.businessProfileId ?? null,
            createdBy: input.createdBy,
            name: input.name,
            description: input.description ?? null,
            signatureMethod: input.signatureMethod ?? null,
            kind: input.kind,
            bodyMarkdown: input.bodyMarkdown ?? null,
            s3Key: input.s3Key ?? null,
            answers: input.answers ?? null,
            jurisdiction: input.jurisdiction ?? null,
            effectiveDate: input.effectiveDate ?? null,
            createdAt: now,
            updatedAt: now,
        }).onConflictDoNothing({ target: envelopeTemplates.templateId })
            .returning({ id: envelopeTemplates.templateId });
        await this.assertTemplate(input.templateId);
        return { templateId: input.templateId, created: inserted.length > 0 };
    }

    async addTemplateRole(input: TemplateRoleInput): Promise<{ templateRoleId: string; created: boolean }> {
        await this.assertTemplate(input.templateId);
        const inserted = await (this.db as any).insert(envelopeTemplateRoles).values({
            templateRoleId: input.templateRoleId,
            templateId: input.templateId,
            roleKey: input.roleKey,
            label: input.label,
            signingRole: input.signingRole,
            signingCapacity: input.signingCapacity ?? null,
            orderNo: input.orderNo ?? 0,
            required: input.required ?? true,
            createdAt: new Date().toISOString(),
        }).onConflictDoNothing({ target: [envelopeTemplateRoles.templateId, envelopeTemplateRoles.roleKey] })
            .returning({ id: envelopeTemplateRoles.templateRoleId });
        return { templateRoleId: input.templateRoleId, created: inserted.length > 0 };
    }

    async listTemplateRoles(templateId: string) {
        return this.db.select().from(envelopeTemplateRoles)
            .where(and(eq(envelopeTemplateRoles.templateId, templateId), this.ownedTemplate(sql`${envelopeTemplateRoles.templateId}`)))
            .orderBy(asc(envelopeTemplateRoles.orderNo));
    }

    /**
     * Place a field on a template, against a role.
     *
     * The role must already exist: a field pointing at a role nobody defined
     * would silently never be filled, and the document would sit at "waiting on
     * someone" for ever with no one to wait for.
     */
    async addTemplateField(input: TemplateFieldInput): Promise<{ templateFieldId: string; created: boolean }> {
        const roles = await this.listTemplateRoles(input.templateId);
        const role = (roles as any[]).find((r) => r.roleKey === input.roleKey);
        if (!role) throw new Error(`This template has no role called "${input.roleKey}"`);
        if (!canHoldFields(role.signingRole as RecipientRole)) {
            throw new Error(`The ${role.label} role cannot be assigned a field`);
        }

        const inserted = await (this.db as any).insert(envelopeTemplateFields).values({
            templateFieldId: input.templateFieldId,
            templateId: input.templateId,
            roleKey: input.roleKey,
            type: input.type,
            label: input.label ?? null,
            required: input.required ?? true,
            page: input.page,
            x: String(input.x), y: String(input.y), w: String(input.w), h: String(input.h),
            createdAt: new Date().toISOString(),
        }).onConflictDoNothing({ target: envelopeTemplateFields.templateFieldId })
            .returning({ id: envelopeTemplateFields.templateFieldId });
        return { templateFieldId: input.templateFieldId, created: inserted.length > 0 };
    }

    /** Replace geometry in place so a move cannot leave duplicate signing boxes. */
    async moveTemplateField(templateId: string, fieldId: string, rect: { x: number; y: number; w: number; h: number }): Promise<boolean> {
        const rows = await this.db.update(envelopeTemplateFields)
            .set({ x: String(rect.x), y: String(rect.y), w: String(rect.w), h: String(rect.h) })
            .where(and(eq(envelopeTemplateFields.templateId, templateId), eq(envelopeTemplateFields.templateFieldId, fieldId), this.ownedTemplate(sql`${envelopeTemplateFields.templateId}`)))
            .returning({ id: envelopeTemplateFields.templateFieldId });
        return rows.length > 0;
    }

    /** Commit the PDF and its measured fields together. A stale render must not replace newer wording. */
    async prepareTemplate(input: {
        templateId: string; orgId: string; expectedUpdatedAt: string; s3Key: string;
        fields: TemplateFieldInput[];
    }): Promise<boolean> {
        return (this.tx as any).transaction(async (tx: any) => {
            const [template] = await tx.select().from(envelopeTemplates).where(this.withinTemplate(
                eq(envelopeTemplates.templateId, input.templateId), eq(envelopeTemplates.orgId, input.orgId),
            )).for('update');
            if (!template) throw new Error('No such template');
            if (template.s3Key) return false;
            if (template.updatedAt !== input.expectedUpdatedAt) throw new Error('Template changed during preparation. Try again.');
            const scoped = new EnvelopePgRepo(tx, tx, this.templateScope);
            await tx.delete(envelopeTemplateFields).where(eq(envelopeTemplateFields.templateId, input.templateId));
            for (const field of input.fields) {
                await scoped.addTemplateField({ ...field, templateId: input.templateId });
            }
            await tx.update(envelopeTemplates).set({ s3Key: input.s3Key, updatedAt: new Date().toISOString() })
                .where(this.withinTemplate(eq(envelopeTemplates.templateId, input.templateId)));
            return true;
        });
    }

    /** Role definitions belong to the template; recipient identities belong to each use. */
    async configureTemplate(templateId: string, orgId: string, roles: TemplateRoleInput[], signatureMethod: 'digital' | 'wet'): Promise<void> {
        return (this.tx as any).transaction(async (tx: any) => {
            const [template] = await tx.select().from(envelopeTemplates).where(this.withinTemplate(
                eq(envelopeTemplates.templateId, templateId), eq(envelopeTemplates.orgId, orgId),
            )).for('update');
            if (!template) throw new Error('No such template');
            const scoped = new EnvelopePgRepo(tx, tx, this.templateScope);
            const before = await scoped.listTemplateRoles(templateId);
            const shape = (rows: any[]) => JSON.stringify(rows.map(r => [r.roleKey, r.label, r.signingRole, r.signingCapacity || 'principal', r.orderNo || 0, r.required ?? true]));
            if (shape(before) === shape(roles) && (template.signatureMethod || 'digital') === signatureMethod) return;
            const layoutChanged = shape(before) !== shape(roles);
            // Generated pages contain the role labels. Changing roles requires new pages.
            if (layoutChanged && template.bodyMarkdown) {
                await tx.delete(envelopeTemplateFields).where(and(eq(envelopeTemplateFields.templateId, templateId), this.ownedTemplate(sql`${envelopeTemplateFields.templateId}`)));
            } else {
                const fieldRoles = roles.filter(r => canHoldFields(r.signingRole)).map(r => r.roleKey);
                const fields = await scoped.listTemplateFields(templateId);
                for (const field of fields) if (!fieldRoles.includes(field.roleKey)) await scoped.removeTemplateField(field.templateFieldId);
            }
            await tx.delete(envelopeTemplateRoles).where(and(eq(envelopeTemplateRoles.templateId, templateId), this.ownedTemplate(sql`${envelopeTemplateRoles.templateId}`)));
            for (const role of roles) await scoped.addTemplateRole({ ...role, templateId });
            await tx.update(envelopeTemplates).set({
                signatureMethod, updatedAt: new Date().toISOString(),
                ...(layoutChanged && template.bodyMarkdown ? { s3Key: null } : {}),
            }).where(this.withinTemplate(eq(envelopeTemplates.templateId, templateId)));
        });
    }

    async listTemplateFields(templateId: string) {
        return this.db.select().from(envelopeTemplateFields)
            .where(and(eq(envelopeTemplateFields.templateId, templateId), this.ownedTemplate(sql`${envelopeTemplateFields.templateId}`)))
            .orderBy(asc(envelopeTemplateFields.page));
    }

    async removeTemplateField(templateFieldId: string): Promise<void> {
        await (this.db as any).delete(envelopeTemplateFields)
            .where(and(eq(envelopeTemplateFields.templateFieldId, templateFieldId), this.ownedTemplate(sql`${envelopeTemplateFields.templateId}`)));
    }

    /**
     * A page of templates, newest first.
     *
     * It used to return every non-archived row. A template list is a table like
     * any other: it looks small on the day it is written and it is the whole
     * table by the time anyone notices, and the failure at the payload limit is
     * silent rather than loud.
     *
     * Keyset on (created_at, template_id), the same shape the envelope vault
     * uses, so the two lists behave identically and the cursor is stable when a
     * template is created while somebody is paging.
     */
    async listTemplates(
        orgId: string,
        opts: {
            includeArchived?: boolean; limit?: number;
            cursor?: { createdAt: string; templateId: string } | null;
            search?: string | null;
        } = {},
    ): Promise<{ items: any[]; nextCursor: { createdAt: string; templateId: string } | null }> {
        const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
        const clauses = [eq(envelopeTemplates.orgId, orgId)];
        if (!opts.includeArchived) clauses.push(sql`${envelopeTemplates.archivedAt} IS NULL`);

        // Matched in the DATABASE, not over the loaded page. With infinite
        // scroll only the rows somebody has scrolled to are in memory, so
        // filtering there searches whatever happens to have loaded and quietly
        // misses the rest. Same ILIKE shape the price book already uses.
        const q = opts.search?.trim();
        if (q) {
            const like = `%${q}%`;
            clauses.push(or(
                ilike(envelopeTemplates.name, like),
                ilike(envelopeTemplates.description, like),
            ) as any);
        }
        if (opts.cursor) {
            clauses.push(sql`(${envelopeTemplates.createdAt}, ${envelopeTemplates.templateId})
                              < (${opts.cursor.createdAt}, ${opts.cursor.templateId})`);
        }

        const rows = await this.db.select().from(envelopeTemplates)
            .where(this.withinTemplate(...clauses))
            .orderBy(desc(envelopeTemplates.createdAt), desc(envelopeTemplates.templateId))
            .limit(limit + 1);

        const items = rows.slice(0, limit) as any[];
        const last = items[items.length - 1];
        return {
            items,
            nextCursor: rows.length > limit && last
                ? { createdAt: last.createdAt, templateId: last.templateId }
                : null,
        };
    }

    /**
     * Who each of these documents is waiting on, for a page of the list.
     *
     * One query for the whole page rather than one per row. The list is what
     * somebody scans to answer "who has not signed", and a query per row turns
     * a twenty-row page into twenty-one round trips to answer it.
     *
     * Only the people still being waited on: a signer who has signed, a link
     * that was revoked and a bounce are all settled, and showing them as
     * outstanding is how the list stops being trusted.
     */
    async waitingOnFor(envelopeIds: string[]): Promise<Record<string, Array<{ name: string | null; email: string; role: string; status: string }>>> {
        if (envelopeIds.length === 0) return {};
        const rows = await this.db.select({
            envelopeId: envelopeRecipients.envelopeId,
            name: envelopeRecipients.name,
            email: envelopeRecipients.email,
            role: envelopeRecipients.role,
            status: envelopeRecipients.status,
        })
            .from(envelopeRecipients)
            .where(and(
                inArray(envelopeRecipients.envelopeId, envelopeIds),
                isNull(envelopeRecipients.revokedAt),
                sql`${envelopeRecipients.status} NOT IN ('signed','declined','bounced','reviewed')`,
            ))
            .orderBy(asc(envelopeRecipients.orderNo), asc(envelopeRecipients.email));

        const out: Record<string, any[]> = {};
        for (const r of rows as any[]) (out[r.envelopeId] ??= []).push({
            name: r.name, email: r.email, role: r.role, status: r.status,
        });
        return out;
    }

    /** How many roles and fields each template carries, for a page of the list. */
    async templateShapeFor(templateIds: string[]): Promise<Record<string, { roles: number; fields: number }>> {
        if (templateIds.length === 0) return {};
        const [roleRows, fieldRows] = await Promise.all([
            this.db.select({ id: envelopeTemplateRoles.templateId, n: sql<number>`count(*)::int` })
                .from(envelopeTemplateRoles)
                .where(and(inArray(envelopeTemplateRoles.templateId, templateIds), this.ownedTemplate(sql`${envelopeTemplateRoles.templateId}`)))
                .groupBy(envelopeTemplateRoles.templateId),
            this.db.select({ id: envelopeTemplateFields.templateId, n: sql<number>`count(*)::int` })
                .from(envelopeTemplateFields)
                .where(and(inArray(envelopeTemplateFields.templateId, templateIds), this.ownedTemplate(sql`${envelopeTemplateFields.templateId}`)))
                .groupBy(envelopeTemplateFields.templateId),
        ]);

        const out: Record<string, { roles: number; fields: number }> = {};
        for (const id of templateIds) out[id] = { roles: 0, fields: 0 };
        for (const r of roleRows as any[]) out[r.id].roles = Number(r.n);
        for (const r of fieldRows as any[]) out[r.id].fields = Number(r.n);
        return out;
    }

    async getTemplate(templateId: string) {
        const r = await this.db.select().from(envelopeTemplates)
            .where(this.withinTemplate(eq(envelopeTemplates.templateId, templateId))).limit(1);
        return (r[0] as any) ?? null;
    }

    /**
     * Save edited wording or naming. Only these three fields: `kind` is fixed at
     * creation because the tier follows from it, and letting it change after
     * fields are placed would silently re-tier a prepared template.
     */
    async updateTemplate(templateId: string, patch: { name?: string; bodyMarkdown?: string; description?: string }): Promise<void> {
        if (this.templateScope) patch = Object.fromEntries(Object.entries(patch).filter(([key]) => ['name', 'bodyMarkdown', 'description'].includes(key)));
        await (this.tx as any).transaction(async (tx: any) => {
            const [template] = await tx.select().from(envelopeTemplates).where(this.withinTemplate(eq(envelopeTemplates.templateId, templateId))).for('update');
            if (!template) throw new Error('No such template');
            const changed = (patch.bodyMarkdown !== undefined && patch.bodyMarkdown !== template.bodyMarkdown)
                || (patch.name !== undefined && patch.name !== template.name && !!template.bodyMarkdown);
            const set = { ...patch, updatedAt: new Date().toISOString(), ...(changed ? { s3Key: null } : {}) };
            if (changed) await tx.delete(envelopeTemplateFields).where(and(eq(envelopeTemplateFields.templateId, templateId), this.ownedTemplate(sql`${envelopeTemplateFields.templateId}`)));
            await tx.update(envelopeTemplates).set(set).where(this.withinTemplate(eq(envelopeTemplates.templateId, templateId)));
        });
    }

    /** Archived rather than deleted: a document already sent from it still names it. */
    async archiveTemplate(templateId: string): Promise<void> {
        await (this.db as any).update(envelopeTemplates)
            .set({ archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
            .where(this.withinTemplate(eq(envelopeTemplates.templateId, templateId)));
    }

    /**
     * Make a document from a template.
     *
     * The template's wording and kind are copied onto the new envelope rather
     * than referenced, so editing the template later cannot change a document
     * that has already gone out. That is a deliberate frozen copy: what someone
     * signed has to stay what it was.
     */
    async createFromTemplate(input: CreateFromTemplateInput): Promise<EnvelopeDTO> {
        if (this.templateScope && input.orgId !== this.templateScope.orgId) throw new Error('Template scope mismatch');
        return await (this.tx as any).transaction(async (tx: any) => {
            await tx.select().from(envelopeTemplates).where(this.withinTemplate(eq(envelopeTemplates.templateId, input.templateId),
                eq(envelopeTemplates.orgId, input.orgId))).for('update');
            const scoped = new EnvelopePgRepo(tx, tx, this.templateScope);
            await scoped.assertTemplate(input.templateId);
            const existing = await scoped.get(input.envelopeId);
            if (existing) {
                if (existing.orgId !== input.orgId || (this.templateScope && existing.businessProfileId !== this.templateScope.businessProfileId)) throw new Error('No such document');
                return existing;
            }
            return scoped.createFromTemplateInside(input);
        });
    }

    private async createFromTemplateInside(input: CreateFromTemplateInput): Promise<EnvelopeDTO> {
        const template = await this.getTemplate(input.templateId);
        if (!template || template.orgId !== input.orgId) throw new Error('No such template');

        const roles = (await this.listTemplateRoles(input.templateId)) as any[];
        const assignments: RoleAssignment[] = input.prepareOnly ? roles.map(r => ({ roleKey: r.roleKey, recipientId: `${input.envelopeId}:${r.roleKey}`, name: null, email: '' })) : input.roleAssignments ?? [];

        // A name that is not a role at all comes first, because it explains the
        // actual mistake. Reporting the roles left empty when the caller has
        // misspelled one sends them looking for the wrong problem.
        const unknown = assignments.filter((a) => !roles.some((r) => r.roleKey === a.roleKey));
        if (unknown.length > 0) {
            throw new Error(`This template has no role called "${unknown[0].roleKey}"`);
        }

        // Every required role needs somebody. A field with nobody to fill it is
        // a document that can never complete, and it would sit at "waiting on
        // someone" with no one to wait for.
        const missing = roles
            .filter((r) => r.required && !assignments.some((a) => a.roleKey === r.roleKey))
            .map((r) => r.label);
        if (missing.length > 0) {
            throw new Error(`Nobody was given these roles: ${missing.join(', ')}`);
        }

        const envelope = await this.create({
            envelopeId: input.envelopeId,
            orgId: input.orgId,
            businessProfileId: template.businessProfileId ?? null,
            createdBy: input.createdBy,
            createdByLabel: input.createdByLabel ?? null,
            title: input.title || template.name,
            kind: template.kind,
            signatureMethod: template.signatureMethod ?? 'digital',
            versionId: input.versionId,
            bodyMarkdown: template.bodyMarkdown ?? null,
            s3Key: template.s3Key ?? null,
            // Copied, like the wording: the document was drafted under these
            // answers and this jurisdiction, and it keeps them even if the
            // template is later replaced.
            answers: template.answers ?? null,
            jurisdiction: template.jurisdiction ?? null,
            effectiveDate: template.effectiveDate ?? null,
        });

        // Fill the roles with people, then re-point the template's fields at
        // whoever got each role. Copied rather than referenced, for the same
        // reason the wording is: editing the template later must not change a
        // document that has already gone out.
        const byRole = new Map<string, string>();
        for (const a of assignments) {
            const role = roles.find((r) => r.roleKey === a.roleKey);
            await this.addRecipient({
                recipientId: a.recipientId,
                envelopeId: input.envelopeId,
                role: role.signingRole as RecipientRole,
                roleLabel: role.label,
                signingCapacity: role.signingCapacity ?? 'principal',
                email: a.email,
                name: a.name ?? null,
                orderNo: role.orderNo ?? 0,
                roleKey: a.roleKey,
            });
            byRole.set(a.roleKey, a.recipientId);
        }

        const templateFields = (await this.listTemplateFields(input.templateId)) as any[];
        for (const f of templateFields) {
            const recipientId = byRole.get(f.roleKey);
            if (!recipientId) continue; // an optional role nobody filled
            await this.addField({
                fieldId: `${input.envelopeId}:${f.templateFieldId}`,
                versionId: input.versionId,
                recipientId,
                type: f.type,
                label: f.label,
                required: f.required,
                page: f.page,
                x: f.x, y: f.y, w: f.w, h: f.h,
            });
        }

        // Atomic increment, never read-modify-write: two people using the same
        // template at once should count as two.
        await (this.db as any).update(envelopeTemplates)
            .set({ timesUsed: sql`${envelopeTemplates.timesUsed} + 1`, updatedAt: new Date().toISOString() })
            .where(this.withinTemplate(eq(envelopeTemplates.templateId, input.templateId)));

        return envelope;
    }

    // ── the vault ────────────────────────────────────────────────────────

    /**
     * Keyset pagination, the house contract: `limit` in, an opaque `nextToken`
     * out. Never returns the whole table, whatever the caller asks for.
     */
    async listEnvelopes(params: ListEnvelopesParams): Promise<ListEnvelopesResult> {
        const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
        const clauses = [eq(envelopes.orgId, params.orgId)];
        if (params.businessProfileId !== undefined) clauses.push(eq(envelopes.businessProfileId, params.businessProfileId));
        if (params.status) clauses.push(eq(envelopes.status, params.status));

        // In the database, for the reason listTemplates says: filtering an
        // infinite-scrolled list on the client searches only what has loaded.
        const q = params.search?.trim();
        if (q) clauses.push(ilike(envelopes.title, `%${q}%`));

        if (params.cursor) {
            clauses.push(sql`(${envelopes.createdAt}, ${envelopes.envelopeId}) < (${params.cursor.createdAt}, ${params.cursor.envelopeId})`);
        }

        const rows = await this.db.select().from(envelopes)
            .where(and(...clauses))
            .orderBy(desc(envelopes.createdAt), desc(envelopes.envelopeId))
            .limit(limit + 1);

        const items = rows.slice(0, limit) as any[];
        const more = rows.length > limit;
        const last = items[items.length - 1];
        return {
            items,
            nextCursor: more && last ? { createdAt: last.createdAt, envelopeId: last.envelopeId } : null,
        };
    }

    /**
     * The vault's column counts, as one grouped query. Counting by reducing over
     * a loaded page works at a dozen documents and is silently wrong at sixty.
     */
    async countByStatus(orgId: string, businessProfileId?: string): Promise<Record<string, number>> {
        const rows = await this.db.select({ status: envelopes.status, n: sql<number>`count(*)::int` })
            .from(envelopes)
            .where(and(eq(envelopes.orgId, orgId), businessProfileId !== undefined ? eq(envelopes.businessProfileId, businessProfileId) : undefined))
            .groupBy(envelopes.status);
        const out: Record<string, number> = {};
        for (const r of rows as any[]) out[r.status] = Number(r.n);
        return out;
    }

    // ── artifacts ────────────────────────────────────────────────────────

    /**
     * Take the (envelope_id, kind) slot. The unique index means the first
     * writer wins and every later one is told so, rather than a second seal
     * quietly replacing the first. Chromium output is deterministic for a build
     * and not across builds, so a regenerated seal would not match the hash the
     * chain already attests to.
     *
     * The slot has to be claimed before the PDF exists, or two seals both
     * produce one. That leaves a window: a claim whose producer then threw, or
     * timed out, holds the slot with nothing behind it. Reporting that as
     * "already sealed" makes the failure permanent, because every retry is
     * refused and the document can never be sealed at all. So a claim with no
     * bytes behind it is takeable again, and the caller is told it resumed one
     * rather than started fresh.
     *
     * `sealed: true` means the caller owns the slot and MUST call
     * `finaliseArtifact` once the bytes are up. Until it does, the row holds
     * whatever placeholder key it was claimed with and the bytes cannot be
     * found again.
     */
    async sealOnce(input: SealArtifactInput): Promise<{ sealed: boolean; resumed?: boolean; existingS3Key?: string }> {
        const inserted = await (this.db as any).insert(envelopeArtifacts).values({
            artifactId: input.artifactId,
            envelopeId: input.envelopeId,
            versionId: input.versionId ?? null,
            kind: input.kind,
            s3Key: input.s3Key,
            sha256: input.sha256,
            byteSize: input.byteSize,
            createdAt: new Date().toISOString(),
        }).onConflictDoNothing({
            target: [envelopeArtifacts.envelopeId, envelopeArtifacts.kind],
        }).returning({ id: envelopeArtifacts.artifactId });

        if (inserted.length > 0) return { sealed: true };

        const existing = await this.db.select({ k: envelopeArtifacts.s3Key, n: envelopeArtifacts.byteSize })
            .from(envelopeArtifacts)
            .where(and(
                eq(envelopeArtifacts.envelopeId, input.envelopeId),
                eq(envelopeArtifacts.kind, input.kind),
            )).limit(1);

        if (Number((existing[0] as any)?.n ?? UNFINALISED_BYTE_SIZE) === UNFINALISED_BYTE_SIZE) {
            return { sealed: true, resumed: true };
        }
        return { sealed: false, existingS3Key: (existing[0] as any)?.k };
    }

    /**
     * Write the real bytes onto a claimed slot.
     *
     * Without this the artifact row keeps the placeholder key it was claimed
     * with, so a seal that succeeded end to end still leaves the sealed PDF
     * unfindable: nothing downstream can turn an envelope into the object it
     * was sealed to.
     *
     * An artifact that already has bytes is only rewritten when the hash is
     * identical, which makes a retried finalise a no-op instead of a second
     * seal replacing the first. A different hash means different bytes, and the
     * chain already attests to the first ones, so the write is refused and the
     * caller is told.
     */
    async finaliseArtifact(
        envelopeId: string,
        kind: ArtifactKind,
        bytes: { s3Key: string; sha256: string; byteSize: number },
    ): Promise<{ finalised: boolean }> {
        // A zero-byte artifact is indistinguishable from an unfinalised claim,
        // so accepting one here would seal the document to nothing and leave
        // the slot looking retryable for ever.
        if (!(bytes.byteSize > UNFINALISED_BYTE_SIZE)) {
            throw new Error('An artifact with no bytes is not an artifact');
        }
        const rows = await (this.db as any).update(envelopeArtifacts)
            .set({ s3Key: bytes.s3Key, sha256: bytes.sha256, byteSize: bytes.byteSize })
            .where(and(
                eq(envelopeArtifacts.envelopeId, envelopeId),
                eq(envelopeArtifacts.kind, kind),
                sql`(${envelopeArtifacts.byteSize} = ${UNFINALISED_BYTE_SIZE} OR ${envelopeArtifacts.sha256} = ${bytes.sha256})`,
            ))
            .returning({ id: envelopeArtifacts.artifactId });
        return { finalised: rows.length > 0 };
    }

    /**
     * The stored artifact for one kind, or null.
     *
     * An unfinalised claim is not returned by default. Its key is a
     * placeholder, so handing it out would give a caller a path to an object
     * that does not exist; only a caller reasoning about the seal itself wants
     * to see one.
     */
    async getArtifact(envelopeId: string, kind: ArtifactKind, opts: { includeUnfinalised?: boolean } = {}) {
        const clauses = [
            eq(envelopeArtifacts.envelopeId, envelopeId),
            eq(envelopeArtifacts.kind, kind),
        ];
        if (!opts.includeUnfinalised) clauses.push(sql`${envelopeArtifacts.byteSize} > ${UNFINALISED_BYTE_SIZE}`);
        const r = await this.db.select().from(envelopeArtifacts).where(and(...clauses)).limit(1);
        return (r[0] as any) ?? null;
    }

    /** Every artifact on a document: the original, the sealed copy, the certificate. */
    async listArtifacts(envelopeId: string, opts: { includeUnfinalised?: boolean } = {}) {
        const clauses = [eq(envelopeArtifacts.envelopeId, envelopeId)];
        if (!opts.includeUnfinalised) clauses.push(sql`${envelopeArtifacts.byteSize} > ${UNFINALISED_BYTE_SIZE}`);
        return this.db.select().from(envelopeArtifacts)
            .where(and(...clauses))
            .orderBy(asc(envelopeArtifacts.createdAt));
    }
    // ── The daily sweep's due-work queries ───────────────────────────────
    //
    // Delegated to sweep.pg.ts rather than written inline: these are the only
    // queries in this repo written for a cron rather than a request, and what
    // matters about them is different. A request reads the one document
    // somebody is looking at; these read across every document on the platform,
    // so each one has to be indexed, bounded and cursor-paged or it is a scan.

    listRecipientsPastExpiry(now: string, limit: number, cursor: any) {
        return makeSweepQueries(this.db).listRecipientsPastExpiry(now, limit, cursor);
    }

    expireOnce(envelopeId: string, now: string) {
        return makeSweepQueries(this.db).expireOnce(envelopeId, now);
    }

    listRecipientsDueReminder(dispatchedBefore: string, now: string, limit: number, cursor: any) {
        return makeSweepQueries(this.db)
            .listRecipientsDueReminder(dispatchedBefore, now, limit, cursor);
    }

    markRemindedOnce(recipientId: string, at: string) {
        return makeSweepQueries(this.db).markRemindedOnce(recipientId, at);
    }

    declineOnce(recipientId: string, reason: string, at: string) {
        return makeSweepQueries(this.db).declineOnce(recipientId, reason, at);
    }

}

/**
 * A claimed artifact slot with nothing behind it yet. The slot is taken before
 * the bytes exist so two seals cannot both produce them, so a row still holding
 * zero bytes means the producer never reached the upload. There is no separate
 * column for this: the byte count already says it, and an artifact of zero
 * bytes is not a thing that can legitimately exist.
 */
const UNFINALISED_BYTE_SIZE = 0;

/** Postgres reports a unique violation as SQLSTATE 23505, whichever driver is in front of it. */
function isUniqueViolation(err: unknown): boolean {
    const e = err as any;
    return e?.code === '23505'
        || e?.cause?.code === '23505'
        || /duplicate key value|unique constraint/i.test(String(e?.message ?? ''));
}
