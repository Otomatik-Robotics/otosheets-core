import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { Team } from './schema';

export class TeamRepo {
    constructor(private ddb: IDdb) {}

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
