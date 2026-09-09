import { afterAll, beforeAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { readFileSync } from 'node:fs';
import { runMigrations, splitStatements } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import { ProfileDocumentRequestPgRepo } from './repo.pg';
import { ProfileDocumentRequestIngestionPgRepo } from './ingestion.pg';
let pg: PGlite; let db: PgDb;
const requests = (org='org-a', profile='profile-a', advisor='advisor-a') => new ProfileDocumentRequestPgRepo(org, profile, advisor, db);
const admissions = (org='org-a', profile='profile-a', advisor='advisor-a') => new ProfileDocumentRequestIngestionPgRepo(org, profile, advisor, db);
const input = {targetUserId:'owner-a', financialYear:'2026-27'};
const proof = {bucketName:'configured-receipts', versionId:'immutable-version-1', sha256:'a'.repeat(64), sizeBytes:123};
const fileInput = (key:string, contentType='application/pdf') => ({clientFileKey:key,fileName:'source.pdf',contentType:contentType as 'application/pdf',sizeBytes:123,sha256:'a'.repeat(64)});
async function fixture(key:string, docType:'BANK_STATEMENT'|'EXPENSE_DOC'|'GENERAL'='BANK_STATEMENT', contentType='application/pdf', attach=true) {
    const request = await requests().create({clientRequestKey:key,title:'Financial source',dueDate:'2026-09-30',docType});
    const file = await requests().reserveFile(request.requestId,'owner-a',1,fileInput(key,contentType));
    if (attach) await requests().attachVerified(request.requestId,file.fileId,'owner-a',2,proof);
    return {request,file};
}
async function count() { return (await pg.query<{count:number}>('SELECT count(*)::int AS count FROM profile_document_request_ingestions')).rows[0].count; }
beforeAll(async()=>{
    pg=new PGlite({extensions:{pg_trgm}}); await runMigrations({exec:async sql=>({rows:(await pg.query(sql)).rows})});
    db=drizzle(pg) as unknown as PgDb;
    await pg.exec("INSERT INTO orgs(org_id,name) VALUES('org-a','A'),('org-b','B'); INSERT INTO business_profiles(org_id,business_profile_id) VALUES('org-a','profile-a'),('org-a','profile-b'),('org-b','foreign-profile');");
},30000);
afterAll(async()=>{await pg.close();});
it('pins stored attachment version and one deterministic target; stale identical replay writes nothing',async()=>{
    const {request,file}=await fixture('stable-admission');
    const first=await admissions().reserve(request.requestId,file.fileId,'owner-a',3,input);
    expect(first.admission).toMatchObject({...input,docType:'BANK_STATEMENT',status:'RESERVED',admittedRevision:3,admittedBy:'owner-a'});
    expect(first.admission.targetId).toMatch(/^dsi_[a-f0-9]{64}$/);
    expect(first.source).toMatchObject({...proof,fileKey:file.fileKey});
    expect((await requests().get(request.requestId))?.revision).toBe(4);
    const replay=await admissions().reserve(request.requestId,file.fileId,'owner-a',3,input);
    expect(replay).toEqual(first);expect((await requests().get(request.requestId))?.revision).toBe(4);
    expect(await admissions().get(request.requestId,file.fileId)).toMatchObject({...first,parentStatus:'OPEN',parentRevision:4});
    await expect(admissions().reserve(request.requestId,file.fileId,'owner-a',4,{...input,targetUserId:'owner-b'})).rejects.toThrow('target conflicts');
    await expect(admissions().reserve(request.requestId,file.fileId,'owner-a',4,{...input,financialYear:'2027-28'})).rejects.toThrow('target conflicts');
    expect((await admissions().get(request.requestId,file.fileId))?.admission).toEqual(first.admission);
});
it('expense admission has a receipt identity and cannot accept a statement FY',async()=>{
    const {request,file}=await fixture('expense-admission','EXPENSE_DOC','image/png');
    await expect(admissions().reserve(request.requestId,file.fileId,'owner-a',3,input)).rejects.toThrow('Financial year');
    const value=await admissions().reserve(request.requestId,file.fileId,'owner-a',3,{targetUserId:'owner-a'});
    expect(value.admission).toMatchObject({docType:'EXPENSE_DOC',financialYear:null,status:'RESERVED'});
    expect(value.admission.targetId).toMatch(/^dri_[a-f0-9]{64}$/);
    expect((await requests().get(request.requestId))?.status).toBe('OPEN');
});
it('requires explicit identities and rejects caller-supplied destination/source/status overrides',async()=>{
    expect(()=>admissions('','profile-a')).toThrow();
    const {request,file}=await fixture('strict-admission');const before=await count();
    for(const bad of [{...input,targetId:'replacement'},{...input,bucketName:'foreign'},{...input,versionId:'latest'},{...input,status:'COMPLETE'},{...input,targetUserId:''},{...input,financialYear:'2026-29'}, {targetUserId:'owner-a'}]) {
        await expect(admissions().reserve(request.requestId,file.fileId,'owner-a',3,bad as any)).rejects.toThrow();
    }
    await expect(admissions().reserve('legacy-id',file.fileId,'owner-a',3,input)).rejects.toThrow();
    await expect(admissions().reserve(request.requestId,file.fileId,'',3,input)).rejects.toThrow();
    expect(await count()).toBe(before);expect((await requests().get(request.requestId))?.revision).toBe(3);
});
it('isolates org/profile/adviser and exact parent/file before any admission',async()=>{
    const {request,file}=await fixture('scope-admission');const other=await fixture('other-parent-admission');const before=await count();
    for(const wrong of [admissions('org-a','profile-b'),admissions('org-b','foreign-profile'),admissions('org-a','profile-a','advisor-b')]){
        expect(await wrong.get(request.requestId,file.fileId)).toBeNull();
        await expect(wrong.reserve(request.requestId,file.fileId,'owner-a',3,input)).rejects.toThrow();
    }
    await expect(admissions().reserve(other.request.requestId,file.fileId,'owner-a',3,input)).rejects.toThrow('Verified source');
    expect(await count()).toBe(before);
});
it('stale, unverified, cancelled and GENERAL requests cannot admit or become financially fulfilled',async()=>{
    const stale=await fixture('stale-admission');const unverified=await fixture('unverified-admission','BANK_STATEMENT','application/pdf',false);
    const cancelled=await fixture('cancelled-admission');const general=await fixture('general-admission','GENERAL');const before=await count();
    await expect(admissions().reserve(stale.request.requestId,stale.file.fileId,'owner-a',2,input)).rejects.toThrow('Request changed');
    await expect(admissions().reserve(unverified.request.requestId,unverified.file.fileId,'owner-a',2,input)).rejects.toThrow('Verified source');
    await requests().cancel(cancelled.request.requestId,3);
    await expect(admissions().reserve(cancelled.request.requestId,cancelled.file.fileId,'owner-a',4,input)).rejects.toThrow('unavailable');
    await expect(admissions().reserve(general.request.requestId,general.file.fileId,'owner-a',3,input)).rejects.toThrow('unavailable');
    await expect(requests().fulfillGeneral(stale.request.requestId,'owner-a',3)).rejects.toThrow();
    await expect(pg.query("UPDATE profile_document_requests SET status='FULFILLED',revision=revision+1 WHERE request_id=$1",[stale.request.requestId])).rejects.toThrow();
    expect(await count()).toBe(before);
});
it('source format and persisted attachment/reservation inconsistencies refuse admission',async()=>{
    const image=await fixture('bank-image-admission','BANK_STATEMENT','image/png');const csv=await fixture('expense-csv-admission','EXPENSE_DOC','text/csv');
    const corrupt=await fixture('corrupt-source-admission','BANK_STATEMENT','application/pdf',false);const before=await count();
    for(const {request,file} of [image,csv])await expect(admissions().reserve(request.requestId,file.fileId,'owner-a',3,request.docType==='BANK_STATEMENT'?input:{targetUserId:'owner-a'})).rejects.toThrow('source attachment');
    await pg.query(`INSERT INTO profile_document_request_attachments(file_id,request_id,org_id,business_profile_id,advisor_user_id,bucket_name,file_key,version_id,sha256,size_bytes,attached_by)
        VALUES($1,$2,'org-a','profile-a','advisor-a','configured-receipts','foreign-key','version-1',$3,123,'owner-a')`,[corrupt.file.fileId,corrupt.request.requestId,proof.sha256]);
    await expect(admissions().reserve(corrupt.request.requestId,corrupt.file.fileId,'owner-a',2,input)).rejects.toThrow('source attachment');
    expect(await count()).toBe(before);
});
it('simultaneous identical admission has one identity and one parent revision advance',async()=>{
    const {request,file}=await fixture('concurrent-same-admission');const before=await count();
    const rows=await Promise.all([admissions().reserve(request.requestId,file.fileId,'owner-a',3,input),admissions().reserve(request.requestId,file.fileId,'owner-a',3,input)]);
    expect(rows[0]).toEqual(rows[1]);expect(await count()).toBe(before+1);expect((await requests().get(request.requestId))?.revision).toBe(4);
});
it('distinct admissions and cancellation serialize on the current parent revision',async()=>{
    const {request,file}=await fixture('concurrent-distinct-admission');
    const second=await requests().reserveFile(request.requestId,'owner-a',3,fileInput('second-admission-file'));
    await requests().attachVerified(request.requestId,second.fileId,'owner-a',4,proof);const before=await count();
    const results=await Promise.allSettled([admissions().reserve(request.requestId,file.fileId,'owner-a',5,input),admissions().reserve(request.requestId,second.fileId,'owner-a',5,input)]);
    expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(await count()).toBe(before+1);
    const winner=results.find(x=>x.status==='fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<ProfileDocumentRequestIngestionPgRepo['reserve']>>>;
    await requests().cancel(request.requestId,6);
    await expect(admissions().reserve(request.requestId,winner.value.admission.fileId,'owner-a',5,input)).rejects.toThrow('unavailable');
    expect(await admissions().get(request.requestId,winner.value.admission.fileId)).toMatchObject({parentStatus:'CANCELLED',admission:{status:'RESERVED'}});
});
it('SQL preserves admission identity and attached version, and later parent failure rolls admission back',async()=>{
    const {request,file}=await fixture('immutable-admission');await admissions().reserve(request.requestId,file.fileId,'owner-a',3,input);
    await expect(pg.query("UPDATE profile_document_request_ingestions SET target_user_id='different' WHERE file_id=$1",[file.fileId])).rejects.toThrow('immutable');
    await expect(pg.query('DELETE FROM profile_document_request_ingestions WHERE file_id=$1',[file.fileId])).rejects.toThrow('immutable');
    await expect(pg.query('DELETE FROM profile_document_request_attachments WHERE file_id=$1',[file.fileId])).rejects.toThrow();
    const failure=await fixture('rollback-admission');const before=await count();
    await pg.exec(`CREATE FUNCTION reject_test_admission() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test parent write rejected'; END $$;
        CREATE TRIGGER reject_test_admission BEFORE UPDATE ON profile_document_requests FOR EACH ROW WHEN (NEW.request_id='${failure.request.requestId}') EXECUTE FUNCTION reject_test_admission();`);
    try {await expect(admissions().reserve(failure.request.requestId,failure.file.fileId,'owner-a',3,input)).rejects.toMatchObject({cause:{message:'test parent write rejected'}});}
    finally {await pg.exec('DROP TRIGGER reject_test_admission ON profile_document_requests; DROP FUNCTION reject_test_admission();');}
    expect(await count()).toBe(before);expect(await admissions().get(failure.request.requestId,failure.file.fileId)).toBeNull();
    expect((await requests().get(failure.request.requestId))?.revision).toBe(3);
});
it('migration is replayable and SQL FK cannot attach a financial admission to GENERAL metadata',async()=>{
    const {request,file}=await fixture('kind-fk-admission','GENERAL');
    await expect(pg.query(`INSERT INTO profile_document_request_ingestions(file_id,request_id,org_id,business_profile_id,advisor_user_id,doc_type,target_id,target_user_id,financial_year,admitted_by,admitted_revision)
        VALUES($1,$2,'org-a','profile-a','advisor-a','BANK_STATEMENT',$3,'owner-a','2026-27','owner-a',3)`,[file.fileId,request.requestId,'dsi_'+'e'.repeat(64)])).rejects.toThrow();
    const before=await count();for(const sql of splitStatements(readFileSync('drizzle/0069_profile_document_request_ingestions.sql','utf8')))await pg.query(sql);
    expect(await count()).toBe(before);expect(await runMigrations({exec:async sql=>({rows:(await pg.query(sql)).rows})})).toEqual([]);
});
it('an existing noncanonical target marker cannot become a successful replay or metadata result',async()=>{
    const {request,file}=await fixture('noncanonical-target');
    await pg.query(`INSERT INTO profile_document_request_ingestions(file_id,request_id,org_id,business_profile_id,advisor_user_id,doc_type,target_id,target_user_id,financial_year,admitted_by,admitted_revision)
        VALUES($1,$2,'org-a','profile-a','advisor-a','BANK_STATEMENT',$3,'owner-a','2026-27','owner-a',3)`,[file.fileId,request.requestId,'dsi_'+'d'.repeat(64)]);
    const before=await count();
    await expect(admissions().reserve(request.requestId,file.fileId,'owner-a',3,input)).rejects.toThrow('target conflicts');
    await expect(admissions().get(request.requestId,file.fileId)).rejects.toThrow('target conflicts');
    expect(await count()).toBe(before);expect((await requests().get(request.requestId))?.revision).toBe(3);
});
