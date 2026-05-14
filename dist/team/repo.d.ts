import { IDdb } from '../ddbPort';
import { Team } from './schema';
export declare class TeamRepo {
    private ddb;
    constructor(ddb: IDdb);
    getTeam(orgId: string, teamId: string): Promise<Team | null>;
    listTeams(orgId: string): Promise<Team[]>;
    createTeam(orgId: string, teamId: string, data: Record<string, any>): Promise<void>;
    updateTeam(orgId: string, teamId: string, updates: Record<string, any>): Promise<void>;
    deleteTeam(orgId: string, teamId: string): Promise<void>;
}
//# sourceMappingURL=repo.d.ts.map