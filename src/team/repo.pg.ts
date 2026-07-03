import { and, eq, inArray } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { teams, teamMembers } from '../pg/schema/identity';
import { toRow, fromRow } from '../pg/rows';
import { Team } from './schema';
import type { ITeamRepo } from './repo';

/**
 * The Team DTO carries `memberIds: string[]`; relationally that lives in the
 * team_members junction table (plan §4), so reads aggregate it back and
 * writes that include `memberIds` replace the junction rows.
 */
export class TeamPgRepo implements ITeamRepo {
    constructor(private injected?: PgDb) {}

    private get db(): PgDb {
        return this.injected ?? getPg();
    }

    private async memberIdsByTeam(teamIds: string[]): Promise<Map<string, string[]>> {
        const map = new Map<string, string[]>();
        if (teamIds.length === 0) return map;
        const rows = await this.db.select().from(teamMembers)
            .where(inArray(teamMembers.teamId, teamIds))
            .orderBy(teamMembers.sortOrder);
        for (const row of rows as any[]) {
            const list = map.get(row.teamId) ?? [];
            list.push(row.memberId);
            map.set(row.teamId, list);
        }
        return map;
    }

    private async replaceMembers(teamId: string, memberIds: string[]): Promise<void> {
        await this.db.delete(teamMembers).where(eq(teamMembers.teamId, teamId));
        if (memberIds.length > 0) {
            await this.db.insert(teamMembers).values(
                memberIds.map((memberId, i) => ({ teamId, memberId, sortOrder: i })),
            );
        }
    }

    async getTeam(orgId: string, teamId: string): Promise<Team | null> {
        const rows = await this.db.select().from(teams)
            .where(and(eq(teams.orgId, orgId), eq(teams.teamId, teamId)))
            .limit(1);
        if (!rows[0]) return null;
        const members = await this.memberIdsByTeam([teamId]);
        return { ...fromRow<Team>(rows[0]), memberIds: members.get(teamId) ?? [] };
    }

    async listTeams(orgId: string): Promise<Team[]> {
        const rows = await this.db.select().from(teams).where(eq(teams.orgId, orgId));
        const members = await this.memberIdsByTeam(rows.map((r: any) => r.teamId));
        return rows.map((r: any) => ({ ...fromRow<Team>(r), memberIds: members.get(r.teamId) ?? [] }));
    }

    async createTeam(orgId: string, teamId: string, data: Record<string, any>): Promise<void> {
        const { memberIds, ...rest } = data;
        await this.db.insert(teams).values({
            ...toRow(teams, rest, 'team'),
            orgId,
            teamId,
            createdAt: new Date(),
        } as any);
        if (Array.isArray(memberIds) && memberIds.length > 0) {
            await this.replaceMembers(teamId, memberIds);
        }
    }

    async updateTeam(orgId: string, teamId: string, updates: Record<string, any>): Promise<void> {
        const { memberIds, ...rest } = updates;
        if (Object.keys(rest).length > 0) {
            await this.db.update(teams)
                .set(toRow(teams, rest, 'team') as any)
                .where(and(eq(teams.orgId, orgId), eq(teams.teamId, teamId)));
        }
        if (Array.isArray(memberIds)) {
            await this.replaceMembers(teamId, memberIds);
        }
    }

    async deleteTeam(orgId: string, teamId: string): Promise<void> {
        await this.db.delete(teams)
            .where(and(eq(teams.orgId, orgId), eq(teams.teamId, teamId)));
    }

    /** Full-entity mirror upsert — teams have no updatedAt, so last mirror wins. */
    async upsertTeam(team: Team): Promise<void> {
        const { memberIds, ...rest } = team as Record<string, any>;
        const row = toRow(teams, rest, 'team');
        await this.db.insert(teams)
            .values(row as any)
            .onConflictDoUpdate({ target: teams.teamId, set: row as any });
        await this.replaceMembers(team.teamId, Array.isArray(memberIds) ? memberIds : []);
    }
}
