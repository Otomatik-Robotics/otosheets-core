import { resolveRoute, type Route } from '../dataBackend';
import { mirrorWrite, shadowRead } from '../dualWrite';
import { ddb } from '../ddbClient';
import { Membership } from './schema';
import { MembershipRepo, type IMembershipRepo } from './repo';
import { MembershipPgRepo } from './repo.pg';

const DOMAIN = 'identity' as const;
const ENTITY = 'membership';

/** State-machine router for memberships — see user/factory.ts for the pattern notes. */
export class RoutingMembershipRepo implements IMembershipRepo {
    constructor(private dynamo: IMembershipRepo, private pg: IMembershipRepo) {}

    private pick(route: Route): IMembershipRepo {
        return route.primary === 'dynamo' ? this.dynamo : this.pg;
    }

    private mirrorOf(route: Route): IMembershipRepo | undefined {
        if (!route.mirror) return undefined;
        return route.mirror === 'dynamo' ? this.dynamo : this.pg;
    }

    private async mirrorEntity(route: Route, orgId: string, userId: string, op: string): Promise<void> {
        const mirror = this.mirrorOf(route);
        if (!mirror) return;
        await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op, key: { orgId, userId } }, async () => {
            const fresh = await this.pick(route).getMembership(orgId, userId);
            if (fresh) await mirror.upsertMembership(fresh);
        });
    }

    async getMembership(orgId: string, userId: string): Promise<Membership | null> {
        const route = await resolveRoute(DOMAIN);
        const result = await this.pick(route).getMembership(orgId, userId);
        if (route.shadow) {
            await shadowRead({ domain: DOMAIN, entity: ENTITY, op: 'getMembership' }, result, () => this.pg.getMembership(orgId, userId));
        }
        return result;
    }

    async listOrgMembers(orgId: string): Promise<Membership[]> {
        const route = await resolveRoute(DOMAIN);
        const result = await this.pick(route).listOrgMembers(orgId);
        if (route.shadow) {
            await shadowRead({ domain: DOMAIN, entity: ENTITY, op: 'listOrgMembers' }, result, () => this.pg.listOrgMembers(orgId));
        }
        return result;
    }

    async listUserOrgs(userId: string): Promise<Membership[]> {
        const route = await resolveRoute(DOMAIN);
        const result = await this.pick(route).listUserOrgs(userId);
        if (route.shadow) {
            await shadowRead({ domain: DOMAIN, entity: ENTITY, op: 'listUserOrgs' }, result, () => this.pg.listUserOrgs(userId));
        }
        return result;
    }

    async getByInviteToken(token: string): Promise<Membership | null> {
        const route = await resolveRoute(DOMAIN);
        const result = await this.pick(route).getByInviteToken(token);
        if (route.shadow) {
            await shadowRead({ domain: DOMAIN, entity: ENTITY, op: 'getByInviteToken' }, result, () => this.pg.getByInviteToken(token));
        }
        return result;
    }

    async createMembership(orgId: string, userId: string, data: Record<string, any>): Promise<void> {
        const route = await resolveRoute(DOMAIN);
        await this.pick(route).createMembership(orgId, userId, data);
        await this.mirrorEntity(route, orgId, userId, 'createMembership');
    }

    async updateMembership(orgId: string, userId: string, updates: Record<string, any>): Promise<void> {
        const route = await resolveRoute(DOMAIN);
        await this.pick(route).updateMembership(orgId, userId, updates);
        await this.mirrorEntity(route, orgId, userId, 'updateMembership');
    }

    async deleteMembership(orgId: string, userId: string): Promise<void> {
        const route = await resolveRoute(DOMAIN);
        await this.pick(route).deleteMembership(orgId, userId);
        const mirror = this.mirrorOf(route);
        if (mirror) {
            await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'deleteMembership', key: { orgId, userId } }, () => mirror.deleteMembership(orgId, userId));
        }
    }

    async upsertMembership(membership: Membership): Promise<void> {
        const route = await resolveRoute(DOMAIN);
        await this.pick(route).upsertMembership(membership);
        const mirror = this.mirrorOf(route);
        if (mirror) {
            await mirrorWrite(
                { domain: DOMAIN, entity: ENTITY, op: 'upsertMembership', key: { orgId: membership.orgId, userId: membership.userId } },
                () => mirror.upsertMembership(membership),
            );
        }
    }
}

let singleton: IMembershipRepo | undefined;

export function getMembershipRepo(): IMembershipRepo {
    if (!singleton) singleton = new RoutingMembershipRepo(new MembershipRepo(ddb), new MembershipPgRepo());
    return singleton;
}
