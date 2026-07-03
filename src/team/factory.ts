import { resolveRoute, type Route } from '../dataBackend';
import { mirrorWrite, shadowRead } from '../dualWrite';
import { ddb } from '../ddbClient';
import { Team } from './schema';
import { TeamRepo, type ITeamRepo } from './repo';
import { TeamPgRepo } from './repo.pg';

const DOMAIN = 'identity' as const;
const ENTITY = 'team';

/** State-machine router for teams — see user/factory.ts for the pattern notes. */
export class RoutingTeamRepo implements ITeamRepo {
    constructor(private dynamo: ITeamRepo, private pg: ITeamRepo) {}

    private pick(route: Route): ITeamRepo {
        return route.primary === 'dynamo' ? this.dynamo : this.pg;
    }

    private mirrorOf(route: Route): ITeamRepo | undefined {
        if (!route.mirror) return undefined;
        return route.mirror === 'dynamo' ? this.dynamo : this.pg;
    }

    private async mirrorEntity(route: Route, orgId: string, teamId: string, op: string): Promise<void> {
        const mirror = this.mirrorOf(route);
        if (!mirror) return;
        await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op, key: { orgId, teamId } }, async () => {
            const fresh = await this.pick(route).getTeam(orgId, teamId);
            if (fresh) await mirror.upsertTeam(fresh);
        });
    }

    async getTeam(orgId: string, teamId: string): Promise<Team | null> {
        const route = await resolveRoute(DOMAIN);
        const result = await this.pick(route).getTeam(orgId, teamId);
        if (route.shadow) {
            await shadowRead({ domain: DOMAIN, entity: ENTITY, op: 'getTeam' }, result, () => this.pg.getTeam(orgId, teamId));
        }
        return result;
    }

    async listTeams(orgId: string): Promise<Team[]> {
        const route = await resolveRoute(DOMAIN);
        const result = await this.pick(route).listTeams(orgId);
        if (route.shadow) {
            await shadowRead({ domain: DOMAIN, entity: ENTITY, op: 'listTeams' }, result, () => this.pg.listTeams(orgId));
        }
        return result;
    }

    async createTeam(orgId: string, teamId: string, data: Record<string, any>): Promise<void> {
        const route = await resolveRoute(DOMAIN);
        await this.pick(route).createTeam(orgId, teamId, data);
        await this.mirrorEntity(route, orgId, teamId, 'createTeam');
    }

    async updateTeam(orgId: string, teamId: string, updates: Record<string, any>): Promise<void> {
        const route = await resolveRoute(DOMAIN);
        await this.pick(route).updateTeam(orgId, teamId, updates);
        await this.mirrorEntity(route, orgId, teamId, 'updateTeam');
    }

    async deleteTeam(orgId: string, teamId: string): Promise<void> {
        const route = await resolveRoute(DOMAIN);
        await this.pick(route).deleteTeam(orgId, teamId);
        const mirror = this.mirrorOf(route);
        if (mirror) {
            await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'deleteTeam', key: { orgId, teamId } }, () => mirror.deleteTeam(orgId, teamId));
        }
    }

    async upsertTeam(team: Team): Promise<void> {
        const route = await resolveRoute(DOMAIN);
        await this.pick(route).upsertTeam(team);
        const mirror = this.mirrorOf(route);
        if (mirror) {
            await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'upsertTeam', key: { orgId: team.orgId, teamId: team.teamId } }, () => mirror.upsertTeam(team));
        }
    }
}

let singleton: ITeamRepo | undefined;

export function getTeamRepo(): ITeamRepo {
    if (!singleton) singleton = new RoutingTeamRepo(new TeamRepo(ddb), new TeamPgRepo());
    return singleton;
}
