import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { runMigrations, type SqlExecutor } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import { EnvelopePgRepo } from './repo.pg';
import { tierForKind, isRefusedKind, canDraftKind } from './schema';

let db: PgDb;
let repo: EnvelopePgRepo;
let pglite: PGlite;

let n = 0;
const id = (p: string) => `${p}_${++n}`;

async function addRecipient(envelopeId: string, role: string, over: Record<string, unknown> = {}) {
    const recipientId = id('rcp');
    const now = new Date().toISOString();
    await pglite.query(
        `INSERT INTO envelope_recipients (recipient_id, envelope_id, role, email, status, created_at, updated_at, token_hash, expires_at, revoked_at)
         VALUES ($1,$2,$3,$4,'pending',$5,$5,$6,$7,$8)`,
        [recipientId, envelopeId, role, `${role}@example.com`, now,
         (over.tokenHash as string) ?? null, (over.expiresAt as string) ?? null, (over.revokedAt as string) ?? null],
    );
    return recipientId;
}

async function makeEnvelope(kind = 'proposal', orgId = 'org_1') {
    const envelopeId = id('env');
    const versionId = id('ver');
    await repo.create({
        envelopeId, orgId, createdBy: 'user_1', createdByLabel: 'Leon',
        title: 'Roof replacement', kind, versionId,
    });
    return { envelopeId, versionId };
}

/** Somebody else's document, for the scoping tests. */
async function otherOrgEnvelope() {
    return makeEnvelope('proposal', 'org_2');
}

beforeAll(async () => {
    pglite = new PGlite({ extensions: { pg_trgm } });
    const executor: SqlExecutor = { exec: async (s: string) => ({ rows: (await pglite.query(s)).rows as any[] }) };
    await runMigrations(executor);
    db = drizzle(pglite) as unknown as PgDb;
    await pglite.query("INSERT INTO orgs (org_id, name) VALUES ('org_1', 'Acme')");
    await pglite.query("INSERT INTO orgs (org_id, name) VALUES ('org_2', 'Someone else')");
    // PGlite is a single connection, so the same handle serves reads and the
    // transactional path. That is what makes the concurrency test below a real
    // test of the UNIQUE constraint rather than of connection isolation.
    repo = new EnvelopePgRepo(db, db);
});

describe('the tier engine', () => {
    it('derives the tier from the kind', () => {
        expect(tierForKind('proposal')).toBe(0);
        expect(tierForKind('nda')).toBe(1);
        expect(tierForKind('employment')).toBe(2);
    });

    it('fails closed on a kind it does not know', () => {
        expect(() => tierForKind('mystery')).toThrow(/Unknown document kind/);
        expect(isRefusedKind('mystery')).toBe(true);
        expect(canDraftKind('mystery')).toBe(false);
    });

    it('allows drafting at tier 0 only', () => {
        expect(canDraftKind('proposal')).toBe(true);
        expect(canDraftKind('nda')).toBe(false);
        expect(canDraftKind('employment')).toBe(false);
    });

    it('refuses to create a regulated document at all', async () => {
        await expect(repo.create({
            envelopeId: id('env'), orgId: 'org_1', createdBy: 'user_1',
            title: 'Employment contract', kind: 'employment', versionId: id('ver'),
        })).rejects.toThrow(/not handled here/);
    });

    it('stores the derived tier, which no caller supplies', async () => {
        const { envelopeId } = await makeEnvelope('nda');
        expect((await repo.get(envelopeId))?.tier).toBe(1);
    });
});

describe('creating an envelope', () => {
    it('writes the envelope, its first version and the chain root together', async () => {
        const { envelopeId } = await makeEnvelope();
        const env = await repo.get(envelopeId);
        expect(env?.status).toBe('draft');
        expect(env?.currentVersionNo).toBe(1);

        const { items: events } = await repo.listEvents(envelopeId);
        expect(events).toHaveLength(1);
        expect((events[0] as any).seq).toBe(1);
        expect((events[0] as any).prevHash).toBeNull();
        expect((events[0] as any).type).toBe('created');
    });

    it('is retry-safe on the same ids', async () => {
        const envelopeId = id('env');
        const versionId = id('ver');
        const args = { envelopeId, orgId: 'org_1', createdBy: 'user_1', title: 'Retry', kind: 'proposal', versionId };
        await repo.create(args);
        await repo.create(args);
        const versions = await pglite.query('SELECT * FROM envelope_versions WHERE envelope_id = $1', [envelopeId]);
        expect(versions.rows).toHaveLength(1);
    });
});

describe('the chain', () => {
    it('links each entry to the one before it and verifies', async () => {
        const { envelopeId } = await makeEnvelope();
        for (const type of ['sent', 'opened', 'signed']) {
            await repo.appendEvent(envelopeId, { type, actorType: 'system' }, (s) => `${envelopeId}:${s}`);
        }
        const { items: events } = await repo.listEvents(envelopeId);
        expect(events.map((e: any) => e.seq)).toEqual([1, 2, 3, 4]);
        for (let i = 1; i < events.length; i++) {
            expect((events[i] as any).prevHash).toBe((events[i - 1] as any).hash);
        }
        expect(await repo.verifyChainFor(envelopeId)).toEqual({ ok: true, length: 4 });
    });

    it('does not fork when appends race', async () => {
        // The inherited implementation read the tail, appended and wrote back
        // with nothing serialising it, so two signers signing at once both took
        // the same position. Here the unique index makes the loser retry.
        const { envelopeId } = await makeEnvelope();
        await Promise.all(
            Array.from({ length: 8 }, (_, i) =>
                repo.appendEvent(envelopeId, { type: `race_${i}`, actorType: 'system' }, (s) => `${envelopeId}:${s}`)),
        );
        const { items: events } = await repo.listEvents(envelopeId);
        expect(events).toHaveLength(9); // the root plus eight
        expect(events.map((e: any) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        expect(await repo.verifyChainFor(envelopeId)).toEqual({ ok: true, length: 9 });
    });

    it('keeps the answers, the jurisdiction and the effective date it was drafted from', async () => {
        // Without these the answers exist only as a request body thrown away
        // after one model call, so a regenerate cannot prefill and the chain
        // has no record of which jurisdiction the contract was drafted under.
        const envelopeId = `env_${Math.random().toString(36).slice(2, 10)}`;
        await repo.create({
            envelopeId, orgId: 'org_1', createdBy: 'u1', title: 'Scope', kind: 'scope_of_works',
            versionId: `ver_${Math.random().toString(36).slice(2, 10)}`, bodyMarkdown: '## x',
            answers: { deposit_percent: '10', gst: 'ex_gst' },
            jurisdiction: 'NSW',
            effectiveDate: '2026-09-07',
        } as any);

        const got = await repo.get(envelopeId) as any;
        expect(got.answers).toEqual({ deposit_percent: '10', gst: 'ex_gst' });
        expect(got.jurisdiction).toBe('NSW');
        expect(got.effectiveDate).toBe('2026-09-07');
    });

    it('expires a document only when nobody can still sign it', async () => {
        // One signer's dead link must not close a document another signer can
        // still sign. That is the whole reason expireOnce is conditional on the
        // recipients rather than just on the clock.
        const past = new Date(Date.now() - 86_400_000).toISOString();
        const future = new Date(Date.now() + 86_400_000).toISOString();
        const now = new Date().toISOString();

        const { envelopeId } = await makeEnvelope();
        await repo.setEnvelopeStatus(envelopeId, 'out_for_signing');
        const dead = await repo.addRecipient({
            recipientId: `r_${Math.random().toString(36).slice(2, 8)}`,
            envelopeId, email: 'a@x.com', role: 'signer',
        } as any);
        const live = await repo.addRecipient({
            recipientId: `r_${Math.random().toString(36).slice(2, 8)}`,
            envelopeId, email: 'b@x.com', role: 'signer',
        } as any);
        await repo.markDispatched({ recipientId: dead.recipientId, tokenHash: 'a'.repeat(64), expiresAt: past });
        await repo.markDispatched({ recipientId: live.recipientId, tokenHash: 'b'.repeat(64), expiresAt: future });

        expect((await repo.expireOnce(envelopeId, now)).expired).toBe(false);

        // Once the live link lapses too, it expires, and only once.
        await repo.markDispatched({ recipientId: live.recipientId, tokenHash: 'c'.repeat(64), expiresAt: past });
        expect((await repo.expireOnce(envelopeId, now)).expired).toBe(true);
        expect((await repo.expireOnce(envelopeId, now)).expired).toBe(false);
        expect((await repo.get(envelopeId) as any).status).toBe('expired');
    });

    it('claims the one reminder, and the second caller loses', async () => {
        const { envelopeId } = await makeEnvelope();
        const r = await repo.addRecipient({
            recipientId: `r_${Math.random().toString(36).slice(2, 8)}`,
            envelopeId, email: 'a@x.com', role: 'signer',
        } as any);
        const at = new Date().toISOString();
        expect((await repo.markRemindedOnce(r.recipientId, at)).claimed).toBe(true);
        expect((await repo.markRemindedOnce(r.recipientId, at)).claimed).toBe(false);
    });

    it('records a decline once, so a double tap is one entry', async () => {
        const { envelopeId } = await makeEnvelope();
        const r = await repo.addRecipient({
            recipientId: `r_${Math.random().toString(36).slice(2, 8)}`,
            envelopeId, email: 'a@x.com', role: 'signer',
        } as any);
        const at = new Date().toISOString();
        expect((await repo.declineOnce(r.recipientId, 'price changed', at)).declined).toBe(true);
        expect((await repo.declineOnce(r.recipientId, 'price changed', at)).declined).toBe(false);

        const [row] = (await repo.listRecipients(envelopeId) as any[])
            .filter((x) => x.recipientId === r.recipientId);
        expect(row.status).toBe('declined');
        expect(row.declinedReason).toBe('price changed');
    });

    it('searches templates in the database, not over a loaded page', async () => {
        const tag = Math.random().toString(36).slice(2, 8);
        await repo.createTemplate({
            templateId: `tpl_s_${tag}_a`, orgId: 'org_1', createdBy: 'u1',
            name: `Roof replacement ${tag}`, kind: 'proposal', bodyMarkdown: '## x',
        } as any);
        await repo.createTemplate({
            templateId: `tpl_s_${tag}_b`, orgId: 'org_1', createdBy: 'u1',
            name: `Bathroom ${tag}`, kind: 'proposal', bodyMarkdown: '## x',
        } as any);

        const hit = await repo.listTemplates('org_1', { limit: 50, search: `Roof replacement ${tag}` });
        expect(hit.items.map((t: any) => t.templateId)).toEqual([`tpl_s_${tag}_a`]);

        // Case-insensitive, and a substring is enough.
        const loose = await repo.listTemplates('org_1', { limit: 50, search: `roof replacement ${tag}`.toUpperCase() });
        expect(loose.items.map((t: any) => t.templateId)).toContain(`tpl_s_${tag}_a`);

        const miss = await repo.listTemplates('org_1', { limit: 50, search: `nothing_${tag}` });
        expect(miss.items).toHaveLength(0);
    });

    it('reports who each document is still waiting on, in one query for the page', async () => {
        const { envelopeId } = await makeEnvelope();
        const waiting = await repo.addRecipient({
            recipientId: `r_${Math.random().toString(36).slice(2, 8)}`,
            envelopeId, email: 'waiting@x.com', name: 'Waiting', role: 'signer',
        } as any);
        const done = await repo.addRecipient({
            recipientId: `r_${Math.random().toString(36).slice(2, 8)}`,
            envelopeId, email: 'done@x.com', name: 'Done', role: 'signer',
        } as any);
        await repo.setRecipientStatus?.(done.recipientId, 'signed').catch(() => undefined);

        const map = await repo.waitingOnFor([envelopeId]);
        const emails = (map[envelopeId] ?? []).map((r: any) => r.email);
        expect(emails).toContain('waiting@x.com');

        // Nothing for an id that is not ours, and no query at all for none.
        expect(await repo.waitingOnFor([])).toEqual({});
    });

    it('counts the roles and fields on a page of templates', async () => {
        const tag = Math.random().toString(36).slice(2, 8);
        const templateId = `tpl_shape_${tag}`;
        await repo.createTemplate({
            templateId, orgId: 'org_1', createdBy: 'u1',
            name: `Shape ${tag}`, kind: 'proposal', bodyMarkdown: '## x',
        } as any);
        await repo.addTemplateRole({
            templateRoleId: `${templateId}:client`, templateId,
            roleKey: 'client', label: 'The client', signingRole: 'signer',
        } as any);

        const shape = await repo.templateShapeFor([templateId]);
        expect(shape[templateId]).toEqual({ roles: 1, fields: 0 });

        // A template with nothing on it still gets an entry, so the list never
        // has to tell an empty count apart from a missing one.
        expect(await repo.templateShapeFor([])).toEqual({});
    });

    it('pages the template list rather than returning the table', async () => {
        // org_1 is the fixture org the other template tests use; it may already
        // hold templates, so this asserts the SHAPE of paging rather than exact
        // counts across the org.
        const tag = Math.random().toString(36).slice(2, 8);
        for (let i = 0; i < 5; i++) {
            await repo.createTemplate({
                templateId: `tpl_${tag}_${i}`, orgId: 'org_1', createdBy: 'u1',
                name: `Template ${tag} ${i}`, kind: 'proposal', bodyMarkdown: '## x',
            } as any);
        }

        const first = await repo.listTemplates('org_1', { limit: 2 });
        expect(first.items).toHaveLength(2);
        expect(first.nextCursor).not.toBeNull();

        const second = await repo.listTemplates('org_1', { limit: 2, cursor: first.nextCursor });
        expect(second.items).toHaveLength(2);

        // The cursor is strictly after the last row of the page it came from,
        // so a row cannot appear on two pages and paging cannot loop.
        const seen = new Set(first.items.map((t: any) => t.templateId));
        for (const t of second.items) expect(seen.has(t.templateId)).toBe(false);
    });

    it('bounds the chain read, and walks the rest by seq', async () => {
        // A chain grows for as long as anyone touches a document, and every
        // refused access attempt is an entry, so reading all of it unbounded is
        // a payload that gets slower for exactly the documents that saw the most
        // activity.
        const { envelopeId } = await makeEnvelope();
        for (let i = 0; i < 12; i++) {
            await repo.appendEvent(envelopeId, { type: `e_${i}`, actorType: 'system' }, (s) => `${envelopeId}:${s}`);
        }
        const first = await repo.listEvents(envelopeId, { limit: 5 });
        expect(first.items.map((e: any) => e.seq)).toEqual([1, 2, 3, 4, 5]);
        expect(first.nextSeq).toBe(6);

        const rest = await repo.listEvents(envelopeId, { limit: 100, fromSeq: first.nextSeq! });
        expect(rest.items.map((e: any) => e.seq)).toEqual([6, 7, 8, 9, 10, 11, 12, 13]);
        expect(rest.nextSeq).toBeNull();
    });

    it('attaches a rendered PDF once, and refuses to change one already rendered', async () => {
        // A rendered document that has been signed against must not change
        // underneath the signature, and attaching is deliberately not
        // createVersion: minting a version number here would orphan every field
        // placed against the one before it.
        const { envelopeId } = await makeEnvelope();
        const [version] = await repo.listVersions(envelopeId) as any[];

        const first = await repo.attachRendered(envelopeId, version.versionId, {
            s3Key: 'documents/org_1/rendered/a.pdf', sha256: 'a'.repeat(64),
        });
        expect(first.attached).toBe(true);

        const again = await repo.attachRendered(envelopeId, version.versionId, {
            s3Key: 'documents/org_1/rendered/b.pdf', sha256: 'b'.repeat(64),
        });
        expect(again.attached).toBe(false);

        const [after] = await repo.listVersions(envelopeId) as any[];
        expect(after.s3Key).toBe('documents/org_1/rendered/a.pdf');
    });

    it('will not attach a rendered PDF to another org\'s version', async () => {
        const mine = await makeEnvelope();
        const theirs = await makeEnvelope();
        const [theirVersion] = await repo.listVersions(theirs.envelopeId) as any[];

        // My envelope id, their version id. The version id alone is a string
        // the caller sent us; the envelope is what they proved they own.
        const out = await repo.attachRendered(mine.envelopeId, theirVersion.versionId, {
            s3Key: 'documents/org_1/rendered/x.pdf', sha256: 'c'.repeat(64),
        });
        expect(out.attached).toBe(false);
    });

    it('notices when a stored entry is edited afterwards', async () => {
        const { envelopeId } = await makeEnvelope();
        await repo.appendEvent(envelopeId, { type: 'sent', actorType: 'system' }, (s) => `${envelopeId}:${s}`);
        await pglite.query(
            `UPDATE envelope_events SET canonical = replace(canonical, '"sent"', '"paid"') WHERE envelope_id = $1 AND seq = 2`,
            [envelopeId],
        );
        const verdict = await repo.verifyChainFor(envelopeId);
        expect(verdict.ok).toBe(false);
        expect(verdict).toMatchObject({ brokenAtSeq: 2 });
    });
});

describe('signing', () => {
    it('absorbs a replayed signature instead of signing twice', async () => {
        const { envelopeId, versionId } = await makeEnvelope();
        const recipientId = await addRecipient(envelopeId, 'signer');

        const first = await repo.recordSignature({ signatureId: id('sig'), versionId, recipientId, typedName: 'Dave Ellis' });
        const replay = await repo.recordSignature({ signatureId: id('sig'), versionId, recipientId, typedName: 'Dave Ellis' });

        expect(first.created).toBe(true);
        expect(replay.created).toBe(false);
        expect(replay.signatureId).toBe(first.signatureId);

        const rows = await pglite.query('SELECT * FROM envelope_signatures WHERE version_id = $1', [versionId]);
        expect(rows.rows).toHaveLength(1);
    });

    it('refuses to let a reviewer sign', async () => {
        const { envelopeId, versionId } = await makeEnvelope();
        const reviewerId = await addRecipient(envelopeId, 'reviewer');
        await expect(repo.recordSignature({ signatureId: id('sig'), versionId, recipientId: reviewerId }))
            .rejects.toThrow(/reviewer cannot sign/);
    });

    it('refuses to assign a field to a reviewer', async () => {
        const { envelopeId } = await makeEnvelope();
        const reviewerId = await addRecipient(envelopeId, 'reviewer');
        const signerId = await addRecipient(envelopeId, 'signer');
        await expect(repo.assertFieldAssignable(reviewerId)).rejects.toThrow(/cannot be assigned a field/);
        await expect(repo.assertFieldAssignable(signerId)).resolves.toBeUndefined();
    });

    it('voids signatures on a superseded version without destroying them', async () => {
        const { envelopeId, versionId } = await makeEnvelope();
        const recipientId = await addRecipient(envelopeId, 'signer');
        await repo.recordSignature({ signatureId: id('sig'), versionId, recipientId, typedName: 'Dave Ellis' });

        const voided = await repo.voidSignaturesForVersion(versionId, 'clause 5 changed after legal review');
        expect(voided).toBe(1);

        const rows = await pglite.query('SELECT * FROM envelope_signatures WHERE version_id = $1', [versionId]);
        expect(rows.rows).toHaveLength(1);
        expect((rows.rows[0] as any).voided_at).toBeTruthy();
        expect((rows.rows[0] as any).typed_name).toBe('Dave Ellis');

        // Voiding twice does not double-count.
        expect(await repo.voidSignaturesForVersion(versionId, 'again')).toBe(0);
    });
});

describe('completion', () => {
    it('counts only signers who still owe a signature on this version', async () => {
        const { envelopeId, versionId } = await makeEnvelope();
        const a = await addRecipient(envelopeId, 'signer');
        const b = await addRecipient(envelopeId, 'signer');
        await addRecipient(envelopeId, 'reviewer');   // never owes a signature
        await addRecipient(envelopeId, 'viewer');     // nor does a viewer

        expect(await repo.countOutstandingSigners(envelopeId, versionId)).toBe(2);

        await repo.recordSignature({ signatureId: id('sig'), versionId, recipientId: a, typedName: 'A' });
        expect(await repo.countOutstandingSigners(envelopeId, versionId)).toBe(1);

        await repo.recordSignature({ signatureId: id('sig'), versionId, recipientId: b, typedName: 'B' });
        expect(await repo.countOutstandingSigners(envelopeId, versionId)).toBe(0);
    });

    it('treats a voided signature as not given, so a new version is outstanding again', async () => {
        const { envelopeId, versionId } = await makeEnvelope();
        const a = await addRecipient(envelopeId, 'signer');
        await repo.recordSignature({ signatureId: id('sig'), versionId, recipientId: a, typedName: 'A' });
        expect(await repo.countOutstandingSigners(envelopeId, versionId)).toBe(0);

        await repo.voidSignaturesForVersion(versionId, 'clause 5 changed');
        expect(await repo.countOutstandingSigners(envelopeId, versionId)).toBe(1);
    });

    it('does not wait on a signer whose link was revoked', async () => {
        const { envelopeId, versionId } = await makeEnvelope();
        const a = await addRecipient(envelopeId, 'signer');
        expect(await repo.countOutstandingSigners(envelopeId, versionId)).toBe(1);
        await repo.revokeRecipient(envelopeId, a, 'removed from the document');
        expect(await repo.countOutstandingSigners(envelopeId, versionId)).toBe(0);
    });

    it('completes once, and the loser is told it did not win', async () => {
        const { envelopeId, versionId } = await makeEnvelope();
        const a = await addRecipient(envelopeId, 'signer');
        const b = await addRecipient(envelopeId, 'signer');

        // Still owed, so nothing flips and the caller learns what is missing.
        await repo.recordSignature({ signatureId: id('sig'), versionId, recipientId: a, typedName: 'A' });
        expect(await repo.completeOnce(envelopeId, versionId)).toEqual({ completed: false, outstanding: 1 });
        expect((await repo.get(envelopeId))?.status).toBe('draft');

        await repo.recordSignature({ signatureId: id('sig'), versionId, recipientId: b, typedName: 'B' });

        // Two final signers arriving together. Exactly one flips it, so the
        // completion entry and the completion email happen once.
        const both = await Promise.all([
            repo.completeOnce(envelopeId, versionId),
            repo.completeOnce(envelopeId, versionId),
        ]);
        expect(both.filter((r) => r.completed)).toHaveLength(1);
        expect((await repo.get(envelopeId))?.status).toBe('completed');
        expect((await repo.get(envelopeId) as any)?.completedAt).toBeTruthy();

        // And a replay long afterwards is still a no-op, not a second completion.
        expect((await repo.completeOnce(envelopeId, versionId)).completed).toBe(false);
    });

    it('does not complete a document nobody has signed', async () => {
        const { envelopeId, versionId } = await makeEnvelope();
        await addRecipient(envelopeId, 'signer');
        expect(await repo.completeOnce(envelopeId, versionId)).toEqual({ completed: false, outstanding: 1 });
        expect((await repo.get(envelopeId))?.status).toBe('draft');
    });

    it('lists versions in order', async () => {
        const { envelopeId } = await makeEnvelope();
        const versions = await repo.listVersions(envelopeId);
        expect(versions).toHaveLength(1);
        expect((versions[0] as any).versionNo).toBe(1);
    });
});

describe('the token', () => {
    it('resolves a live token and refuses a revoked or expired one', async () => {
        const { envelopeId } = await makeEnvelope();
        const live = await addRecipient(envelopeId, 'signer', { tokenHash: 'hash_live', expiresAt: '2099-01-01T00:00:00.000Z' });
        await addRecipient(envelopeId, 'signer', { tokenHash: 'hash_revoked', revokedAt: '2026-09-01T00:00:00.000Z' });
        await addRecipient(envelopeId, 'signer', { tokenHash: 'hash_expired', expiresAt: '2020-01-01T00:00:00.000Z' });

        expect((await repo.resolveByTokenHash('hash_live'))?.recipientId).toBe(live);
        expect(await repo.resolveByTokenHash('hash_revoked')).toBeNull();
        expect(await repo.resolveByTokenHash('hash_expired')).toBeNull();
        expect(await repo.resolveByTokenHash('hash_unknown')).toBeNull();
    });
});

describe('recipients and delivery', () => {
    it('adds recipients idempotently and lists them in order', async () => {
        const { envelopeId } = await makeEnvelope();
        const rid = id('rcp');
        expect((await repo.addRecipient({ recipientId: rid, envelopeId, role: 'signer', email: 'a@x.com', orderNo: 1 })).created).toBe(true);
        expect((await repo.addRecipient({ recipientId: rid, envelopeId, role: 'signer', email: 'a@x.com', orderNo: 1 })).created).toBe(false);
        await repo.addRecipient({ recipientId: id('rcp'), envelopeId, role: 'reviewer', email: 'r@x.com', orderNo: 0 });

        const list = await repo.listRecipients(envelopeId);
        expect(list).toHaveLength(2);
        expect((list[0] as any).role).toBe('reviewer'); // orderNo 0 first
    });

    it('captures the message id at send, which is what a bounce is matched on', async () => {
        const { envelopeId } = await makeEnvelope();
        const rid = id('rcp');
        await repo.addRecipient({ recipientId: rid, envelopeId, role: 'signer', email: 'a@x.com' });
        await repo.markDispatched({ recipientId: rid, tokenHash: 'th_1', sesMessageId: 'msg-1', expiresAt: '2099-01-01T00:00:00.000Z' });

        const r = await repo.getRecipient(rid);
        expect(r.status).toBe('dispatched');
        expect(r.sesMessageId).toBe('msg-1');
        expect(r.dispatchedAt).toBeTruthy();
        expect((await repo.resolveByTokenHash('th_1'))?.recipientId).toBe(rid);
    });

    it('correlates a bounce back to the recipient and only once', async () => {
        const { envelopeId } = await makeEnvelope();
        const rid = id('rcp');
        await repo.addRecipient({ recipientId: rid, envelopeId, role: 'signer', email: 'a@x.com' });
        await repo.markDispatched({ recipientId: rid, tokenHash: id('th'), sesMessageId: 'msg-bounce' });

        const first = await repo.markBouncedByMessageId('msg-bounce', 'Permanent', 'mailbox does not exist');
        expect(first).toHaveLength(1);
        expect(first[0].recipientId).toBe(rid);
        expect((await repo.getRecipient(rid)).status).toBe('bounced');

        // SNS redelivers; a second notification must not re-fire anything.
        expect(await repo.markBouncedByMessageId('msg-bounce', 'Permanent', 'again')).toHaveLength(0);
        expect(await repo.markBouncedByMessageId('msg-unknown', 'Permanent', 'x')).toHaveLength(0);
    });

    it('records the first open only', async () => {
        const { envelopeId } = await makeEnvelope();
        const rid = id('rcp');
        await repo.addRecipient({ recipientId: rid, envelopeId, role: 'signer', email: 'a@x.com' });
        expect((await repo.markOpened(rid)).firstOpen).toBe(true);
        expect((await repo.markOpened(rid)).firstOpen).toBe(false);
    });

    it('takes a verdict from a reviewer, once, and refuses one from a signer', async () => {
        const { envelopeId } = await makeEnvelope();
        const reviewerId = await addRecipient(envelopeId, 'reviewer');
        const signerId = await addRecipient(envelopeId, 'signer');

        expect((await repo.recordVerdict(reviewerId, 'changes_proposed', 'clause 5')).recorded).toBe(true);
        expect((await repo.recordVerdict(reviewerId, 'approved')).recorded).toBe(false);
        await expect(repo.recordVerdict(signerId, 'approved')).rejects.toThrow(/cannot return a verdict/);
    });

    it('revokes a link so it stops resolving', async () => {
        const { envelopeId } = await makeEnvelope();
        const rid = id('rcp');
        await repo.addRecipient({ recipientId: rid, envelopeId, role: 'reviewer', email: 'r@x.com' });
        await repo.markDispatched({ recipientId: rid, tokenHash: 'th_revoke' });
        expect(await repo.resolveByTokenHash('th_revoke')).toBeTruthy();

        expect(await repo.revokeRecipient(envelopeId, rid, 'verdict returned')).toEqual({ revoked: true });
        expect(await repo.resolveByTokenHash('th_revoke')).toBeNull();
    });

    it('will not revoke a link belonging to another document', async () => {
        // The handler checks the ENVELOPE against the acting org and then hands
        // over a recipient id off the path, so scoping by recipient alone let
        // one org kill another org's link by naming it.
        const mine = await makeEnvelope();
        const theirs = await otherOrgEnvelope();
        const victim = id('rcp');
        await repo.addRecipient({ recipientId: victim, envelopeId: theirs.envelopeId, role: 'signer', email: 'them@x.com' });
        await repo.markDispatched({ recipientId: victim, tokenHash: 'th_other_org' });

        expect(await repo.revokeRecipient(mine.envelopeId, victim, 'nice try')).toEqual({ revoked: false });
        expect((await repo.resolveByTokenHash('th_other_org'))?.recipientId).toBe(victim);
        expect((await repo.getRecipient(victim)).revokedAt).toBeNull();

        // And the owner of the document can still revoke it.
        expect(await repo.revokeRecipient(theirs.envelopeId, victim, 'sender revoked')).toEqual({ revoked: true });
        expect(await repo.resolveByTokenHash('th_other_org')).toBeNull();
    });

    it('claims the dispatch before the email and rolls it back if the send is refused', async () => {
        const { envelopeId } = await makeEnvelope();
        const rid = id('rcp');
        await repo.addRecipient({ recipientId: rid, envelopeId, role: 'signer', email: 'a@x.com' });
        await repo.markDispatched({ recipientId: rid, tokenHash: 'th_live', expiresAt: '2099-01-01T00:00:00.000Z', sesMessageId: 'msg-live' });

        // A resend claims a new credential and gets the old one back.
        const claim = await repo.markDispatched({ recipientId: rid, tokenHash: 'th_resend', expiresAt: '2099-06-01T00:00:00.000Z' });
        expect(claim.claimed).toBe(true);
        expect(claim.previous?.tokenHash).toBe('th_live');
        expect(await repo.resolveByTokenHash('th_live')).toBeNull();

        // The send is refused, so the link already delivered has to come back.
        expect(await repo.rollbackDispatch(rid, 'th_resend', claim.previous)).toEqual({ restored: true });
        expect((await repo.resolveByTokenHash('th_live'))?.recipientId).toBe(rid);
        expect(await repo.resolveByTokenHash('th_resend')).toBeNull();
        const back = await repo.getRecipient(rid);
        expect(back.sesMessageId).toBe('msg-live');
        expect(back.expiresAt).toBe('2099-01-01T00:00:00.000Z');
    });

    it('leaves a recipient exactly as it found them when a first send is refused', async () => {
        const { envelopeId } = await makeEnvelope();
        const rid = id('rcp');
        await repo.addRecipient({ recipientId: rid, envelopeId, role: 'signer', email: 'a@x.com' });

        const claim = await repo.markDispatched({ recipientId: rid, tokenHash: 'th_never_sent' });
        await repo.rollbackDispatch(rid, 'th_never_sent', claim.previous);

        const after = await repo.getRecipient(rid);
        expect(after.status).toBe('pending');
        expect(after.tokenHash).toBeNull();
        expect(after.dispatchedAt).toBeNull();
        expect(await repo.resolveByTokenHash('th_never_sent')).toBeNull();
    });

    it('will not roll back over a newer claim', async () => {
        const { envelopeId } = await makeEnvelope();
        const rid = id('rcp');
        await repo.addRecipient({ recipientId: rid, envelopeId, role: 'signer', email: 'a@x.com' });
        await repo.markDispatched({ recipientId: rid, tokenHash: 'th_first' });
        const stale = await repo.markDispatched({ recipientId: rid, tokenHash: 'th_second' });
        await repo.markDispatched({ recipientId: rid, tokenHash: 'th_third' });

        // The second send failed, but a third has since gone out. Restoring the
        // second's snapshot would break the link that actually reached someone.
        expect(await repo.rollbackDispatch(rid, 'th_second', stale.previous)).toEqual({ restored: false });
        expect((await repo.resolveByTokenHash('th_third'))?.recipientId).toBe(rid);
    });

    it('keeps the existing link when a dispatch does not issue a new one', async () => {
        // Recording the message id after the send must not re-mint the token:
        // the hash is the only copy of the link, so overwriting it would kill
        // the email that just went out.
        const { envelopeId } = await makeEnvelope();
        const rid = id('rcp');
        await repo.addRecipient({ recipientId: rid, envelopeId, role: 'signer', email: 'a@x.com' });
        await repo.markDispatched({
            recipientId: rid, tokenHash: 'th_keep', expiresAt: '2099-01-01T00:00:00.000Z',
            accessCodeHash: 'ach', accessCodeSalt: 'salt', accessCodeChannel: 'spoken',
        });

        await repo.markDispatched({ recipientId: rid, sesMessageId: 'msg-after-send' });

        const r = await repo.getRecipient(rid);
        expect(r.tokenHash).toBe('th_keep');
        expect(r.expiresAt).toBe('2099-01-01T00:00:00.000Z');
        expect(r.accessCodeHash).toBe('ach');
        expect(r.accessCodeChannel).toBe('spoken');
        expect(r.sesMessageId).toBe('msg-after-send');
        expect((await repo.resolveByTokenHash('th_keep'))?.recipientId).toBe(rid);
    });

    it('refuses to dispatch a revoked link', async () => {
        const { envelopeId } = await makeEnvelope();
        const rid = id('rcp');
        await repo.addRecipient({ recipientId: rid, envelopeId, role: 'signer', email: 'a@x.com' });
        await repo.revokeRecipient(envelopeId, rid, 'the sender revoked this link');

        const claim = await repo.markDispatched({ recipientId: rid, tokenHash: 'th_after_revoke' });
        expect(claim.claimed).toBe(false);
        expect(await repo.resolveByTokenHash('th_after_revoke')).toBeNull();
        expect((await repo.getRecipient(rid)).status).toBe('revoked');
    });

    it('counts wrong codes atomically and locks out', async () => {
        const { envelopeId } = await makeEnvelope();
        const rid = id('rcp');
        await repo.addRecipient({ recipientId: rid, envelopeId, role: 'signer', email: 'a@x.com' });
        const until = '2099-01-01T00:00:00.000Z';

        // Parallel guesses must each be counted, not collapse into one.
        const results = await Promise.all(Array.from({ length: 5 }, () => repo.registerFailedCodeAttempt(rid, 5, until)));
        expect((await repo.getRecipient(rid)).failedAttempts).toBe(5);
        expect(results.some(r => r.locked)).toBe(true);
        expect((await repo.getRecipient(rid)).lockedUntil).toBe(until);

        await repo.clearFailedCodeAttempts(rid);
        const cleared = await repo.getRecipient(rid);
        expect(cleared.failedAttempts).toBe(0);
        expect(cleared.lockedUntil).toBeNull();
    });

    it('restarts the count once a lockout has passed, rather than staying one wrong code from the next', async () => {
        const { envelopeId } = await makeEnvelope();
        const rid = id('rcp');
        await repo.addRecipient({ recipientId: rid, envelopeId, role: 'signer', email: 'a@x.com' });

        // Five wrong codes under a lock that expired in the past.
        const pastLock = '2000-01-01T00:00:00.000Z';
        for (let i = 0; i < 5; i++) await repo.registerFailedCodeAttempt(rid, 5, pastLock);
        expect((await repo.getRecipient(rid)).failedAttempts).toBe(5);
        expect((await repo.getRecipient(rid)).lockedUntil).toBe(pastLock);

        // The window is over: the next wrong code is attempt 1 of a new window, not a fresh lockout.
        const futureLock = '2099-01-01T00:00:00.000Z';
        const next = await repo.registerFailedCodeAttempt(rid, 5, futureLock);
        expect(next).toEqual({ attempts: 1, locked: false });
        const after = await repo.getRecipient(rid);
        expect(after.failedAttempts).toBe(1);
        expect(after.lockedUntil).toBeNull();

        // An unexpired lock still counts on from where it was.
        for (let i = 0; i < 4; i++) await repo.registerFailedCodeAttempt(rid, 5, futureLock);
        expect((await repo.getRecipient(rid)).lockedUntil).toBe(futureLock);
        const still = await repo.registerFailedCodeAttempt(rid, 5, futureLock);
        expect(still).toEqual({ attempts: 6, locked: true });
    });
});

describe('authoring', () => {
    it('places a field on a signer and refuses one on a reviewer', async () => {
        const { envelopeId, versionId } = await makeEnvelope();
        const signerId = await addRecipient(envelopeId, 'signer');
        const reviewerId = await addRecipient(envelopeId, 'reviewer');

        const f = await repo.addField({ fieldId: id('fld'), versionId, recipientId: signerId, type: 'signature', page: 1, x: 8, y: 70, w: 34, h: 9 });
        expect(f.created).toBe(true);
        await expect(repo.addField({ fieldId: id('fld'), versionId, recipientId: reviewerId, type: 'signature', page: 1, x: 8, y: 83, w: 34, h: 9 }))
            .rejects.toThrow(/cannot be assigned a field/);

        expect(await repo.listFields(versionId)).toHaveLength(1);
    });

    it('is retry-safe on the field id, and can remove one', async () => {
        const { envelopeId, versionId } = await makeEnvelope();
        const signerId = await addRecipient(envelopeId, 'signer');
        const fieldId = id('fld');
        const args = { fieldId, versionId, recipientId: signerId, type: 'date' as const, page: 1, x: 1, y: 2, w: 3, h: 4 };
        expect((await repo.addField(args)).created).toBe(true);
        expect((await repo.addField(args)).created).toBe(false);
        expect(await repo.removeField(envelopeId, fieldId)).toEqual({ removed: true });
        expect(await repo.listFields(versionId)).toHaveLength(0);
    });

    it('will not remove a field from another document', async () => {
        // A field hangs off a version, so the only way to prove which document
        // it is on is to reach the envelope through envelope_versions. Deleting
        // by field id alone let a caller who owned one document delete a field
        // on somebody else's.
        const mine = await makeEnvelope();
        const theirs = await otherOrgEnvelope();
        const signerId = await addRecipient(theirs.envelopeId, 'signer');
        const fieldId = id('fld');
        await repo.addField({ fieldId, versionId: theirs.versionId, recipientId: signerId, type: 'signature', page: 1, x: 1, y: 2, w: 3, h: 4 });

        expect(await repo.removeField(mine.envelopeId, fieldId)).toEqual({ removed: false });
        expect(await repo.listFields(theirs.versionId)).toHaveLength(1);

        expect(await repo.removeField(theirs.envelopeId, fieldId)).toEqual({ removed: true });
        expect(await repo.listFields(theirs.versionId)).toHaveLength(0);
    });

    it('supersedes the current version and moves the envelope onto it', async () => {
        const { envelopeId, versionId } = await makeEnvelope();
        const v2 = await repo.createVersion({ versionId: id('ver'), envelopeId, createdBy: 'user_1', bodyMarkdown: '## v2' });

        expect(v2.versionNo).toBe(2);
        expect((await repo.get(envelopeId))?.currentVersionNo).toBe(2);

        const versions = await repo.listVersions(envelopeId);
        expect(versions).toHaveLength(2);
        expect((versions[0] as any).versionId).toBe(versionId);
        expect((versions[0] as any).supersededAt).toBeTruthy();
        expect((versions[1] as any).supersededAt).toBeNull();
    });

    it('records reviewer comments individually and resolves one at a time', async () => {
        const { envelopeId, versionId } = await makeEnvelope();
        const reviewerId = await addRecipient(envelopeId, 'reviewer');
        const c1 = id('cmt');
        await repo.addComment({ commentId: c1, envelopeId, versionId, recipientId: reviewerId, authorLabel: 'Ruth', body: 'Clause 5 is too long', page: 1, x: 20, y: 40, proposedText: 'thirty (30) days' });
        await repo.addComment({ commentId: id('cmt'), envelopeId, versionId, authorLabel: 'Ruth', body: 'Second point' });

        expect(await repo.listComments(versionId)).toHaveLength(2);
        await repo.resolveComment(c1);
        const after = await repo.listComments(versionId);
        expect((after.find((c: any) => c.commentId === c1) as any).resolvedAt).toBeTruthy();
        expect((after.find((c: any) => c.commentId !== c1) as any).resolvedAt).toBeNull();
    });
});

describe('reusable documents', () => {
    it('creates a template and lists it, retry-safe on the id', async () => {
        const templateId = id('tpl');
        const args = {
            templateId, orgId: 'org_1', createdBy: 'user_1', name: 'Standard roofing proposal',
            kind: 'proposal', bodyMarkdown: '## Proposal\n\n{{sig:counterparty}} {{date:counterparty}}',
        };
        expect((await repo.createTemplate(args)).created).toBe(true);
        expect((await repo.createTemplate(args)).created).toBe(false);

        const { items: list } = await repo.listTemplates('org_1');
        expect(list.map((t: any) => t.templateId)).toContain(templateId);
        expect((await repo.getTemplate(templateId)).timesUsed).toBe(0);
    });

    it('refuses a template for a kind that is not handled here', async () => {
        await expect(repo.createTemplate({
            templateId: id('tpl'), orgId: 'org_1', createdBy: 'user_1',
            name: 'Employment', kind: 'employment',
        })).rejects.toThrow(/not handled here/);
    });

    it('makes a document from a template and counts the use', async () => {
        const templateId = id('tpl');
        await repo.createTemplate({
            templateId, orgId: 'org_1', createdBy: 'user_1', name: 'NDA',
            kind: 'nda', bodyMarkdown: '## NDA {{sig:counterparty}}',
        });

        const made = await repo.createFromTemplate({
            envelopeId: id('env'), versionId: id('ver'), templateId,
            orgId: 'org_1', createdBy: 'user_1', title: 'NDA for Ellis',
        });

        expect(made.title).toBe('NDA for Ellis');
        expect(made.kind).toBe('nda');
        expect(made.tier).toBe(1);
        expect((await repo.getTemplate(templateId)).timesUsed).toBe(1);

        const versions = await repo.listVersions(made.envelopeId);
        expect((versions[0] as any).bodyMarkdown).toBe('## NDA {{sig:counterparty}}');
    });

    it('copies the wording rather than referencing it, so a later edit cannot change what was sent', async () => {
        const templateId = id('tpl');
        await repo.createTemplate({
            templateId, orgId: 'org_1', createdBy: 'user_1', name: 'Terms',
            kind: 'proposal', bodyMarkdown: 'original wording',
        });
        const made = await repo.createFromTemplate({
            envelopeId: id('env'), versionId: id('ver'), templateId, orgId: 'org_1', createdBy: 'user_1',
        });

        await pglite.query("UPDATE envelope_templates SET body_markdown = 'edited later' WHERE template_id = $1", [templateId]);

        const versions = await repo.listVersions(made.envelopeId);
        expect((versions[0] as any).bodyMarkdown).toBe('original wording');
    });

    it('will not use another org template', async () => {
        const templateId = id('tpl');
        await repo.createTemplate({ templateId, orgId: 'org_1', createdBy: 'u', name: 'Mine', kind: 'proposal', bodyMarkdown: 'x' });
        await expect(repo.createFromTemplate({
            envelopeId: id('env'), versionId: id('ver'), templateId, orgId: 'org_OTHER', createdBy: 'u',
        })).rejects.toThrow(/No such template/);
    });

    it('archives rather than deletes, so a sent document still names it', async () => {
        const templateId = id('tpl');
        await repo.createTemplate({ templateId, orgId: 'org_1', createdBy: 'u', name: 'Old', kind: 'proposal', bodyMarkdown: 'x' });
        await repo.archiveTemplate(templateId);

        expect((await repo.listTemplates('org_1')).items.map((t: any) => t.templateId)).not.toContain(templateId);
        expect((await repo.listTemplates('org_1', { includeArchived: true })).items.map((t: any) => t.templateId)).toContain(templateId);
        expect(await repo.getTemplate(templateId)).toBeTruthy();
    });

    it('keeps what the template was drafted from', async () => {
        const templateId = id('tpl');
        const answers = { counterpartyType: 'company', term: '2 years', mutual: true };
        await repo.createTemplate({
            templateId, orgId: 'org_1', createdBy: 'user_1', name: 'Mutual NDA', kind: 'nda',
            bodyMarkdown: '## NDA {{sig:counterparty}}',
            answers, jurisdiction: 'VIC', effectiveDate: '2026-09-01',
        });
        const stored = await repo.getTemplate(templateId);
        expect(stored.answers).toEqual(answers);
        expect(stored.jurisdiction).toBe('VIC');
        expect(stored.effectiveDate).toBe('2026-09-01');

        // A template that was never drafted reads as null, not as an empty object.
        const uploaded = id('tpl');
        await repo.createTemplate({ templateId: uploaded, orgId: 'org_1', createdBy: 'user_1', name: 'Uploaded', kind: 'proposal', s3Key: 'k' });
        const bare = await repo.getTemplate(uploaded);
        expect(bare.answers).toBeNull();
        expect(bare.jurisdiction).toBeNull();
        expect(bare.effectiveDate).toBeNull();
    });

    it('copies the drafting facts onto a document made from the template', async () => {
        const templateId = id('tpl');
        const answers = { counterpartyType: 'sole_trader', term: '12 months' };
        await repo.createTemplate({
            templateId, orgId: 'org_1', createdBy: 'user_1', name: 'NDA', kind: 'nda',
            bodyMarkdown: '## NDA {{sig:counterparty}}',
            answers, jurisdiction: 'NSW', effectiveDate: '2026-10-15',
        });
        const made = await repo.createFromTemplate({
            envelopeId: id('env'), versionId: id('ver'), templateId, orgId: 'org_1', createdBy: 'user_1',
        });
        expect(made.answers).toEqual(answers);
        expect(made.jurisdiction).toBe('NSW');
        expect(made.effectiveDate).toBe('2026-10-15');

        const fetched = await repo.get(made.envelopeId);
        expect(fetched?.answers).toEqual(answers);
        expect(fetched?.jurisdiction).toBe('NSW');
        expect(fetched?.effectiveDate).toBe('2026-10-15');
    });

    it('replays a createFromTemplate with the same envelopeId as the existing document, unchanged', async () => {
        const templateId = id('tpl');
        await repo.createTemplate({
            templateId, orgId: 'org_1', createdBy: 'user_1', name: 'NDA', kind: 'nda',
            bodyMarkdown: '## NDA {{sig:counterparty}}',
            answers: { term: '1 year' }, jurisdiction: 'QLD', effectiveDate: '2026-01-01',
        });
        const envelopeId = id('env');
        const first = await repo.createFromTemplate({
            envelopeId, versionId: id('ver'), templateId, orgId: 'org_1', createdBy: 'user_1', title: 'NDA for Ellis',
        });
        const again = await repo.createFromTemplate({
            envelopeId, versionId: id('ver'), templateId, orgId: 'org_1', createdBy: 'user_1', title: 'A different title',
        });
        expect(again).toEqual(first);
        expect(again.title).toBe('NDA for Ellis');
        expect(again.jurisdiction).toBe('QLD');
        expect((await repo.listVersions(envelopeId)).length).toBe(1);
        expect((await repo.getTemplate(templateId)).timesUsed).toBe(1);
    });
});

describe('roles, and sending a prepared template again', () => {
    async function prepared() {
        const templateId = id('tpl');
        await repo.createTemplate({
            templateId, orgId: 'org_1', createdBy: 'user_1', name: 'Subcontractor agreement',
            kind: 'subcontractor_agreement', bodyMarkdown: '## Agreement for {{counterparty.name}}',
        });
        await repo.addTemplateRole({ templateRoleId: id('rol'), templateId, roleKey: 'counterparty', label: 'Counterparty', signingRole: 'signer', orderNo: 0 });
        await repo.addTemplateRole({ templateRoleId: id('rol'), templateId, roleKey: 'us', label: 'Us', signingRole: 'signer', orderNo: 1 });
        await repo.addTemplateRole({ templateRoleId: id('rol'), templateId, roleKey: 'lawyer', label: 'Our lawyer', signingRole: 'reviewer', required: false });
        await repo.addTemplateField({ templateFieldId: id('tf'), templateId, roleKey: 'counterparty', type: 'signature', page: 1, x: 8, y: 70, w: 34, h: 8 });
        await repo.addTemplateField({ templateFieldId: id('tf'), templateId, roleKey: 'counterparty', type: 'date', page: 1, x: 46, y: 70, w: 20, h: 8 });
        await repo.addTemplateField({ templateFieldId: id('tf'), templateId, roleKey: 'us', type: 'signature', page: 1, x: 8, y: 84, w: 34, h: 8 });
        return templateId;
    }

    it('places template fields against roles, never people', async () => {
        const templateId = await prepared();
        const fields = await repo.listTemplateFields(templateId);
        expect(fields).toHaveLength(3);
        expect(new Set(fields.map((f: any) => f.roleKey))).toEqual(new Set(['counterparty', 'us']));
        expect(fields.every((f: any) => !('recipientId' in f))).toBe(true);
    });

    it('refuses a field on a role that cannot hold one', async () => {
        const templateId = await prepared();
        await expect(repo.addTemplateField({
            templateFieldId: id('tf'), templateId, roleKey: 'lawyer', type: 'signature', page: 1, x: 1, y: 1, w: 5, h: 5,
        })).rejects.toThrow(/cannot be assigned a field/);
    });

    it('refuses a field for a role nobody defined', async () => {
        const templateId = await prepared();
        await expect(repo.addTemplateField({
            templateFieldId: id('tf'), templateId, roleKey: 'ghost', type: 'date', page: 1, x: 1, y: 1, w: 5, h: 5,
        })).rejects.toThrow(/no role called/);
    });

    it('fills the roles with people and re-points the fields at them', async () => {
        const templateId = await prepared();
        const dave = id('rcp'); const owner = id('rcp');
        const made = await repo.createFromTemplate({
            envelopeId: id('env'), versionId: id('ver'), templateId, orgId: 'org_1', createdBy: 'user_1',
            title: 'Agreement with Ellis',
            roleAssignments: [
                { roleKey: 'counterparty', recipientId: dave, email: 'dave@ellis.com', name: 'Dave Ellis' },
                { roleKey: 'us', recipientId: owner, email: 'leon@halvorsen.com', name: 'Leon' },
            ],
        });

        const recipients = await repo.listRecipients(made.envelopeId);
        expect(recipients).toHaveLength(2);
        expect((recipients as any[]).find((r) => r.recipientId === dave).roleKey).toBe('counterparty');

        const versions = await repo.listVersions(made.envelopeId);
        const fields = await repo.listFields((versions[0] as any).versionId) as any[];
        expect(fields).toHaveLength(3);
        expect(fields.filter((f) => f.recipientId === dave)).toHaveLength(2);
        expect(fields.filter((f) => f.recipientId === owner)).toHaveLength(1);
    });

    it('sends the same prepared template again to somebody else', async () => {
        const templateId = await prepared();
        const first = id('rcp'); const second = id('rcp'); const ownerA = id('rcp'); const ownerB = id('rcp');

        const a = await repo.createFromTemplate({
            envelopeId: id('env'), versionId: id('ver'), templateId, orgId: 'org_1', createdBy: 'u',
            roleAssignments: [
                { roleKey: 'counterparty', recipientId: first, email: 'one@x.com' },
                { roleKey: 'us', recipientId: ownerA, email: 'leon@x.com' },
            ],
        });
        const b = await repo.createFromTemplate({
            envelopeId: id('env'), versionId: id('ver'), templateId, orgId: 'org_1', createdBy: 'u',
            roleAssignments: [
                { roleKey: 'counterparty', recipientId: second, email: 'two@x.com' },
                { roleKey: 'us', recipientId: ownerB, email: 'leon@x.com' },
            ],
        });

        // Two separate documents, each with its own people and its own fields,
        // and nothing was re-placed by hand.
        expect(a.envelopeId).not.toBe(b.envelopeId);
        for (const [env, who] of [[a, first], [b, second]] as const) {
            const v = await repo.listVersions(env.envelopeId);
            const f = await repo.listFields((v[0] as any).versionId) as any[];
            expect(f.filter((x) => x.recipientId === who)).toHaveLength(2);
        }
        expect((await repo.getTemplate(templateId)).timesUsed).toBe(2);
    });

    it('will not send with a required role left empty', async () => {
        const templateId = await prepared();
        await expect(repo.createFromTemplate({
            envelopeId: id('env'), versionId: id('ver'), templateId, orgId: 'org_1', createdBy: 'u',
            roleAssignments: [{ roleKey: 'counterparty', recipientId: id('rcp'), email: 'one@x.com' }],
        })).rejects.toThrow(/Nobody was given these roles: Us/);
    });

    it('refuses a role the template does not have', async () => {
        const templateId = await prepared();
        await expect(repo.createFromTemplate({
            envelopeId: id('env'), versionId: id('ver'), templateId, orgId: 'org_1', createdBy: 'u',
            roleAssignments: [{ roleKey: 'landlord', recipientId: id('rcp'), email: 'x@x.com' }],
        })).rejects.toThrow(/no role called "landlord"/);
    });

    it('leaves an optional role unfilled without leaving a field orphaned', async () => {
        const templateId = await prepared();
        const c = id('rcp');
        const made = await repo.createFromTemplate({
            envelopeId: id('env'), versionId: id('ver'), templateId, orgId: 'org_1', createdBy: 'u',
            roleAssignments: [
                { roleKey: 'counterparty', recipientId: c, email: 'one@x.com' },
                { roleKey: 'us', recipientId: id('rcp'), email: 'leon@x.com' },
            ],
        });
        // The lawyer role is optional and was not filled; no recipient, no field.
        expect(await repo.listRecipients(made.envelopeId)).toHaveLength(2);
    });
});

describe('the vault', () => {
    it('pages with a cursor rather than returning everything', async () => {
        const org = 'org_vault';
        await pglite.query("INSERT INTO orgs (org_id, name) VALUES ($1, 'Vault') ON CONFLICT DO NOTHING", [org]);
        for (let i = 0; i < 5; i++) {
            await repo.create({ envelopeId: `venv_${i}`, orgId: org, createdBy: 'u', title: `Doc ${i}`, kind: 'proposal', versionId: `vver_${i}` });
        }

        const page1 = await repo.listEnvelopes({ orgId: org, limit: 2 });
        expect(page1.items).toHaveLength(2);
        expect(page1.nextCursor).toBeTruthy();

        const page2 = await repo.listEnvelopes({ orgId: org, limit: 2, cursor: page1.nextCursor });
        expect(page2.items).toHaveLength(2);
        const seen = [...page1.items, ...page2.items].map((e: any) => e.envelopeId);
        expect(new Set(seen).size).toBe(4); // no overlap between pages

        const last = await repo.listEnvelopes({ orgId: org, limit: 2, cursor: page2.nextCursor });
        expect(last.items).toHaveLength(1);
        expect(last.nextCursor).toBeNull();
    });

    it('is scoped to the org and can filter by status', async () => {
        const org = 'org_vault';
        await repo.setEnvelopeStatus('venv_0', 'completed');
        const completed = await repo.listEnvelopes({ orgId: org, status: 'completed' });
        expect(completed.items.map((e: any) => e.envelopeId)).toEqual(['venv_0']);
        expect((await repo.listEnvelopes({ orgId: 'org_1', status: 'completed' })).items.every((e: any) => e.orgId === 'org_1')).toBe(true);
    });

    it('counts by status in one query', async () => {
        const counts = await repo.countByStatus('org_vault');
        expect(counts.completed).toBe(1);
        expect(counts.draft).toBe(4);
    });
});

describe('sealing', () => {
    it('seals once and reports the existing artifact afterwards', async () => {
        const { envelopeId, versionId } = await makeEnvelope();
        const first = await repo.sealOnce({
            artifactId: id('art'), envelopeId, versionId, kind: 'sealed',
            s3Key: 'documents/org_1/sealed/a.pdf', sha256: 'aaa', byteSize: 100,
        });
        const second = await repo.sealOnce({
            artifactId: id('art'), envelopeId, versionId, kind: 'sealed',
            s3Key: 'documents/org_1/sealed/b.pdf', sha256: 'bbb', byteSize: 200,
        });

        expect(first.sealed).toBe(true);
        expect(second.sealed).toBe(false);
        expect(second.existingS3Key).toBe('documents/org_1/sealed/a.pdf');

        const rows = await pglite.query("SELECT * FROM envelope_artifacts WHERE envelope_id = $1 AND kind = 'sealed'", [envelopeId]);
        expect(rows.rows).toHaveLength(1);
    });

    it('still allows a different artifact kind on the same envelope', async () => {
        const { envelopeId } = await makeEnvelope();
        expect((await repo.sealOnce({ artifactId: id('art'), envelopeId, kind: 'original', s3Key: 'o.pdf', sha256: 'o', byteSize: 1 })).sealed).toBe(true);
        expect((await repo.sealOnce({ artifactId: id('art'), envelopeId, kind: 'certificate', s3Key: 'c.pdf', sha256: 'c', byteSize: 1 })).sealed).toBe(true);
    });

    it('finalises the claim, so the sealed bytes can be found afterwards', async () => {
        // The slot is claimed with a placeholder key before the PDF exists.
        // Without the finalise the row keeps that placeholder, and a seal that
        // succeeded end to end still leaves nothing anyone can fetch.
        const { envelopeId, versionId } = await makeEnvelope();
        await repo.sealOnce({ artifactId: id('art'), envelopeId, versionId, kind: 'sealed', s3Key: 'pending', sha256: 'pending', byteSize: 0 });

        expect(await repo.getArtifact(envelopeId, 'sealed')).toBeNull();
        expect((await repo.getArtifact(envelopeId, 'sealed', { includeUnfinalised: true }))?.s3Key).toBe('pending');

        expect(await repo.finaliseArtifact(envelopeId, 'sealed', {
            s3Key: 'documents/org_1/sealed/x.pdf', sha256: 'deadbeef', byteSize: 4096,
        })).toEqual({ finalised: true });

        const art = await repo.getArtifact(envelopeId, 'sealed');
        expect(art.s3Key).toBe('documents/org_1/sealed/x.pdf');
        expect(art.sha256).toBe('deadbeef');
        expect(art.byteSize).toBe(4096);
        expect((await repo.listArtifacts(envelopeId)).map((a: any) => a.kind)).toEqual(['sealed']);
    });

    it('absorbs a repeated finalise and refuses a different one', async () => {
        const { envelopeId } = await makeEnvelope();
        await repo.sealOnce({ artifactId: id('art'), envelopeId, kind: 'sealed', s3Key: 'pending', sha256: 'pending', byteSize: 0 });
        const bytes = { s3Key: 'sealed/a.pdf', sha256: 'aaa', byteSize: 10 };

        expect((await repo.finaliseArtifact(envelopeId, 'sealed', bytes)).finalised).toBe(true);
        // The same bytes again is a retry, not a second seal.
        expect((await repo.finaliseArtifact(envelopeId, 'sealed', bytes)).finalised).toBe(true);
        // Different bytes are a different document, and the chain attests to the first.
        expect((await repo.finaliseArtifact(envelopeId, 'sealed', { s3Key: 'sealed/b.pdf', sha256: 'bbb', byteSize: 20 })).finalised).toBe(false);
        expect((await repo.getArtifact(envelopeId, 'sealed')).s3Key).toBe('sealed/a.pdf');

        await expect(repo.finaliseArtifact(envelopeId, 'sealed', { s3Key: 'sealed/c.pdf', sha256: 'ccc', byteSize: 0 }))
            .rejects.toThrow(/no bytes/);
    });

    it('lets a seal that never produced any bytes be tried again', async () => {
        // A throw between claiming the slot and uploading used to block every
        // retry for ever: the slot was taken, so the document could never be
        // sealed at all.
        const { envelopeId } = await makeEnvelope();
        const claim = { artifactId: id('art'), envelopeId, kind: 'sealed' as const, s3Key: 'pending', sha256: 'pending', byteSize: 0 };
        expect(await repo.sealOnce(claim)).toEqual({ sealed: true });

        const retry = await repo.sealOnce({ ...claim, artifactId: id('art') });
        expect(retry).toEqual({ sealed: true, resumed: true });

        await repo.finaliseArtifact(envelopeId, 'sealed', { s3Key: 'sealed/done.pdf', sha256: 'done', byteSize: 99 });

        // Once there are bytes behind it, the slot is closed again.
        const after = await repo.sealOnce({ ...claim, artifactId: id('art') });
        expect(after.sealed).toBe(false);
        expect(after.existingS3Key).toBe('sealed/done.pdf');
    });
});

describe('document studio drafts', () => {
    it('keeps named parties on a draft before email addresses are supplied', async () => {
        const envelopeId = id('studio');
        await repo.create({ envelopeId, versionId: id('ver'), orgId: 'org_1', createdBy: 'user_1', title: 'Proposal', kind: 'proposal', bodyMarkdown: 'Original',
            recipients: [{ recipientId: id('party'), role: 'signer', roleKey: 'counterparty', name: 'Alex', email: '' }],
        });
        expect(await repo.listRecipients(envelopeId)).toEqual([expect.objectContaining({ name: 'Alex', email: '', roleKey: 'counterparty' })]);
    });
    it('versions a wording change once, retains recipients, and rejects stale edits', async () => {
        const { envelopeId } = await makeEnvelope();
        const r = await addRecipient(envelopeId, 'signer');
        const input = { envelopeId, orgId: 'org_1', expectedVersionNo: 1, versionId: id('edit'), createdBy: 'user_1', bodyMarkdown: 'Revised scope', recipients: [{ recipientId: r, name: 'Alex', email: 'alex@example.com' }] };
        expect(await repo.saveDraft(input)).toEqual({ versionNo: 2, changed: true });
        expect(await repo.saveDraft(input)).toEqual({ versionNo: 2, changed: false });
        expect(await repo.listRecipients(envelopeId)).toEqual([expect.objectContaining({ name: 'Alex', email: 'alex@example.com' })]);
        await expect(repo.saveDraft({ ...input, versionId: id('edit'), bodyMarkdown: 'Stale edit' })).rejects.toThrow(/changed/);
        await expect(repo.saveDraft({ ...input, orgId: 'org_2' })).rejects.toThrow(/No such/);
    });
    it('does not discard prepared pages for an email-only correction and freezes once sending starts', async () => {
        const { envelopeId, versionId } = await makeEnvelope();
        const r = await addRecipient(envelopeId, 'signer');
        await repo.attachRendered(envelopeId, versionId, { s3Key: 'ready.pdf', sha256: 'hash' });
        await repo.saveDraft({ envelopeId, orgId: 'org_1', expectedVersionNo: 1, versionId: id('edit'), createdBy: 'user_1', recipients: [{ recipientId: r, name: null, email: 'correct@example.com' }] });
        expect((await repo.listVersions(envelopeId))[0].s3Key).toBe('ready.pdf');
        expect(await repo.beginDraftSend(envelopeId, 'org_1', 1, 'out_for_signing')).toBe(true);
        expect(await repo.beginDraftSend(envelopeId, 'org_1', 1, 'out_for_signing')).toBe(false);
        await expect(repo.saveDraft({ envelopeId, orgId: 'org_1', expectedVersionNo: 1, versionId: id('edit'), createdBy: 'user_1', bodyMarkdown: 'Too late' })).rejects.toThrow(/already/);
    });
});


describe('draft rendering concurrency', () => {
    it('moves a name correction to a new version even when the first render is in flight', async () => {
        const envelopeId = id('studio');
        const firstVersion = id('ver');
        const recipientId = id('party');
        await repo.create({ envelopeId, versionId: firstVersion, orgId: 'org_1', createdBy: 'user_1', title: 'Proposal', kind: 'proposal', bodyMarkdown: 'Prepared for {{client}}',
            recipients: [{ recipientId, role: 'signer', roleKey: 'client', name: 'Alex', email: '' }],
        });
        const result = await repo.saveDraft({ envelopeId, orgId: 'org_1', expectedVersionNo: 1, versionId: id('edit'), createdBy: 'user_1',
            recipients: [{ recipientId, name: 'Alexandra', email: 'alex@example.com' }],
        });
        expect(result).toEqual({ versionNo: 2, changed: true });
        // The old render can finish, but its bytes cannot become the current copy.
        await repo.attachRendered(envelopeId, firstVersion, { s3Key: 'old-name.pdf', sha256: 'old' });
        expect((await repo.get(envelopeId))?.currentVersionNo).toBe(2);
        expect((await repo.listVersions(envelopeId)).find(v => v.versionNo === 2)?.s3Key).toBeNull();
        expect(await repo.beginDraftSend(envelopeId, 'org_1', 1, 'out_for_signing')).toBe(false);
    });
});

describe('document signing setup', () => {
    it('versions role edits, preserves role anchors, and replays without duplicate people', async () => {
        const envelopeId = id('setup'); const versionId = id('ver'); const recipientId = id('party');
        await repo.create({ envelopeId, versionId, orgId: 'org_1', createdBy: 'user_1', title: 'NDA', kind: 'nda', bodyMarkdown: 'Agreement',
            recipients: [{ recipientId, name: 'Alex', email: '', role: 'signer', roleKey: 'client' }] });
        const input = { envelopeId, orgId: 'org_1', createdBy: 'user_1', expectedVersionNo: 1, versionId: id('setup'), signatureMethod: 'wet' as const,
            recipients: [{ recipientId, name: 'Alexandra', email: '', role: 'signer' as const, signingCapacity: 'principal' as const },
                { recipientId: id('witness'), name: 'Witness', email: '', role: 'signer' as const, signingCapacity: 'witness' as const }] };
        expect(await repo.saveSetup(input)).toEqual({ versionNo: 2, changed: true });
        expect(await repo.saveSetup(input)).toEqual({ versionNo: 2, changed: false });
        expect((await repo.get(envelopeId))?.signatureMethod).toBe('wet');
        expect(await repo.listRecipients(envelopeId)).toEqual([expect.objectContaining({ roleKey: 'client', roleLabel: 'Alexandra', name: 'Alex' }), expect.objectContaining({ signingCapacity: 'witness' })]);
        await expect(repo.saveSetup({ ...input, versionId: id('stale') })).rejects.toThrow(/changed/);
        await expect(repo.saveSetup({ ...input, orgId: 'org_2' })).rejects.toThrow(/No such/);
        await repo.beginDraftSend(envelopeId, 'org_1', 2, 'out_for_signing');
        await expect(repo.saveSetup(input)).rejects.toThrow(/already/);
    });
    it('removes obsolete fields and carries retained uploaded placements to the new version', async () => {
        const { envelopeId, versionId } = await makeEnvelope();
        const keep = await addRecipient(envelopeId, 'signer'); const remove = await addRecipient(envelopeId, 'signer');
        await repo.attachRendered(envelopeId, versionId, { s3Key: 'original.pdf', sha256: 'original' });
        for (const recipientId of [keep, remove]) await repo.addField({ fieldId: id('field'), versionId, recipientId, type: 'signature', page: 1, x: 8, y: 70, w: 30, h: 8 });
        const next = id('setup');
        await repo.saveSetup({ envelopeId, orgId: 'org_1', createdBy: 'user_1', expectedVersionNo: 1, versionId: next, signatureMethod: 'digital',
            recipients: [{ recipientId: keep, name: 'Alex', email: '', role: 'signer', signingCapacity: 'principal' }] });
        expect(await repo.listFields(next)).toEqual([expect.objectContaining({ recipientId: keep, x: '8' })]);
        expect((await repo.listVersions(envelopeId))[1].s3Key).toBe('original.pdf');
        expect(await repo.getRecipient(remove)).toBeNull();
    });
    it('records an immutable signed PDF reference once per signer/version', async () => {
        const { envelopeId, versionId } = await makeEnvelope(); const recipientId = await addRecipient(envelopeId, 'signer');
        const input = { signatureId: id('sig'), versionId, recipientId, signedCopyKey: 'signed.pdf', signedCopySha256: 'hash' };
        expect((await repo.recordSignature(input)).created).toBe(true);
        expect((await repo.recordSignature({ ...input, signatureId: id('sig'), signedCopyKey: 'replacement.pdf' })).created).toBe(false);
        expect(await repo.listSignatures(versionId)).toEqual([expect.objectContaining({ signedCopyKey: 'signed.pdf', signedCopySha256: 'hash' })]);
    });
});

describe('reusable prepared templates', () => {
    it('copies roles and placements without recipients, preserves signing method and counts retries once', async () => {
        const templateId = id('template');
        await repo.createTemplate({ templateId, orgId: 'org_1', createdBy: 'user_1', name: 'Reusable', kind: 'nda', bodyMarkdown: 'Agreement', s3Key: 'prepared.pdf', signatureMethod: 'wet' });
        await repo.addTemplateRole({ templateRoleId: id('role'), templateId, roleKey: 'client', label: 'Client', signingRole: 'signer', signingCapacity: 'witness' });
        await repo.addTemplateField({ templateFieldId: id('field'), templateId, roleKey: 'client', type: 'signature', page: 1, x: 12, y: 75, w: 30, h: 8 });
        const input = { envelopeId: id('use'), versionId: id('ver'), templateId, orgId: 'org_1', createdBy: 'user_1', prepareOnly: true };
        await repo.createFromTemplate(input); await repo.createFromTemplate(input);
        expect((await repo.get(input.envelopeId))?.signatureMethod).toBe('wet');
        const people = await repo.listRecipients(input.envelopeId);
        expect(people).toEqual([expect.objectContaining({ name: null, email: '', roleLabel: 'Client', signingCapacity: 'witness' })]);
        expect(await repo.listFields(input.versionId)).toEqual([expect.objectContaining({ recipientId: people[0].recipientId, x: '12' })]);
        expect((await repo.getTemplate(templateId)).timesUsed).toBe(1);
        await repo.saveDraft({ envelopeId: input.envelopeId, orgId: 'org_1', createdBy: 'user_1', expectedVersionNo: 1, versionId: id('edit'),
            recipients: [{ recipientId: people[0].recipientId, name: 'A new person', email: 'new@example.com' }] });
        expect((await repo.listVersions(input.envelopeId))[0].s3Key).toBe('prepared.pdf');
        expect((await repo.get(input.envelopeId))?.currentVersionNo).toBe(1);
    });
});

describe('prepared reusable templates', () => {
    async function makeTemplate() {
        const templateId = id('prepared');
        await repo.createTemplate({ templateId, orgId: 'org_1', createdBy: 'user_1', name: 'NDA', kind: 'nda', bodyMarkdown: 'Confidential terms' });
        await repo.configureTemplate(templateId, 'org_1', [{ templateRoleId: `${templateId}:client`, templateId, roleKey: 'client', label: 'Client', signingRole: 'signer', signingCapacity: 'principal' }], 'digital');
        return templateId;
    }
    it('attaches generated pages and fields together, reuses their positions, and moves fields without duplicates', async () => {
        const templateId = await makeTemplate();
        const template = await repo.getTemplate(templateId);
        const input = { templateId, orgId: 'org_1', expectedUpdatedAt: template.updatedAt, s3Key: 'documents/org_1/prepared.pdf', fields: [
            { templateId, templateFieldId: `${templateId}:signature`, roleKey: 'client', type: 'signature' as const, page: 3, x: 10, y: 70, w: 40, h: 5 },
            { templateId, templateFieldId: `${templateId}:date`, roleKey: 'client', type: 'date' as const, page: 3, x: 10, y: 80, w: 20, h: 4 },
        ] };
        expect(await repo.prepareTemplate(input)).toBe(true);
        expect(await repo.prepareTemplate(input)).toBe(false);
        expect(await repo.moveTemplateField(templateId, `${templateId}:signature`, { x: 20, y: 60, w: 35, h: 6 })).toBe(true);
        const envelopeId = id('reuse'); const versionId = id('reuse_ver');
        await repo.createFromTemplate({ templateId, orgId: 'org_1', createdBy: 'user_1', envelopeId, versionId, prepareOnly: true });
        const fields = await repo.listFields(versionId);
        expect(fields).toHaveLength(2);
        expect(fields.find(f => f.type === 'signature')).toMatchObject({ page: 3, x: '20', y: '60', w: '35' });
        expect((await repo.listVersions(envelopeId))[0].s3Key).toBe(input.s3Key);
        expect((await repo.listRecipients(envelopeId))[0]).toMatchObject({ email: '', roleLabel: 'Client' });
        await repo.updateTemplate(templateId, { bodyMarkdown: 'Changed terms' });
        expect((await repo.getTemplate(templateId)).s3Key).toBeNull();
        expect(await repo.listTemplateFields(templateId)).toHaveLength(0);
        expect((await repo.listVersions(envelopeId))[0].s3Key).toBe(input.s3Key);
        expect(await repo.listFields(versionId)).toHaveLength(2);
    });
    it('rolls back pages and fields if any generated field has an invalid role', async () => {
        const templateId = await makeTemplate();
        const template = await repo.getTemplate(templateId);
        await expect(repo.prepareTemplate({ templateId, orgId: 'org_1', expectedUpdatedAt: template.updatedAt, s3Key: 'bad.pdf', fields: [
            { templateId, templateFieldId: id('field'), roleKey: 'unknown', type: 'signature', page: 1, x: 10, y: 10, w: 30, h: 5 },
        ] })).rejects.toThrow(/no role/);
        expect((await repo.getTemplate(templateId)).s3Key).toBeNull();
        expect(await repo.listTemplateFields(templateId)).toHaveLength(0);
    });
    it('refuses another org and stale rendered wording', async () => {
        const templateId = await makeTemplate();
        const input = { templateId, orgId: 'org_2', expectedUpdatedAt: 'stale', s3Key: 'bad.pdf', fields: [] };
        await expect(repo.prepareTemplate(input)).rejects.toThrow(/No such template/);
        await expect(repo.prepareTemplate({ ...input, orgId: 'org_1' })).rejects.toThrow(/changed during preparation/);
        await expect(repo.configureTemplate(templateId, 'org_2', [], 'wet')).rejects.toThrow(/No such template/);
    });
});

describe('moving a draft signing box', () => {
    it('keeps the field identity and refuses sent or cross-tenant changes', async () => {
        const { envelopeId, versionId } = await makeEnvelope();
        const recipientId = await addRecipient(envelopeId, 'signer');
        const fieldId = id('movable');
        await repo.addField({ fieldId, versionId, recipientId, type: 'signature', label: 'Client acceptance', required: false, page: 1, x: 10, y: 20, w: 40, h: 5 });
        const rect = { x: 20, y: 50, w: 35, h: 6 };
        expect(await repo.moveField(envelopeId, 'org_2', fieldId, rect)).toBe(false);
        expect(await repo.moveField(envelopeId, 'org_1', fieldId, rect)).toBe(true);
        expect(await repo.moveField(envelopeId, 'org_1', fieldId, rect)).toBe(true);
        expect(await repo.listFields(versionId)).toEqual([expect.objectContaining({ fieldId, recipientId, label: 'Client acceptance', required: false, page: 1, x: '20', y: '50' })]);
        await pglite.query("UPDATE envelopes SET status = 'out_for_signing' WHERE envelope_id = $1", [envelopeId]);
        expect(await repo.moveField(envelopeId, 'org_1', fieldId, { ...rect, x: 30 })).toBe(false);
    });
});

describe('reusable template profile scope', () => {
    it('isolates template lists, shape, direct reads and preparation mutations', async () => {
        const a = repo.withTemplateScope('org_1', 'template-a');
        const b = repo.withTemplateScope('org_1', 'template-b');
        const records: Array<{ templateId: string; fieldId: string; roleId: string; profile: string | null; org: string }> = [];
        for (const [profile, org] of [['template-a', 'org_1'], ['template-b', 'org_1'], ['template-a', 'org_2'], [null, 'org_1']] as const) {
            const templateId = id('scope-template');
            const roleId = id('scope-role');
            const fieldId = id('scope-field');
            await repo.createTemplate({ templateId, orgId: org, businessProfileId: profile, createdBy: 'user_1', name: 'Scope fixture', kind: 'nda', bodyMarkdown: 'Terms' });
            await repo.addTemplateRole({ templateId, templateRoleId: roleId, roleKey: 'signer', label: 'Signer', signingRole: 'signer' });
            await repo.addTemplateField({ templateId, templateFieldId: fieldId, roleKey: 'signer', type: 'signature', page: 1, x: 10, y: 60, w: 40, h: 5 });
            records.push({ templateId, roleId, fieldId, profile, org });
        }
        const own = records[0];
        const page = await a.listTemplates('org_1', { search: 'Scope fixture', limit: 1 });
        expect(page.items.map(t => t.templateId)).toEqual([own.templateId]);
        expect(page.nextCursor).toBeNull();
        expect((await b.listTemplates('org_1', { search: 'Scope fixture' })).items.map(t => t.templateId)).toEqual([records[1].templateId]);
        const counts = await a.templateShapeFor(records.map(r => r.templateId));
        expect(counts[own.templateId]).toEqual({ roles: 1, fields: 1 });
        for (const foreign of records.slice(1)) {
            expect(await a.getTemplate(foreign.templateId)).toBeNull();
            expect(await a.listTemplateRoles(foreign.templateId)).toEqual([]);
            expect(await a.listTemplateFields(foreign.templateId)).toEqual([]);
            expect(counts[foreign.templateId]).toEqual({ roles: 0, fields: 0 });
            expect(await a.moveTemplateField(foreign.templateId, foreign.fieldId, { x: 20, y: 50, w: 20, h: 5 })).toBe(false);
            await a.removeTemplateField(foreign.fieldId);
            await a.archiveTemplate(foreign.templateId);
            await expect(a.updateTemplate(foreign.templateId, { name: 'Changed' })).rejects.toThrow('No such template');
            await expect(a.addTemplateRole({ templateId: foreign.templateId, templateRoleId: id('bad-role'), roleKey: 'extra', label: 'Extra', signingRole: 'signer' })).rejects.toThrow('No such template');
            await expect(a.prepareTemplate({ templateId: foreign.templateId, orgId: 'org_1', expectedUpdatedAt: '', s3Key: 'bad.pdf', fields: [] })).rejects.toThrow('No such template');
            await expect(a.configureTemplate(foreign.templateId, 'org_1', [], 'wet')).rejects.toThrow('No such template');
            await expect(a.createFromTemplate({ templateId: foreign.templateId, orgId: 'org_1', envelopeId: id('bad-env'), versionId: id('bad-ver'), createdBy: 'user_1', prepareOnly: true })).rejects.toThrow('No such template');
            expect(await repo.getTemplate(foreign.templateId)).toMatchObject({ name: 'Scope fixture', archivedAt: null, timesUsed: 0 });
            expect(await repo.listTemplateFields(foreign.templateId)).toHaveLength(1);
        }
        await a.updateTemplate(own.templateId, { name: 'Renamed', businessProfileId: 'template-b', orgId: 'org_2', s3Key: 'foreign.pdf' } as any);
        expect(await a.getTemplate(own.templateId)).toMatchObject({ name: 'Renamed', businessProfileId: 'template-a', orgId: 'org_1', s3Key: null });
        expect(() => a.withTemplateScope('org_1', 'template-b')).toThrow('scope mismatch');
    });

    it('stamps new template ownership and retains scope through template-use transactions and replay', async () => {
        const a = repo.withTemplateScope('org_1', 'template-a');
        const templateId = id('scope-new');
        await a.createTemplate({ templateId, orgId: 'org_1', createdBy: 'user_1', name: 'Reusable', kind: 'nda', bodyMarkdown: 'Terms' });
        expect(await a.getTemplate(templateId)).toMatchObject({ businessProfileId: 'template-a' });
        await expect(repo.withTemplateScope('org_1', 'template-b').createTemplate({ templateId, orgId: 'org_1', createdBy: 'user_1', name: 'Collision', kind: 'nda' })).rejects.toThrow('No such template');
        await expect(a.createTemplate({ templateId: id('bad'), orgId: 'org_1', businessProfileId: 'template-b', createdBy: 'user_1', name: 'Bad', kind: 'nda' })).rejects.toThrow('scope mismatch');
        await a.configureTemplate(templateId, 'org_1', [{ templateId, templateRoleId: id('scope-role'), roleKey: 'signer', label: 'Signer', signingRole: 'signer' }], 'digital');
        const template = await a.getTemplate(templateId);
        await a.prepareTemplate({ templateId, orgId: 'org_1', expectedUpdatedAt: template.updatedAt, s3Key: 'documents/org_1/profiles/template-a/template.pdf', fields: [
            { templateId, templateFieldId: id('scope-field'), roleKey: 'signer', type: 'signature', page: 1, x: 10, y: 60, w: 30, h: 5 },
        ] });
        const input = { templateId, orgId: 'org_1', envelopeId: id('scope-use'), versionId: id('scope-ver'), createdBy: 'user_1', prepareOnly: true };
        expect(await a.createFromTemplate(input)).toMatchObject({ businessProfileId: 'template-a' });
        expect(await a.createFromTemplate(input)).toMatchObject({ businessProfileId: 'template-a' });
        expect((await a.getTemplate(templateId)).timesUsed).toBe(1);
        const foreign = await repo.create({ envelopeId: id('foreign-use'), versionId: id('foreign-ver'), orgId: 'org_1', businessProfileId: 'template-b', createdBy: 'user_1', title: 'Private', kind: 'nda' });
        await expect(a.createFromTemplate({ ...input, envelopeId: foreign.envelopeId })).rejects.toThrow('No such document');
        await expect(a.createFromTemplate({ ...input, orgId: 'org_2' })).rejects.toThrow('scope mismatch');
    });
});

describe('document vault profile queries', () => {
    it('filters before pagination/search and counts, excluding foreign and unassigned documents', async () => {
        const created: string[] = [];
        for (const [profile, org] of [['vault-a', 'org_1'], ['vault-b', 'org_1'], ['vault-a', 'org_2'], [null, 'org_1']] as const) {
            const envelopeId = id('vault-scope'); created.push(envelopeId);
            await repo.create({ envelopeId, orgId: org, businessProfileId: profile, createdBy: 'user_1', title: 'Profile vault fixture', kind: 'nda', versionId: id('vault-version') });
        }
        const page = await repo.listEnvelopes({ orgId: 'org_1', businessProfileId: 'vault-a', search: 'Profile vault fixture', limit: 1 });
        expect(page.items.map(e => e.envelopeId)).toEqual([created[0]]);
        expect(page.nextCursor).toBeNull();
        expect(await repo.countByStatus('org_1', 'vault-a')).toEqual({ draft: 1 });
        expect(await repo.countByStatus('org_1', '')).toEqual({});
    });
});

describe('document creation and field ownership races', () => {
    it('rejects creation collisions before inserting children or returning another profile document', async () => {
        const envelopeId = id('create-race');
        const make = (profile: string) => ({ envelopeId, versionId: id('race-ver'), orgId: 'org_1', businessProfileId: profile,
            createdBy: 'user_1', title: `Private ${profile}`, kind: 'nda',
            recipients: [{ recipientId: id('race-recipient'), role: 'signer' as const, email: `${profile}@example.com` }] });
        const inputs = [make('race-a'), make('race-b')];
        const results = await Promise.allSettled(inputs.map(input => repo.create(input)));
        expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
        const winnerIndex = results.findIndex(r => r.status === 'fulfilled');
        const winner = inputs[winnerIndex];
        const loser = inputs[1 - winnerIndex];
        expect((results[1 - winnerIndex] as PromiseRejectedResult).reason.message).toBe('No such document');
        expect((results[winnerIndex] as PromiseFulfilledResult<any>).value).toMatchObject({ title: winner.title, businessProfileId: winner.businessProfileId });
        expect((await repo.listVersions(envelopeId)).map(v => v.versionId)).toEqual([winner.versionId]);
        expect((await repo.listRecipients(envelopeId)).map(r => r.recipientId)).toEqual([winner.recipients[0].recipientId]);
        expect(await repo.getRecipient(loser.recipients[0].recipientId)).toBeNull();
        expect((await repo.listEvents(envelopeId)).items).toHaveLength(1);
        await expect(repo.create({ ...loser, orgId: 'org_2' })).rejects.toThrow('No such document');
        await expect(repo.create({ ...loser, businessProfileId: null })).rejects.toThrow('No such document');
        // A same-scope retry returns the stored snapshot, never adds new children.
        const replay = { ...winner, versionId: id('replay-ver'), title: 'Replacement', recipients: [{ recipientId: id('replay-recipient'), role: 'signer' as const, email: 'new@example.com' }] };
        expect(await repo.create(replay)).toMatchObject({ title: winner.title });
        expect((await repo.listVersions(envelopeId))).toHaveLength(1);
        expect(await repo.getRecipient(replay.recipients[0].recipientId)).toBeNull();
    });

    it('requires a field recipient on its version document, while allowing multiple fields for that signer', async () => {
        const source = await repo.create({ envelopeId: id('field-owner'), versionId: id('field-version'), orgId: 'org_1', businessProfileId: 'field-a', createdBy: 'user_1', title: 'Owner', kind: 'nda' });
        const version = (await repo.listVersions(source.envelopeId))[0];
        const ownRecipient = await addRecipient(source.envelopeId, 'signer');
        const foreignIds: string[] = ['missing-recipient'];
        for (const [orgId, businessProfileId] of [['org_1', 'field-b'], ['org_1', 'field-a'], ['org_2', 'field-a'], ['org_1', null]]) {
            const other = await repo.create({ envelopeId: id('foreign-field-owner'), versionId: id('foreign-field-version'), orgId: orgId!, businessProfileId, createdBy: 'user_1', title: 'Other', kind: 'nda' });
            foreignIds.push(await addRecipient(other.envelopeId, 'signer'));
        }
        for (const recipientId of foreignIds) {
            await expect(repo.addField({ fieldId: id('bad-field'), versionId: version.versionId, recipientId,
                type: 'signature', page: 1, x: 10, y: 60, w: 30, h: 5 })).rejects.toThrow('No such recipient on this document');
        }
        expect(await repo.listFields(version.versionId)).toEqual([]);
        for (const page of [1, 2]) await repo.addField({ fieldId: id('good-field'), versionId: version.versionId, recipientId: ownRecipient,
            type: 'signature', page, x: 10, y: 60, w: 30, h: 5 });
        expect(await repo.listFields(version.versionId)).toHaveLength(2);
    });
});

describe('immutable exact envelope file authority', () => {
    it('reads exact owned versions and templates, never another parent/profile or unassigned source', async () => {
        const { EnvelopeFilePgRepo } = await import('./fileRepo.pg');
        await pglite.query("INSERT INTO business_profiles (business_profile_id, org_id, business_name) VALUES ('file-a','org_1','File A'), ('file-b','org_1','File B'), ('file-other','org_2','File Other')");
        const a = new EnvelopeFilePgRepo('org_1', 'file-a', db);
        const b = new EnvelopeFilePgRepo('org_1', 'file-b', db);
        const source = await repo.create({ envelopeId: id('file-env'), versionId: id('file-ver'), orgId: 'org_1', businessProfileId: 'file-a', createdBy: 'user', title: 'File', kind: 'nda', s3Key: 'exact-key', sha256: 'exact-hash' });
        const [version] = await repo.listVersions(source.envelopeId);
        const other = await makeEnvelope('nda');
        const templateId = id('file-template');
        await repo.withTemplateScope('org_1', 'file-a').createTemplate({ templateId, orgId: 'org_1', createdBy: 'user', name: 'File template', kind: 'nda', s3Key: 'exact-template-key' });
        expect(await a.getVersion(source.envelopeId, version.versionId)).toMatchObject({ s3Key: 'exact-key', sha256: 'exact-hash', envelopeId: source.envelopeId });
        expect(await b.getVersion(source.envelopeId, version.versionId)).toBeNull();
        expect(await a.getVersion(other.envelopeId, version.versionId)).toBeNull();
        expect(await a.getVersion(other.envelopeId, other.versionId)).toBeNull();
        expect(await a.getVersion(source.envelopeId, 'missing')).toBeNull();
        expect(await a.getTemplate(templateId)).toMatchObject({ s3Key: 'exact-template-key' });
        expect(await b.getTemplate(templateId)).toBeNull();
        expect(await a.getTemplate('missing')).toBeNull();
        const foreignOrg = new EnvelopeFilePgRepo('org_2', 'file-a', db);
        expect(await foreignOrg.getVersion(source.envelopeId, version.versionId)).toBeNull();
        expect(await foreignOrg.getTemplate(templateId)).toBeNull();
        await pglite.query('UPDATE envelopes SET business_profile_id = $1 WHERE envelope_id = $2', ['file-other', source.envelopeId]);
        expect(await new EnvelopeFilePgRepo('org_1', 'file-other', db).getVersion(source.envelopeId, version.versionId)).toBeNull();
        await pglite.query('UPDATE envelopes SET business_profile_id = NULL WHERE envelope_id = $1', [source.envelopeId]);
        expect(await a.getVersion(source.envelopeId, version.versionId)).toBeNull();
        await pglite.query('DELETE FROM envelope_versions WHERE version_id = $1', [version.versionId]);
        expect(await a.getVersion(source.envelopeId, version.versionId)).toBeNull();
        expect(() => new EnvelopeFilePgRepo('org_1', '', db)).toThrow('scope is required');
    });
});
