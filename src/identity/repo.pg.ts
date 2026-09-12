import { eq } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { orgs } from '../pg/schema/identity';
import { toRow, fromRow } from '../pg/rows';
import { OrgIdentitySchema, type OrgIdentity, type OrgIdentityUpdate } from './schema';

const NUMERIC_KEYS = ['taxRate'];

/** The identity's own columns on `orgs`: what a read returns and a write may touch. */
export const IDENTITY_KEYS = Object.keys(OrgIdentitySchema.shape).filter(k => !['orgId', 'createdAt', 'updatedAt'].includes(k));

/**
 * Postgres-only identity accessors on the organisation row. Identity never had
 * a Dynamo mirror and gets none now: the Dynamo `orgs` item keeps its legacy
 * attributes untouched.
 */
export class IdentityPgRepo {
    constructor(private injected?: PgDb) {}

    private get db(): PgDb {
        return this.injected ?? getPg();
    }

    async get(orgId: string): Promise<OrgIdentity | null> {
        const rows = await this.db.select().from(orgs).where(eq(orgs.orgId, orgId)).limit(1);
        if (!rows[0]) return null;
        const row = fromRow<Record<string, any>>(rows[0], NUMERIC_KEYS);
        const identity: Record<string, any> = { orgId: row.orgId, createdAt: row.createdAt, updatedAt: row.updatedAt };
        for (const key of IDENTITY_KEYS) identity[key] = row[key] ?? null;
        return identity as OrgIdentity;
    }

    /** Merge the given facts onto the organisation. Unknown keys are dropped. */
    async update(orgId: string, updates: OrgIdentityUpdate & Record<string, unknown>): Promise<void> {
        const allowed: Record<string, unknown> = {};
        for (const key of IDENTITY_KEYS) if (key in updates) allowed[key] = (updates as any)[key];
        await this.db.update(orgs)
            .set({ ...toRow(orgs, allowed, 'org'), updatedAt: new Date() } as any)
            .where(eq(orgs.orgId, orgId));
    }
}

export class IdentityRepo extends IdentityPgRepo {}

let singleton: IdentityRepo | undefined;
export function getIdentityRepo(): IdentityRepo {
    if (!singleton) singleton = new IdentityRepo();
    return singleton;
}
