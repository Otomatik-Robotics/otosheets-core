import { and, eq, desc, ilike, or, lt, count } from 'drizzle-orm';
import { createHash } from 'crypto';
import { getPgTx, type PgDb } from '../pg/client';
import { workflowDefinitions as defs, workflowVersions as versions } from '../pg/schema/workflows';
import { clean, workflowScope, pageLimit, pageToken, nextPage } from '../workflowRuntime/pgHelpers';
import type { WorkflowPageOptions } from '../workflowRuntime/page';
import type { OnboardingWorkflow } from './schema';
import type { WorkflowDefinitionVersion, IOnboardingWorkflowRepo } from './repo';
const where = (orgId: string, workflowId: string) => and(eq(defs.orgId, workflowScope(orgId)), eq(defs.workflowId, workflowId));
const versionWhere = (orgId: string, workflowId: string, version?: number) => and(eq(versions.orgId, workflowScope(orgId)), eq(versions.workflowId, workflowId), version === undefined ? undefined : eq(versions.version, version));
const row = (orgId: string, w: Record<string, any>) => ({ businessProfileId: w.businessProfileId ?? null, orgId: workflowScope(orgId), workflowId: w.workflowId, name: w.name, isActive: w.isActive, updatedAt: w.updatedAt, payload: clean({ ...w, orgId, sk: `WORKFLOW#${w.workflowId}` }) });
export class OnboardingWorkflowPgRepo implements IOnboardingWorkflowRepo {
    constructor(private readonly injected?: PgDb) {}
    private get db() { return this.injected ?? getPgTx(); }
    async get(orgId: string, workflowId: string): Promise<OnboardingWorkflow | null> { return (await this.db.select().from(defs).where(where(orgId, workflowId)))[0]?.payload as OnboardingWorkflow ?? null; }
    async getVersion(orgId: string, workflowId: string, version: number): Promise<WorkflowDefinitionVersion | null> { return (await this.db.select().from(versions).where(versionWhere(orgId, workflowId, version)))[0]?.payload as unknown as WorkflowDefinitionVersion ?? null; }
    async saveVersion(orgId: string, w: Omit<OnboardingWorkflow, 'orgId' | 'sk'>, expectedVersion: number, saveKey: string): Promise<{ status: 'saved' | 'replayed' | 'conflict'; version: number }> {
        workflowScope(orgId);
        if (!Number.isInteger(expectedVersion) || expectedVersion < 0 || expectedVersion >= 999999 || !saveKey.trim() || saveKey.length > 200) throw new Error('Invalid workflow save identity');
        const version = expectedVersion + 1;
        const fingerprint = createHash('sha256').update(JSON.stringify({ businessProfileId: w.businessProfileId, name: w.name, description: w.description, isActive: w.isActive, nodes: w.nodes, edges: w.edges })).digest('hex');
        return this.db.transaction(async tx => {
            // Serialise creation as well as updates, including a previously absent definition.
            await tx.execute((await import('drizzle-orm')).sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([orgId, w.workflowId])}, 0))`);
            const current = (await tx.select().from(defs).where(where(orgId, w.workflowId)).for('update'))[0]?.payload;
            if (current && current.businessProfileId !== w.businessProfileId) return { status: 'conflict', version };
            const existing = (await tx.select().from(versions).where(versionWhere(orgId, w.workflowId, version)))[0]?.payload;
            if (existing) return { status: existing.saveKey === saveKey && existing.fingerprint === fingerprint ? 'replayed' : 'conflict', version };
            if ((current?.currentVersion ?? 0) !== expectedVersion || current?.activeVersion !== w.activeVersion) return { status: 'conflict', version };
            const definition = row(orgId, { ...w, currentVersion: version });
            await tx.insert(defs).values(definition).onConflictDoUpdate({ target: [defs.orgId, defs.workflowId], set: definition });
            const payload = clean({ businessProfileId: w.businessProfileId, orgId, workflowId: w.workflowId, version, nodes: w.nodes, edges: w.edges, createdAt: w.updatedAt, createdBy: w.updatedBy ?? w.createdBy ?? '', saveKey, fingerprint, sk: `VERSION#${w.workflowId}#${String(version).padStart(6, '0')}` });
            await tx.insert(versions).values({ businessProfileId: w.businessProfileId ?? null, orgId, workflowId: w.workflowId, version, payload });
            return { status: 'saved', version };
        });
    }
    async activateVersion(orgId: string, workflowId: string, version: number, userId: string, now: string): Promise<boolean> {
        return this.db.transaction(async tx => {
            const current = (await tx.select().from(defs).where(where(orgId, workflowId)).for('update'))[0]?.payload;
            if (current?.currentVersion !== version || !(await tx.select().from(versions).where(versionWhere(orgId, workflowId, version))).length) return false;
            await tx.update(defs).set(row(orgId, { ...current, activeVersion: version, isActive: true, updatedBy: userId, updatedAt: now })).where(where(orgId, workflowId)); return true;
        });
    }
    async listPage(orgId: string, options: WorkflowPageOptions & { search?: string; isActive?: boolean } = {}) {
        workflowScope(orgId); const scope = [orgId, 'definitions', options.businessProfileId ?? null, options.search ?? null, options.isActive ?? null]; const key = pageToken(options.nextToken, scope); const limit = pageLimit(options.limit);
        const rows = await this.db.select().from(defs).where(and(eq(defs.orgId, orgId), options.businessProfileId ? eq(defs.businessProfileId, options.businessProfileId) : undefined, options.search ? ilike(defs.name, `%${options.search.replace(/[\\%_]/g, '\\$&')}%`) : undefined, options.isActive === undefined ? undefined : eq(defs.isActive, options.isActive), key ? or(lt(defs.updatedAt, key[0]), and(eq(defs.updatedAt, key[0]), lt(defs.workflowId, key[1]))) : undefined)).orderBy(desc(defs.updatedAt), desc(defs.workflowId)).limit(limit + 1);
        const items = rows.slice(0, limit); const last = items.at(-1); return { items: items.map(r => r.payload as OnboardingWorkflow), ...(rows.length > limit && last ? { nextToken: nextPage(scope, [last.updatedAt, last.workflowId]) } : {}) };
    }
    async listVersionsPage(orgId: string, workflowId: string, options: WorkflowPageOptions = {}) {
        const scope = [orgId, 'versions', workflowId, options.businessProfileId ?? null]; const key = pageToken(options.nextToken, scope); const limit = pageLimit(options.limit);
        const rows = await this.db.select().from(versions).where(and(versionWhere(orgId, workflowId), options.businessProfileId ? eq(versions.businessProfileId, options.businessProfileId) : undefined, key ? lt(versions.version, key[0]) : undefined)).orderBy(desc(versions.version)).limit(limit + 1);
        const items = rows.slice(0, limit); return { items: items.map(r => r.payload as unknown as WorkflowDefinitionVersion), ...(rows.length > limit ? { nextToken: nextPage(scope, [items.at(-1)!.version]) } : {}) };
    }
    async list(orgId: string, businessProfileId?: string): Promise<OnboardingWorkflow[]> { return (await this.db.select().from(defs).where(and(eq(defs.orgId, workflowScope(orgId)), businessProfileId ? eq(defs.businessProfileId, businessProfileId) : undefined))).map(r => r.payload as OnboardingWorkflow); }
    async countByOrg(orgId: string, businessProfileId?: string): Promise<number> { return Number((await this.db.select({ value: count() }).from(defs).where(and(eq(defs.orgId, workflowScope(orgId)), businessProfileId ? eq(defs.businessProfileId, businessProfileId) : undefined)))[0].value); }
    async put(orgId: string, w: Omit<OnboardingWorkflow, 'orgId' | 'sk'>): Promise<void> { const value = row(orgId, w); await this.db.insert(defs).values(value).onConflictDoUpdate({ target: [defs.orgId, defs.workflowId], set: value }); }
    async delete(orgId: string, workflowId: string): Promise<void> { await this.db.delete(defs).where(where(orgId, workflowId)); }
}
