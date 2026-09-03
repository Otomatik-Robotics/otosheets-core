import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import { FormPgRepo } from './repo.pg';
import { fieldWidth, sanitizeFormSlug, type FormDef, type FormSubmission } from './schema';

let db: PgDb;
let repo: FormPgRepo;
let pglite: PGlite;

const form = (over: Partial<FormDef> = {}): FormDef => ({
    formId: 'f1', orgId: 'org_1', createdBy: 'user_1',
    name: 'Quote request', slug: 'quote-request', style: 'scroll',
    destination: 'pipeline', pipelineId: null, status: 'live',
    fields: [
        { key: 'clientName', type: 'text', label: 'Full name', required: true, identity: 'name' },
        { key: 'clientPhone', type: 'tel', label: 'Phone', required: true, identity: 'phone' },
        { key: 'budget', type: 'currency', label: 'Budget' },
        { key: 'details', type: 'textarea', label: 'Project description' },
        { key: 'photos', type: 'attachment', label: 'Site photos' },
    ],
    createdAt: '2026-08-28T01:00:00.000Z', updatedAt: '2026-08-28T01:00:00.000Z',
    ...over,
});

const submission = (over: Partial<FormSubmission> = {}): FormSubmission => ({
    submissionId: 's1', formId: 'f1', orgId: 'org_1',
    answers: { clientName: 'Sarah Mitchell', clientPhone: '0412 345 678', budget: 18500 },
    contact: { name: 'Sarah Mitchell', phone: '0412 345 678' },
    createdAt: '2026-08-28T02:00:00.000Z',
    ...over,
});

beforeAll(async () => {
    pglite = new PGlite({ extensions: { pg_trgm } });
    const executor: SqlExecutor = { exec: async (s: string) => ({ rows: (await pglite.query(s)).rows as any[] }) };
    await runMigrations(executor);
    db = drizzle(pglite) as unknown as PgDb;
    await pglite.query("INSERT INTO orgs (org_id, name) VALUES ('org_1', 'Acme')");
    repo = new FormPgRepo(db);
});

describe('FormPgRepo', () => {
    it('createConditional is retry-safe and reports slug collisions', async () => {
        expect(await repo.createConditional(form())).toBe('created');
        expect(await repo.createConditional(form())).toBe('duplicate_id'); // POST retry
        expect(await repo.createConditional(form({ formId: 'f2' }))).toBe('slug_taken');
        const got = await repo.get('org_1', 'f1');
        expect(got?.name).toBe('Quote request');
        expect(got?.fields).toHaveLength(5);
    });

    it('getBySlug resolves the public URL segment', async () => {
        expect((await repo.getBySlug('org_1', 'quote-request'))?.formId).toBe('f1');
        expect(await repo.getBySlug('org_1', 'nope')).toBeNull();
        expect(await repo.getBySlug('org_2', 'quote-request')).toBeNull(); // org-scoped
    });

    it('update patches only allow-listed fields', async () => {
        expect(await repo.update('org_1', 'f1', {
            name: 'Quote request v2',
            formId: 'evil',           // not settable
            orgId: 'org_2',           // not settable
            style: 'deck',
        })).toBe(true);
        const got = await repo.get('org_1', 'f1');
        expect(got?.name).toBe('Quote request v2');
        expect(got?.style).toBe('deck');
        expect(got?.formId).toBe('f1');
        expect(got?.orgId).toBe('org_1');
    });

    it('submissions dedupe on the client-minted id and back-link the lead', async () => {
        expect(await repo.createSubmissionConditional(submission())).toBe(true);
        expect(await repo.createSubmissionConditional(submission())).toBe(false); // browser retry
        await repo.linkSubmissionLead('org_1', 's1', 'lead_1', 'pipe_1');
        const got = await repo.getSubmission('org_1', 's1');
        expect(got?.leadId).toBe('lead_1');
        expect(got?.answers.budget).toBe(18500);
        const counts = await repo.submissionCounts('org_1', ['f1', 'f9']);
        expect(counts).toEqual({ f1: 1 });
    });

    it('listSubmissions paginates newest-first with a keyset cursor', async () => {
        await repo.createSubmissionConditional(submission({
            submissionId: 's2', createdAt: '2026-08-28T03:00:00.000Z',
            answers: { clientName: 'Ben Ho' },
        }));
        const page1 = await repo.listSubmissions('org_1', 'f1', { limit: 1 });
        expect(page1.items[0].submissionId).toBe('s2');
        expect(page1.lastEvaluatedKey).toBeDefined();
        const page2 = await repo.listSubmissions('org_1', 'f1', { limit: 1, exclusiveStartKey: page1.lastEvaluatedKey });
        expect(page2.items[0].submissionId).toBe('s1');
    });

    it('delete removes a form and cascades its submissions', async () => {
        expect(await repo.createConditional(form({ formId: 'f3', slug: 'temp' }))).toBe('created');
        await repo.createSubmissionConditional(submission({ submissionId: 's3', formId: 'f3' }));
        expect(await repo.delete('org_1', 'f3')).toBe(true);
        expect(await repo.getSubmission('org_1', 's3')).toBeNull();
    });
});

describe('form layout helpers', () => {
    it('fieldWidth forces full width for textarea/attachment/embed/blocks', () => {
        expect(fieldWidth({ type: 'textarea' })).toBe('full');
        expect(fieldWidth({ type: 'attachment', width: 'half' })).toBe('full');
        expect(fieldWidth({ type: 'embed' })).toBe('full');
        expect(fieldWidth({ type: 'section' })).toBe('full');
        expect(fieldWidth({ type: 'text' })).toBe('half');
        expect(fieldWidth({ type: 'currency', width: 'full' })).toBe('full');
    });

    it('sanitizeFormSlug produces url-safe org-scoped slugs', () => {
        expect(sanitizeFormSlug('Quote Request!')).toBe('quote-request');
        expect(sanitizeFormSlug('--Warranty  Claim--')).toBe('warranty-claim');
    });
});
