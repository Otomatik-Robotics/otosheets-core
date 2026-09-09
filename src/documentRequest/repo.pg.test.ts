import { afterAll, beforeAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { readFileSync } from 'node:fs';
import { runMigrations, splitStatements } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import { ProfileDocumentRequestPgRepo, DocumentRequestConflict } from './repo.pg';
let pg:PGlite; let db:PgDb;
const repo=(org='org-a',profile='profile-a',advisor='advisor-a')=>new ProfileDocumentRequestPgRepo(org,profile,advisor,db);
const input=(key:string)=>({clientRequestKey:key,title:'Bank statement',dueDate:'2026-09-30',docType:'BANK_STATEMENT' as const});
const upload=(key='file-key-0001')=>({clientFileKey:key,fileName:'statement.pdf',contentType:'application/pdf' as const,sizeBytes:123,sha256:'a'.repeat(64)});
beforeAll(async()=>{
    pg=new PGlite({extensions:{pg_trgm}});
    await runMigrations({exec:async s=>({rows:(await pg.query(s)).rows})});db=drizzle(pg) as unknown as PgDb;
    await pg.exec("INSERT INTO orgs (org_id,name) VALUES ('org-a','A'),('org-b','B'); INSERT INTO business_profiles (org_id,business_profile_id) VALUES ('org-a','profile-a'),('org-a','profile-b'),('org-b','profile-foreign');");
},30000);
afterAll(async()=>{await pg.close();});
it('requires explicit scope, exact profile/org FK and strict input',async()=>{
    expect(()=>repo('','profile-a')).toThrow();
    await expect(repo('org-a','profile-foreign').create(input('foreign-0001'))).rejects.toThrow();
    await expect(repo().create({...input('invalid-0001'),dueDate:'2026-02-30'})).rejects.toThrow();
    await expect(repo().create({...input('invalid-0001'),orgId:'org-b'} as any)).rejects.toThrow();
    expect(await repo().list()).toEqual([]);
});
it('creation replay is stable and changed payload cannot overwrite or reopen',async()=>{
    const [first,replay]=await Promise.all([repo().create(input('replay-0001')),repo().create(input('replay-0001'))]);
    expect(first.requestId).toBe(replay.requestId);expect(first.revision).toBe(1);
    await expect(repo().create({...input('replay-0001'),title:'Different'})).rejects.toBeInstanceOf(DocumentRequestConflict);
    await repo().cancel(first.requestId,1);
    expect((await repo().create(input('replay-0001'))).status).toBe('CANCELLED');
});
it('direct reads, pages and cancel isolate profile, org and adviser',async()=>{
    const row=await repo().create(input('scope-0001'));
    for(const other of [repo('org-a','profile-b'),repo('org-b','profile-foreign'),repo('org-a','profile-a','advisor-b')]){
        expect(await other.get(row.requestId)).toBeNull();expect(await other.list()).toEqual([]);
        await expect(other.cancel(row.requestId,1)).rejects.toBeInstanceOf(DocumentRequestConflict);
    }
    const page=await repo().list(1);expect(page).toHaveLength(1);
    const next=await repo().list(1,page[0].requestId);expect(next[0].requestId).not.toBe(page[0].requestId);
    await expect(repo().list(101)).rejects.toThrow();await expect(repo().list(1,'foreign')).rejects.toThrow();
});
it('reservation binds immutable declared bytes to exact parent and stable uploader identity',async()=>{
    const parent=await repo().create(input('reserve-0001'));
    const file=await repo().reserveFile(parent.requestId,'owner-a',1,upload());
    expect(file).toMatchObject({orgId:'org-a',businessProfileId:'profile-a',advisorUserId:'advisor-a',uploadedBy:'owner-a',status:'RESERVED'});
    expect(file.fileKey).toBe(`doc-requests/org-a/profiles/profile-a/${parent.requestId}/${file.fileId}.pdf`);
    expect((await repo().get(parent.requestId))?.revision).toBe(2);
    expect((await repo().reserveFile(parent.requestId,'owner-a',1,upload())).fileId).toBe(file.fileId);
    expect((await repo().get(parent.requestId))?.revision).toBe(2);
    await expect(repo().reserveFile(parent.requestId,'owner-a',2,{...upload(),sha256:'b'.repeat(64)})).rejects.toBeInstanceOf(DocumentRequestConflict);
    await expect(repo().reserveFile(parent.requestId,'owner-a',2,{...upload('bad-file-0001'),fileKey:'foreign'} as any)).rejects.toThrow();
    for(const other of [repo('org-a','profile-b'),repo('org-b','profile-foreign'),repo('org-a','profile-a','advisor-b')]){
        expect(await other.getFile(parent.requestId,file.fileId)).toBeNull();
        await expect(other.reserveFile(parent.requestId,'owner-a',2,upload())).rejects.toThrow();
    }
    const otherParent=await repo().create(input('other-parent-0001'));
    expect(await repo().getFile(otherParent.requestId,file.fileId)).toBeNull();
});
it('concurrent distinct reservations use one revision winner without orphan file insertion',async()=>{
    const parent=await repo().create(input('concurrent-0001'));
    const result=await Promise.allSettled([
        repo().reserveFile(parent.requestId,'owner-a',1,upload('concurrent-file-a')),
        repo().reserveFile(parent.requestId,'owner-a',1,upload('concurrent-file-b')),
    ]);
    expect(result.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect((await pg.query<{count:number}>('SELECT count(*)::int FROM profile_document_request_files WHERE request_id=$1',[parent.requestId])).rows[0].count).toBe(1);
    expect((await repo().get(parent.requestId))?.revision).toBe(2);
});
it('cancel and reserve serialize on parent and cannot reopen a closed request',async()=>{
    const parent=await repo().create(input('cancel-first-0001'));
    await repo().cancel(parent.requestId,1);
    await expect(repo().reserveFile(parent.requestId,'owner-a',2,upload())).rejects.toThrow();
    await expect(repo().cancel(parent.requestId,2)).rejects.toThrow();
    const open=await repo().create(input('reserve-first-0001'));
    await repo().reserveFile(open.requestId,'owner-a',1,upload());
    await expect(repo().cancel(open.requestId,1)).rejects.toThrow();
    await repo().cancel(open.requestId,2);
    await expect(repo().reserveFile(open.requestId,'owner-a',1,upload())).rejects.toThrow();
});
it('parent revision failure rolls back the inserted reservation in the same transaction',async()=>{
    const parent=await repo().create(input('rollback-0001'));
    await pg.exec("CREATE FUNCTION test_docrequest_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated storage failure'; END $$; CREATE TRIGGER test_docrequest_fail BEFORE UPDATE ON profile_document_requests FOR EACH ROW EXECUTE FUNCTION test_docrequest_fail();");
    try { await expect(repo().reserveFile(parent.requestId,'owner-a',1,upload())).rejects.toThrow(); }
    finally { await pg.exec('DROP TRIGGER test_docrequest_fail ON profile_document_requests; DROP FUNCTION test_docrequest_fail();'); }
    expect((await pg.query<{count:number}>('SELECT count(*)::int FROM profile_document_request_files WHERE request_id=$1',[parent.requestId])).rows[0].count).toBe(0);
    expect((await repo().get(parent.requestId))?.revision).toBe(1);
});
it('SQL blocks ownership, payload, revision and reservation mutation and migration replays safely',async()=>{
    const parent=await repo().create(input('sql-0001'));const file=await repo().reserveFile(parent.requestId,'owner-a',1,upload());
    for(const change of ["business_profile_id='profile-b',revision=revision+1","advisor_user_id='advisor-b',revision=revision+1","title='changed',revision=revision+1","revision=revision+2"]){
        await expect(pg.query(`UPDATE profile_document_requests SET ${change} WHERE request_id=$1`,[parent.requestId])).rejects.toThrow();
    }
    await expect(pg.query("UPDATE profile_document_request_files SET sha256=$1 WHERE file_id=$2",['b'.repeat(64),file.fileId])).rejects.toThrow();
    for(const statement of splitStatements(readFileSync('drizzle/0066_profile_document_requests.sql','utf8')))await pg.query(statement);
    expect((await repo().getFile(parent.requestId,file.fileId))?.sha256).toBe('a'.repeat(64));
});
