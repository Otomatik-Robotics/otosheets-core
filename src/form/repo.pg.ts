import { and, eq, desc, lt, or, sql, inArray } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { forms, formSubmissions } from '../pg/schema/forms';
import type { FormDef, FormStatus, FormSubmission } from './schema';

/**
 * Every form attribute `update` may set. Keyed by DTO name → Drizzle column;
 * anything not listed is ignored, so callers can't write unknown columns.
 * (`status` IS settable here — draft→live→archived is owner-driven with no
 * concurrent machinery competing for it, unlike ad-campaign launches.)
 */
const SETTABLE: Record<string, keyof typeof forms.$inferInsert> = {
    name: 'name',
    slug: 'slug',
    style: 'style',
    destination: 'destination',
    pipelineId: 'pipelineId',
    status: 'status',
    fields: 'fields',
    intro: 'intro',
    successMessage: 'successMessage',
    businessProfileId: 'businessProfileId',
};

function toDto(row: typeof forms.$inferSelect): FormDef {
    const dto: Record<string, unknown> = {
        formId: row.formId, orgId: row.orgId, createdBy: row.createdBy,
        name: row.name, slug: row.slug, style: row.style,
        destination: row.destination, status: row.status, fields: row.fields,
        createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
    if (row.businessProfileId != null) dto.businessProfileId = row.businessProfileId;
    if (row.pipelineId != null) dto.pipelineId = row.pipelineId;
    if (row.intro != null) dto.intro = row.intro;
    if (row.successMessage != null) dto.successMessage = row.successMessage;
    return dto as unknown as FormDef;
}

function toRow(f: FormDef): typeof forms.$inferInsert {
    return {
        formId: f.formId, orgId: f.orgId,
        businessProfileId: f.businessProfileId ?? null,
        createdBy: f.createdBy, name: f.name, slug: f.slug,
        style: f.style, destination: f.destination,
        pipelineId: f.pipelineId ?? null, status: f.status,
        fields: f.fields, intro: f.intro ?? null,
        successMessage: f.successMessage ?? null,
        createdAt: f.createdAt, updatedAt: f.updatedAt,
    };
}

function subToDto(row: typeof formSubmissions.$inferSelect): FormSubmission {
    const dto: Record<string, unknown> = {
        submissionId: row.submissionId, formId: row.formId, orgId: row.orgId,
        answers: row.answers, createdAt: row.createdAt,
    };
    if (row.attachments != null) dto.attachments = row.attachments;
    if (row.contact != null) dto.contact = row.contact;
    if (row.leadId != null) dto.leadId = row.leadId;
    if (row.pipelineId != null) dto.pipelineId = row.pipelineId;
    if (row.attribution != null) dto.attribution = row.attribution;
    return dto as unknown as FormSubmission;
}

export type FormCreateResult = 'created' | 'duplicate_id' | 'slug_taken';

const isUniqueViolation = (err: unknown): boolean =>
    Boolean(err && typeof err === 'object'
        && ((err as any).code === '23505' || (err as any).cause?.code === '23505'
            || /duplicate key|UNIQUE constraint/i.test(String((err as any).message ?? ''))));

/**
 * FormPgRepo — Postgres-only (no Dynamo mirror; see pg/schema/forms.ts).
 * Owns both the form definitions and their submissions.
 */
export class FormPgRepo {
    constructor(private injected?: PgDb) {}
    private get db(): PgDb { return this.injected ?? getPg(); }

    /**
     * Conditional create — formId is client-minted, so a POST retry is a no-op.
     * A (orgId, slug) collision surfaces as 'slug_taken' rather than a 500;
     * callers pre-check with getBySlug, this is the race backstop.
     */
    async createConditional(form: FormDef): Promise<FormCreateResult> {
        try {
            const rows = await this.db.insert(forms)
                .values(toRow(form))
                .onConflictDoNothing({ target: forms.formId })
                .returning({ formId: forms.formId });
            return rows.length > 0 ? 'created' : 'duplicate_id';
        } catch (err) {
            if (isUniqueViolation(err)) return 'slug_taken';
            throw err;
        }
    }

    async get(orgId: string, formId: string): Promise<FormDef | null> {
        const rows = await this.db.select().from(forms)
            .where(and(eq(forms.orgId, orgId), eq(forms.formId, formId)))
            .limit(1);
        return rows[0] ? toDto(rows[0]) : null;
    }

    async getBySlug(orgId: string, slug: string): Promise<FormDef | null> {
        const rows = await this.db.select().from(forms)
            .where(and(eq(forms.orgId, orgId), eq(forms.slug, slug)))
            .limit(1);
        return rows[0] ? toDto(rows[0]) : null;
    }

    /** Newest-first keyset pagination — same opaque lastEvaluatedKey contract as Dynamo lists. */
    async listByOrg(
        orgId: string,
        opts?: { limit?: number; exclusiveStartKey?: Record<string, any>; status?: FormStatus },
    ): Promise<{ items: FormDef[]; lastEvaluatedKey?: Record<string, any> }> {
        const limit = opts?.limit ?? 20;
        const conds: any[] = [eq(forms.orgId, orgId)];
        if (opts?.status) conds.push(eq(forms.status, opts.status));
        const k = opts?.exclusiveStartKey;
        if (k?.createdAt && k?.formId) {
            conds.push(or(
                lt(forms.createdAt, String(k.createdAt)),
                and(eq(forms.createdAt, String(k.createdAt)), lt(forms.formId, String(k.formId))),
            ));
        }
        const rows = await this.db.select().from(forms).where(and(...conds))
            .orderBy(desc(forms.createdAt), desc(forms.formId)).limit(limit);
        const last = rows[rows.length - 1];
        return {
            items: rows.map(toDto),
            lastEvaluatedKey: rows.length === limit && last
                ? { orgId, formId: last.formId, createdAt: last.createdAt }
                : undefined,
        };
    }

    /**
     * Patch fields through the SETTABLE allowlist. Returns false when the form
     * doesn't exist; throws 'slug_taken' via the same unique backstop as create.
     */
    async update(orgId: string, formId: string, updates: Record<string, any>): Promise<boolean> {
        const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
        for (const [k, v] of Object.entries(updates)) {
            const col = SETTABLE[k];
            if (col) patch[col] = v;
        }
        try {
            const rows = await this.db.update(forms)
                .set(patch as any)
                .where(and(eq(forms.orgId, orgId), eq(forms.formId, formId)))
                .returning({ formId: forms.formId });
            return rows.length > 0;
        } catch (err) {
            if (isUniqueViolation(err)) throw new Error('slug_taken');
            throw err;
        }
    }

    /** Hard delete — drafts only by convention (handlers archive live forms instead). */
    async delete(orgId: string, formId: string): Promise<boolean> {
        const rows = await this.db.delete(forms)
            .where(and(eq(forms.orgId, orgId), eq(forms.formId, formId)))
            .returning({ formId: forms.formId });
        return rows.length > 0;
    }

    // ── Submissions ───────────────────────────────────────────────────────

    /** Conditional create on the client-minted submissionId — a retried POST is a no-op. */
    async createSubmissionConditional(sub: FormSubmission): Promise<boolean> {
        const rows = await this.db.insert(formSubmissions)
            .values({
                submissionId: sub.submissionId, formId: sub.formId, orgId: sub.orgId,
                answers: sub.answers, attachments: sub.attachments ?? null,
                contact: sub.contact ?? null, leadId: sub.leadId ?? null,
                pipelineId: sub.pipelineId ?? null, attribution: sub.attribution ?? null,
                createdAt: sub.createdAt,
            })
            .onConflictDoNothing({ target: formSubmissions.submissionId })
            .returning({ submissionId: formSubmissions.submissionId });
        return rows.length > 0;
    }

    /** Back-link the lead minted for this submission (written after ingestLead). */
    async linkSubmissionLead(orgId: string, submissionId: string, leadId: string, pipelineId: string): Promise<void> {
        await this.db.update(formSubmissions)
            .set({ leadId, pipelineId })
            .where(and(eq(formSubmissions.orgId, orgId), eq(formSubmissions.submissionId, submissionId)));
    }

    async getSubmission(orgId: string, submissionId: string): Promise<FormSubmission | null> {
        const rows = await this.db.select().from(formSubmissions)
            .where(and(eq(formSubmissions.orgId, orgId), eq(formSubmissions.submissionId, submissionId)))
            .limit(1);
        return rows[0] ? subToDto(rows[0]) : null;
    }

    /** Newest-first keyset pagination over one form's submissions. */
    async listSubmissions(
        orgId: string,
        formId: string,
        opts?: { limit?: number; exclusiveStartKey?: Record<string, any> },
    ): Promise<{ items: FormSubmission[]; lastEvaluatedKey?: Record<string, any> }> {
        const limit = opts?.limit ?? 20;
        const conds: any[] = [eq(formSubmissions.orgId, orgId), eq(formSubmissions.formId, formId)];
        const k = opts?.exclusiveStartKey;
        if (k?.createdAt && k?.submissionId) {
            conds.push(or(
                lt(formSubmissions.createdAt, String(k.createdAt)),
                and(
                    eq(formSubmissions.createdAt, String(k.createdAt)),
                    lt(formSubmissions.submissionId, String(k.submissionId)),
                ),
            ));
        }
        const rows = await this.db.select().from(formSubmissions).where(and(...conds))
            .orderBy(desc(formSubmissions.createdAt), desc(formSubmissions.submissionId)).limit(limit);
        const last = rows[rows.length - 1];
        return {
            items: rows.map(subToDto),
            lastEvaluatedKey: rows.length === limit && last
                ? { orgId, formId, submissionId: last.submissionId, createdAt: last.createdAt }
                : undefined,
        };
    }

    /** Per-form submission counts for the org's form list + the Channels board. */
    async submissionCounts(orgId: string, formIds: string[]): Promise<Record<string, number>> {
        if (formIds.length === 0) return {};
        const rows = await this.db.select({
            formId: formSubmissions.formId,
            n: sql<number>`count(*)`,
        }).from(formSubmissions)
            .where(and(eq(formSubmissions.orgId, orgId), inArray(formSubmissions.formId, formIds)))
            .groupBy(formSubmissions.formId);
        const out: Record<string, number> = {};
        for (const r of rows) out[r.formId] = Number(r.n);
        return out;
    }
}
