import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { Team } from './schema';

/** Store-agnostic contract — implemented by TeamDynamoRepo and TeamPgRepo; TeamRepo (factory.ts) routes between them. */
export interface ITeamRepo {
    getTeam(orgId: string, teamId: string): Promise<Team | null>;
    listTeams(orgId: string): Promise<Team[]>;
    createTeam(orgId: string, teamId: string, data: Record<string, any>): Promise<void>;
    updateTeam(orgId: string, teamId: string, updates: Record<string, any>): Promise<void>;
    deleteTeam(orgId: string, teamId: string): Promise<void>;
    /** Full-entity mirror upsert used by the dual-write router (plan §6.1). */
    upsertTeam(team: Team): Promise<void>;
}

export class TeamDynamoRepo implements ITeamRepo {
    constructor(private ddb: IDdb) {}

    async upsertTeam(team: Team): Promise<void> {
        await this.ddb.put(Tables.TEAMS, team);
    }

    async getTeam(orgId: string, teamId: string): Promise<Team | null> {
        const { Item } = await this.ddb.getItem(Tables.TEAMS, { orgId, teamId });
        return (Item as Team) ?? null;
    }

    async listTeams(orgId: string): Promise<Team[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.TEAMS,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
        });
        return (Items as Team[]) ?? [];
    }

    async createTeam(orgId: string, teamId: string, data: Record<string, any>): Promise<void> {
        await this.ddb.put(Tables.TEAMS, {
            orgId,
            teamId,
            memberIds: [],
            ...data,
            createdAt: new Date().toISOString(),
        });
    }

    async updateTeam(orgId: string, teamId: string, updates: Record<string, any>): Promise<void> {
        const sets: string[] = [];
        const names: Record<string, string> = {};
        const values: Record<string, any> = {};

        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }

        await this.ddb.update(Tables.TEAMS, { orgId, teamId }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }

    async deleteTeam(orgId: string, teamId: string): Promise<void> {
        await this.ddb.delete(Tables.TEAMS, { orgId, teamId });
    }
}
