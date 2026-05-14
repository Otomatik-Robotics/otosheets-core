"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TeamRepo = void 0;
const tables_1 = require("../tables");
class TeamRepo {
    ddb;
    constructor(ddb) {
        this.ddb = ddb;
    }
    async getTeam(orgId, teamId) {
        const { Item } = await this.ddb.getItem(tables_1.Tables.TEAMS, { orgId, teamId });
        return Item ?? null;
    }
    async listTeams(orgId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.TEAMS,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
        });
        return Items ?? [];
    }
    async createTeam(orgId, teamId, data) {
        await this.ddb.put(tables_1.Tables.TEAMS, {
            orgId,
            teamId,
            memberIds: [],
            ...data,
            createdAt: new Date().toISOString(),
        });
    }
    async updateTeam(orgId, teamId, updates) {
        const sets = [];
        const names = {};
        const values = {};
        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }
        await this.ddb.update(tables_1.Tables.TEAMS, { orgId, teamId }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }
    async deleteTeam(orgId, teamId) {
        await this.ddb.delete(tables_1.Tables.TEAMS, { orgId, teamId });
    }
}
exports.TeamRepo = TeamRepo;
//# sourceMappingURL=repo.js.map