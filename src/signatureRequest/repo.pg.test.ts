import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { readFileSync } from 'node:fs';
import { runMigrations, splitStatements } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import { EnvelopePgRepo } from '../envelope/repo.pg';
import { ProfileSignatureRequestPgRepo, SignatureRequestConflict } from './repo.pg';

let pg: PGlite;
let db: PgDb;
const repo = (org = 'org_a', profile = 'profile_a', actor = 'advisor_a') => new ProfileSignatureRequestPgRepo(org, profile, actor, db);
const input = (key: string) => ({ clientRequestKey: key, title: 'Client agreement', signerEmail: 'person@example.com', kind: 'service_agreement' });
beforeAll(async () => {
    pg = new PGlite({ extensions: { pg_trgm } });
    await runMigrations({ exec: async s => ({ rows: (await pg.query(s)).rows }) });
    db = drizzle(pg) as unknown as PgDb;
    await pg.exec("INSERT INTO orgs (org_id,name) VALUES ('org_a','A'),('org_b','B'); INSERT INTO business_profiles (business_profile_id,org_id) VALUES ('profile_a','org_a'),('profile_b','org_a'),('profile_foreign','org_b');");
}, 30000);
afterAll(async () => { await pg.close(); });

describe('scoped signature requests, real PostgreSQL boundary', () => {
    it('reruns additive 0064 without altering existing data', async () => {
        const row = await repo().create(input('migration_retry'));
        for (const statement of splitStatements(readFileSync('drizzle/0064_profile_signature_requests.sql', 'utf8'))) await pg.query(statement);
        expect((await repo().get(row.requestId))?.payloadFingerprint).toBe(row.payloadFingerprint);
    });
    it('requires immutable explicit scope and rejects payload ownership overrides', async () => {
        expect(() => repo('', 'profile_a')).toThrow();
        await expect(repo().create({ ...input('override_case'), orgId: 'org_b' } as any)).rejects.toThrow();
        await expect(repo('org_a', 'profile_foreign').create(input('wrong_parent'))).rejects.toThrow();
    });
    it('concurrent creation replays one identity and conflicts on changed payload', async () => {
        const rows = await Promise.all([repo().create(input('concurrent_create')), repo().create(input('concurrent_create'))]);
        expect(rows[0].requestId).toBe(rows[1].requestId);
        await expect(repo().create({ ...input('concurrent_create'), title: 'Changed' })).rejects.toBeInstanceOf(SignatureRequestConflict);
        const other = await repo('org_a', 'profile_b').create(input('concurrent_create'));
        expect(other.requestId).not.toBe(rows[0].requestId);
    });
    it('isolates exact reads, lists and all mutations from foreign profile, org and actor', async () => {
        const row = await repo().create(input('isolation_case'));
        for (const foreign of [repo('org_a','profile_b'), repo('org_b','profile_foreign'), repo('org_a','profile_a','advisor_b')]) {
            expect(await foreign.get(row.requestId)).toBeNull();
            expect((await foreign.list(100)).some(r => r.requestId === row.requestId)).toBe(false);
            await expect(foreign.reserveUpload(row.requestId,'pdf')).rejects.toThrow();
            await expect(foreign.claimSend(row.requestId,'attempt_foreign_123')).rejects.toThrow();
            await expect(foreign.completeSend(row.requestId,'attempt_foreign_123',`env_${row.requestId}`)).rejects.toThrow();
            await expect(foreign.claimCancel(row.requestId,'attempt_foreign_123')).rejects.toThrow();
            await expect(foreign.completeCancel(row.requestId,'attempt_foreign_123')).rejects.toThrow();
        }
        expect((await repo().get(row.requestId))?.status).toBe('DRAFT');
    });
    it('reserves only one canonical exact upload, then prevents changes after claiming', async () => {
        const row = await repo().create(input('upload_reservation'));
        await expect(repo().claimSend(row.requestId,'attempt_upload_123')).rejects.toThrow();
        const reserved = await repo().reserveUpload(row.requestId,'pdf');
        expect(reserved.documentKey).toBe(`documents/org_a/profiles/profile_a/originals/${row.requestId}.pdf`);
        expect((await repo().reserveUpload(row.requestId,'pdf')).documentKey).toBe(reserved.documentKey);
        await expect(repo().reserveUpload(row.requestId,'docx')).rejects.toThrow();
        await repo().claimSend(row.requestId,'attempt_upload_123');
        await expect(repo().reserveUpload(row.requestId,'pdf')).rejects.toThrow();
    });
    it('allows only one concurrent send claim; uncertain retries never reclaim, even with same attempt', async () => {
        const row = await repo().create(input('send_concurrency'));
        await repo().reserveUpload(row.requestId,'pdf');
        const results = await Promise.all(['attempt_concurrent_a','attempt_concurrent_b'].map(attempt => repo().claimSend(row.requestId,attempt)));
        expect(results.filter(r => r.claimed)).toHaveLength(1);
        const winning = results.find(r => r.claimed)!.request;
        expect((await repo().claimSend(row.requestId,winning.attemptId!)).claimed).toBe(false);
        expect((await repo().claimSend(row.requestId,'attempt_retry_new_123')).request.status).toBe('SENDING');
        await expect(repo().completeSend(row.requestId,'attempt_wrong_123',`env_${row.requestId}`)).rejects.toThrow();
        await expect(repo().claimCancel(row.requestId,'attempt_cancel_123')).rejects.toThrow();
        const sent = await repo().completeSend(row.requestId,winning.attemptId!,`env_${row.requestId}`);
        expect(sent.status).toBe('SENT');
        expect((await repo().completeSend(row.requestId,winning.attemptId!,`env_${row.requestId}`)).providerRef).toBe(sent.providerRef);
        expect((await repo().claimSend(row.requestId,'attempt_after_sent')).claimed).toBe(false);
    });
    it('cancels drafts without dispatch and claims sent cancellation once', async () => {
        const draft = await repo().create(input('draft_cancelled'));
        expect(await repo().claimCancel(draft.requestId,'attempt_cancel_draft')).toMatchObject({ claimed:false, request:{status:'CANCELLED'} });
        await expect(repo().claimSend(draft.requestId,'attempt_after_cancel')).rejects.toThrow();
        const sent = await repo().create(input('sent_cancelled'));
        await repo().reserveUpload(sent.requestId,'pdf');
        await repo().claimSend(sent.requestId,'attempt_send_cancel');
        await repo().completeSend(sent.requestId,'attempt_send_cancel',`env_${sent.requestId}`);
        expect((await repo().claimCancel(sent.requestId,'attempt_cancel_sent')).claimed).toBe(true);
        expect((await repo().claimCancel(sent.requestId,'attempt_cancel_retry')).claimed).toBe(false);
        await expect(repo().completeCancel(sent.requestId,'attempt_cancel_wrong')).rejects.toThrow();
        expect((await repo().completeCancel(sent.requestId,'attempt_cancel_sent')).status).toBe('CANCELLED');
        expect((await repo().completeCancel(sent.requestId,'attempt_cancel_sent')).status).toBe('CANCELLED');
    });
    it('enforces immutable owner, payload, file and lifecycle below the repo', async () => {
        const row = await repo().create(input('database_constraints'));
        await expect(pg.query('UPDATE profile_signature_requests SET business_profile_id=$1 WHERE request_id=$2',['profile_b',row.requestId])).rejects.toThrow();
        await expect(pg.query('UPDATE profile_signature_requests SET title=$1 WHERE request_id=$2',['changed',row.requestId])).rejects.toThrow();
        await expect(pg.query('UPDATE profile_signature_requests SET document_key=$1 WHERE request_id=$2',['documents/org_b/foreign.pdf',row.requestId])).rejects.toThrow();
        await repo().reserveUpload(row.requestId,'pdf');
        await repo().claimSend(row.requestId,'attempt_constraints');
        await expect(pg.query("UPDATE profile_signature_requests SET status='DRAFT' WHERE request_id=$1",[row.requestId])).rejects.toThrow();
        await expect(pg.query("UPDATE profile_signature_requests SET attempt_id='replacement' WHERE request_id=$1",[row.requestId])).rejects.toThrow();
    });
    it('pages only within actor and profile and rejects malformed bounds', async () => {
        const page = await repo().list(1);
        const next = await repo().list(100,page[0].requestId);
        expect(next.every(r => r.requestId > page[0].requestId && r.businessProfileId === 'profile_a' && r.advisorUserId === 'advisor_a')).toBe(true);
        await expect(repo().list(101)).rejects.toThrow();
        await expect(repo().list(10,'forged')).rejects.toThrow();
    });
});


describe('request cancellation and public signing share the parent lock', () => {
    async function sentRequest(key: string) {
        const request = await repo().create(input(key));
        await repo().reserveUpload(request.requestId, 'pdf');
        await repo().claimSend(request.requestId, 'attempt_original_send');
        const envelopeId = `env_${request.requestId}`, versionId = `ver_${request.requestId}`, recipientId = `rcp_${request.requestId}`;
        const envelopes = new EnvelopePgRepo(db, db);
        const sha256 = 'a'.repeat(64), s3Key = `documents/org_a/rendered/${envelopeId}/${versionId}-${sha256}.pdf`;
        await envelopes.create({ envelopeId, versionId, orgId: 'org_a', businessProfileId: 'profile_a', createdBy: 'advisor_a', title: request.title,
            kind: request.kind, s3Key, sha256, recipients: [{ recipientId, role:'signer', email: request.signerEmail }] });
        await envelopes.setEnvelopeStatus(envelopeId, 'out_for_signing');
        await repo().completeSend(request.requestId, 'attempt_original_send', envelopeId);
        return { request, envelopes, scope: { orgId:'org_a', businessProfileId:'profile_a', envelopeId, s3Key, sha256 },
            signature: { signatureId:`sig_${request.requestId}`, versionId, recipientId, typedName:'Signer' } };
    }
    it('completed cancellation revokes the exact recipient and prevents later public signing', async () => {
        const x = await sentRequest('cancel_before_sign');
        await repo().claimCancel(x.request.requestId,'attempt_atomic_cancel');
        expect((await repo().completeOwnedCancellation(x.request.requestId,'attempt_atomic_cancel')).status).toBe('CANCELLED');
        expect((await x.envelopes.get(x.scope.envelopeId))?.status).toBe('voided');
        expect((await x.envelopes.getRecipient(x.signature.recipientId))?.status).toBe('revoked');
        await expect(x.envelopes.recordScopedSignature(x.scope,x.signature)).rejects.toThrow();
        expect(await x.envelopes.listSignatures(x.signature.versionId)).toEqual([]);
    });
    it('a signature committed after cancellation claim prevents cancellation atomically', async () => {
        const x = await sentRequest('sign_before_cancel');
        await repo().claimCancel(x.request.requestId,'attempt_atomic_cancel');
        expect(await x.envelopes.recordScopedSignature(x.scope,x.signature)).toMatchObject({created:true});
        await expect(repo().completeOwnedCancellation(x.request.requestId,'attempt_atomic_cancel')).rejects.toThrow();
        expect((await x.envelopes.get(x.scope.envelopeId))?.status).toBe('out_for_signing');
        expect((await x.envelopes.getRecipient(x.signature.recipientId))?.revokedAt).toBeNull();
        expect((await repo().get(x.request.requestId))?.status).toBe('CANCELLING');
    });
    it('rejects foreign public parent/version/reference before inserting a signature', async () => {
        const x = await sentRequest('sign_reference_guard');
        await expect(x.envelopes.recordScopedSignature({...x.scope,businessProfileId:'profile_b'},x.signature)).rejects.toThrow();
        await expect(x.envelopes.recordScopedSignature({...x.scope,s3Key:'foreign'},x.signature)).rejects.toThrow();
        await expect(x.envelopes.recordScopedSignature(x.scope,{...x.signature,versionId:'missing'})).rejects.toThrow();
        expect(await x.envelopes.listSignatures(x.signature.versionId)).toEqual([]);
    });
});

describe('owned request send admission and competing senders', () => {
    async function ready(key: string) {
        const request = await repo().create(input(key));
        await repo().reserveUpload(request.requestId,'pdf');
        const attemptId='attempt_admission_123';
        await repo().claimSend(request.requestId,attemptId);
        const envelopes=new EnvelopePgRepo(db,db);
        const envelopeId=`env_${request.requestId}`,versionId=`ver_${request.requestId}`,recipientId=`rcp_${request.requestId}`;
        const file={sha256:'b'.repeat(64),s3Key:`documents/org_a/rendered/${envelopeId}/${versionId}-${'b'.repeat(64)}.pdf`};
        await envelopes.create({envelopeId,versionId,orgId:'org_a',businessProfileId:'profile_a',createdBy:'advisor_a',title:request.title,kind:request.kind,...file,
            recipients:[{recipientId,role:'signer',email:request.signerEmail}]});
        return {request,attemptId,envelopes,envelopeId,recipientId,file,
            authority:{requestId:request.requestId,attemptId,orgId:'org_a',businessProfileId:'profile_a'}};
    }
    it('requires exact scope/version/file CAS and excludes native or repeated credential claims',async()=>{
        const x=await ready('owned_send_admission');
        expect(await x.envelopes.beginDraftSend(x.envelopeId,'org_a',1,'out_for_signing')).toBe(false);
        expect((await x.envelopes.markDispatched({recipientId:x.recipientId,tokenHash:'native'})).claimed).toBe(false);
        expect(await repo('org_a','profile_b').beginOwnedSend(x.request.requestId,x.attemptId,x.file)).toBe(false);
        expect(await repo().beginOwnedSend(x.request.requestId,x.attemptId,{...x.file,sha256:'wrong'})).toBe(false);
        expect(await repo().beginOwnedSend(x.request.requestId,x.attemptId,x.file)).toBe(true);
        expect(await repo().beginOwnedSend(x.request.requestId,x.attemptId,x.file)).toBe(false);
        expect((await x.envelopes.markDispatched({recipientId:x.recipientId,tokenHash:'wrong',signatureRequest:{...x.authority,attemptId:'wrong'}})).claimed).toBe(false);
        expect((await x.envelopes.markDispatched({recipientId:x.recipientId,tokenHash:`owned_${x.request.requestId}`,signatureRequest:x.authority})).claimed).toBe(true);
        expect((await x.envelopes.markDispatched({recipientId:x.recipientId,tokenHash:'repeat',signatureRequest:x.authority})).claimed).toBe(false);
        await x.envelopes.markDispatched({recipientId:x.recipientId,sesMessageId:'message',signatureRequest:x.authority});
        expect((await repo().completeOwnedSend(x.request.requestId,x.attemptId,x.file)).status).toBe('SENT');
        expect((await x.envelopes.markDispatched({recipientId:x.recipientId,tokenHash:'native_after_send'})).claimed).toBe(false);
    });
    it('preserves a decline during delivery, including the later SES marker, without false completion',async()=>{
        const x=await ready('decline_during_delivery');
        await repo().beginOwnedSend(x.request.requestId,x.attemptId,x.file);
        await x.envelopes.markDispatched({recipientId:x.recipientId,tokenHash:`owned_${x.request.requestId}`,signatureRequest:x.authority});
        await pg.query("UPDATE envelope_recipients SET status='declined' WHERE recipient_id=$1",[x.recipientId]);
        await x.envelopes.setEnvelopeStatus(x.envelopeId,'declined');
        expect((await x.envelopes.markDispatched({recipientId:x.recipientId,sesMessageId:'late_marker',signatureRequest:x.authority})).claimed).toBe(true);
        expect((await x.envelopes.getRecipient(x.recipientId))?.status).toBe('declined');
        await expect(repo().completeOwnedSend(x.request.requestId,x.attemptId,x.file)).rejects.toThrow();
        expect((await x.envelopes.get(x.envelopeId))?.status).toBe('declined');
        expect((await repo().get(x.request.requestId))?.status).toBe('SENDING');
    });
    it('a changed parent version cannot be admitted for dispatch',async()=>{
        const x=await ready('changed_before_admission');
        await pg.query('UPDATE envelopes SET current_version_no=2 WHERE envelope_id=$1',[x.envelopeId]);
        expect(await repo().beginOwnedSend(x.request.requestId,x.attemptId,x.file)).toBe(false);
        expect((await x.envelopes.markDispatched({recipientId:x.recipientId,tokenHash:`owned_${x.request.requestId}`,signatureRequest:x.authority})).claimed).toBe(false);
    });
});
