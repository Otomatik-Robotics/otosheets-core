import { resolveRoute, type Route } from '../dataBackend';
import { mirrorWrite, shadowRead } from '../dualWrite';
import { ddb } from '../ddbClient';
import { Organization } from './schema';
import { OrgRepo, type IOrgRepo } from './repo';
import { OrgPgRepo } from './repo.pg';

const DOMAIN = 'identity' as const;
const ENTITY = 'org';

/** State-machine router for orgs — see user/factory.ts for the pattern notes. */
export class RoutingOrgRepo implements IOrgRepo {
    constructor(private dynamo: IOrgRepo, private pg: IOrgRepo) {}

    private pick(route: Route): IOrgRepo {
        return route.primary === 'dynamo' ? this.dynamo : this.pg;
    }

    private mirrorOf(route: Route): IOrgRepo | undefined {
        if (!route.mirror) return undefined;
        return route.mirror === 'dynamo' ? this.dynamo : this.pg;
    }

    private async mirrorEntity(route: Route, orgId: string, op: string): Promise<void> {
        const mirror = this.mirrorOf(route);
        if (!mirror) return;
        await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op, key: { orgId } }, async () => {
            const fresh = await this.pick(route).getOrg(orgId);
            if (fresh) await mirror.upsertOrg(fresh);
        });
    }

    async getOrg(orgId: string): Promise<Organization | null> {
        const route = await resolveRoute(DOMAIN);
        const result = await this.pick(route).getOrg(orgId);
        if (route.shadow) {
            await shadowRead({ domain: DOMAIN, entity: ENTITY, op: 'getOrg' }, result, () => this.pg.getOrg(orgId));
        }
        return result;
    }

    async getOrgBySlug(slug: string): Promise<Organization | null> {
        const route = await resolveRoute(DOMAIN);
        const result = await this.pick(route).getOrgBySlug(slug);
        if (route.shadow) {
            await shadowRead({ domain: DOMAIN, entity: ENTITY, op: 'getOrgBySlug' }, result, () => this.pg.getOrgBySlug(slug));
        }
        return result;
    }

    async createOrg(orgId: string, data: Record<string, any>): Promise<void> {
        const route = await resolveRoute(DOMAIN);
        await this.pick(route).createOrg(orgId, data);
        await this.mirrorEntity(route, orgId, 'createOrg');
    }

    async updateOrg(orgId: string, updates: Record<string, any>): Promise<void> {
        const route = await resolveRoute(DOMAIN);
        await this.pick(route).updateOrg(orgId, updates);
        await this.mirrorEntity(route, orgId, 'updateOrg');
    }

    async upsertOrg(org: Organization): Promise<void> {
        const route = await resolveRoute(DOMAIN);
        await this.pick(route).upsertOrg(org);
        const mirror = this.mirrorOf(route);
        if (mirror) {
            await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'upsertOrg', key: { orgId: org.orgId } }, () => mirror.upsertOrg(org));
        }
    }
}

let singleton: IOrgRepo | undefined;

export function getOrgRepo(): IOrgRepo {
    if (!singleton) singleton = new RoutingOrgRepo(new OrgRepo(ddb), new OrgPgRepo());
    return singleton;
}
