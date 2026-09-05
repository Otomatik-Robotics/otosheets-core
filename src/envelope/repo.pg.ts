import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { getPg, getPgTx, type PgDb } from '../pg/client';
import {
    envelopes, envelopeVersions, envelopeRecipients, envelopeFields,
    envelopeSignatures, envelopeEvents, envelopeArtifacts,
} from '../pg/schema/envelopes';
import { hashChainEntry, verifyChain, type ChainEntryInput, type ChainVerdict, type ChainValue } from './chain';
import {
    tierForKind, isRefusedKind, canHoldFields, canSign,
    type ArtifactKind, type EnvelopeDTO, type RecipientRole,
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
}

export interface RecordSignatureInput {
    signatureId: string;
    versionId: string;
    recipientId: string;
    typedName?: string | null;
    signatureImageKey?: string | null;
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
    constructor(private readonly injected?: PgDb, private readonly injectedTx?: PgDb) {}
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

    async listEvents(envelopeId: string) {
        return this.db.select().from(envelopeEvents)
            .where(eq(envelopeEvents.envelopeId, envelopeId))
            .orderBy(asc(envelopeEvents.seq));
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

        await (this.tx as any).transaction(async (tx: any) => {
            await tx.insert(envelopes).values({
                envelopeId: input.envelopeId,
                orgId: input.orgId,
                businessProfileId: input.businessProfileId ?? null,
                createdBy: input.createdBy,
                title: input.title,
                kind: input.kind,
                tier,
                status: 'draft',
                currentVersionNo: 1,
                holdSignersForReview: input.holdSignersForReview ?? true,
                createdAt: now,
                updatedAt: now,
            }).onConflictDoNothing({ target: envelopes.envelopeId });

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
            }).onConflictDoNothing({ target: envelopeVersions.versionId });
        });

        await this.appendEvent(input.envelopeId, {
            type: 'created',
            actorType: 'owner',
            actorId: input.createdBy,
            actorLabel: input.createdByLabel ?? null,
            versionId: input.versionId,
            detail: { kind: input.kind, tier, title: input.title },
        }, (seq) => `${input.envelopeId}:${seq}`);

        const row = await this.get(input.envelopeId);
        if (!row) throw new Error('Envelope vanished immediately after creation');
        return row;
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

    // ── artifacts ────────────────────────────────────────────────────────

    /**
     * Store a sealed artifact. The unique index on (envelope_id, kind) means the
     * first writer wins and every later one is told so, rather than a second
     * seal quietly replacing the first. Chromium output is deterministic for a
     * build and not across builds, so a regenerated seal would not match the
     * hash the chain already attests to.
     */
    async sealOnce(input: SealArtifactInput): Promise<{ sealed: boolean; existingS3Key?: string }> {
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

        const existing = await this.db.select({ k: envelopeArtifacts.s3Key })
            .from(envelopeArtifacts)
            .where(and(
                eq(envelopeArtifacts.envelopeId, input.envelopeId),
                eq(envelopeArtifacts.kind, input.kind),
            )).limit(1);
        return { sealed: false, existingS3Key: (existing[0] as any)?.k };
    }
}

/** Postgres reports a unique violation as SQLSTATE 23505, whichever driver is in front of it. */
function isUniqueViolation(err: unknown): boolean {
    const e = err as any;
    return e?.code === '23505'
        || e?.cause?.code === '23505'
        || /duplicate key value|unique constraint/i.test(String(e?.message ?? ''));
}
