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

async function makeEnvelope(kind = 'proposal') {
    const envelopeId = id('env');
    const versionId = id('ver');
    await repo.create({
        envelopeId, orgId: 'org_1', createdBy: 'user_1', createdByLabel: 'Leon',
        title: 'Roof replacement', kind, versionId,
    });
    return { envelopeId, versionId };
}

beforeAll(async () => {
    pglite = new PGlite({ extensions: { pg_trgm } });
    const executor: SqlExecutor = { exec: async (s: string) => ({ rows: (await pglite.query(s)).rows as any[] }) };
    await runMigrations(executor);
    db = drizzle(pglite) as unknown as PgDb;
    await pglite.query("INSERT INTO orgs (org_id, name) VALUES ('org_1', 'Acme')");
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

        const events = await repo.listEvents(envelopeId);
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
        const events = await repo.listEvents(envelopeId);
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
        const events = await repo.listEvents(envelopeId);
        expect(events).toHaveLength(9); // the root plus eight
        expect(events.map((e: any) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        expect(await repo.verifyChainFor(envelopeId)).toEqual({ ok: true, length: 9 });
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
});
