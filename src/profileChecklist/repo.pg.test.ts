import { afterAll, beforeAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { readFileSync } from 'node:fs';
import { runMigrations, splitStatements } from '../pg/migrate';
import type { PgDb } from '../pg/client';
import { ProfileChecklistPgRepo, ProfileChecklistConflict } from './repo.pg';
let pg:PGlite;let db:PgDb;
const repo=(org='org-a',profile='profile-a')=>new ProfileChecklistPgRepo(org,profile,db);
beforeAll(async()=>{
    pg=new PGlite({extensions:{pg_trgm}});await runMigrations({exec:async s=>({rows:(await pg.query(s)).rows})});db=drizzle(pg) as unknown as PgDb;
    await pg.exec("INSERT INTO orgs (org_id,name) VALUES ('org-a','A'),('org-b','B'); INSERT INTO business_profiles (org_id,business_profile_id) VALUES ('org-a','profile-a'),('org-a','profile-b'),('org-b','profile-foreign');");
},30000);
afterAll(async()=>{await pg.close();});
it('returns immutable static defaults without creating database ownership on GET',async()=>{
    const first=await repo().list();expect(first).toHaveLength(4);expect(first.every(i=>!i.done&&i.revision===0)).toBe(true);
    first[0].label='mutated';expect((await repo().list())[0].label).toBe('ABN registered');
    expect((await pg.query<{count:number}>('SELECT count(*)::int FROM profile_setup_checklist')).rows[0].count).toBe(0);
});
it('requires explicit valid profile/org and rejects body ownership/actor overrides',async()=>{
    expect(()=>repo('', 'profile-a')).toThrow();await expect(repo('org-a','profile-foreign').list()).rejects.toThrow();
    await expect(repo('org-a','profile-foreign').set('actor',{itemId:'abn',done:true,expectedRevision:0})).rejects.toThrow();
    await expect(repo().set('',{itemId:'abn',done:true,expectedRevision:0})).rejects.toThrow();
    await expect(repo().set('actor',{itemId:'abn',done:true,expectedRevision:0,orgId:'org-b'} as any)).rejects.toThrow();
});
it('isolates each profile and stamps the trusted actor without inheriting org defaults',async()=>{
    await repo().set('advisor',{itemId:'abn',done:true,expectedRevision:0});
    expect((await repo().list())[0]).toMatchObject({done:true,revision:1,doneBy:'advisor',updatedBy:'advisor'});
    expect((await repo('org-a','profile-b').list())[0]).toMatchObject({done:false,revision:0});
    expect((await repo('org-b','profile-foreign').list())[0]).toMatchObject({done:false,revision:0});
    await expect(repo('org-a','profile-b').set('advisor',{itemId:'abn',done:false,expectedRevision:1})).rejects.toBeInstanceOf(ProfileChecklistConflict);
    expect((await repo().list())[0].done).toBe(true);
});
it('one concurrent initial write wins and stale revisions cannot overwrite it',async()=>{
    const result=await Promise.allSettled([repo().set('owner',{itemId:'gst',done:true,expectedRevision:0}),repo().set('advisor',{itemId:'gst',done:false,expectedRevision:0})]);
    expect(result.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    const row=(await repo().list()).find(i=>i.id==='gst')!;expect(row.revision).toBe(1);
    await expect(repo().set('owner',{itemId:'gst',done:!row.done,expectedRevision:0})).rejects.toBeInstanceOf(ProfileChecklistConflict);
    expect((await repo().list()).find(i=>i.id==='gst')?.done).toBe(row.done);
});
it('a fresh revision permits a second authorized actor to undo a shared item',async()=>{
    await repo().set('owner',{itemId:'abn',done:false,expectedRevision:1});
    expect((await repo().list())[0]).toMatchObject({done:false,revision:2,doneBy:null,doneAt:null,updatedBy:'owner'});
});
it('migration replay preserves rows and SQL rejects owner moves or revision skips',async()=>{
    for(const s of splitStatements(readFileSync('drizzle/0065_profile_setup_checklist.sql','utf8')))await pg.query(s);
    expect((await repo().list())[0].revision).toBe(2);
    await expect(pg.query("UPDATE profile_setup_checklist SET business_profile_id='profile-b',revision=revision+1 WHERE org_id='org-a' AND business_profile_id='profile-a' AND item_id='abn'")).rejects.toThrow();
    await expect(pg.query("UPDATE profile_setup_checklist SET revision=revision+2 WHERE org_id='org-a' AND business_profile_id='profile-a' AND item_id='abn'")).rejects.toThrow();
});
