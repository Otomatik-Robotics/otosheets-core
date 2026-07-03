import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { Membership } from './schema';

/** Store-agnostic contract — implemented by MembershipRepo (Dynamo) and MembershipPgRepo. */
export interface IMembershipRepo {
    getMembership(orgId: string, userId: string): Promise<Membership | null>;
    listOrgMembers(orgId: string): Promise<Membership[]>;
    listUserOrgs(userId: string): Promise<Membership[]>;
    getByInviteToken(token: string): Promise<Membership | null>;
    createMembership(orgId: string, userId: string, data: Record<string, any>): Promise<void>;
    updateMembership(orgId: string, userId: string, updates: Record<string, any>): Promise<void>;
    deleteMembership(orgId: string, userId: string): Promise<void>;
    /** Full-entity mirror upsert used by the dual-write router (plan §6.1). */
    upsertMembership(membership: Membership): Promise<void>;
}

export class MembershipRepo implements IMembershipRepo {
    constructor(private ddb: IDdb) {}

    async upsertMembership(membership: Membership): Promise<void> {
        await this.ddb.put(Tables.MEMBERSHIPS, membership);
    }

    async getMembership(orgId: string, userId: string): Promise<Membership | null> {
        const { Item } = await this.ddb.getItem(Tables.MEMBERSHIPS, { orgId, userId });
        return (Item as Membership) ?? null;
    }

    async listOrgMembers(orgId: string): Promise<Membership[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.MEMBERSHIPS,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
        });
        return (Items as Membership[]) ?? [];
    }

    async listUserOrgs(userId: string): Promise<Membership[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.MEMBERSHIPS,
            IndexName: 'UserOrgsIndex',
            KeyConditionExpression: 'userId = :userId',
            ExpressionAttributeValues: { ':userId': userId },
        });
        return (Items as Membership[]) ?? [];
    }

    async getByInviteToken(token: string): Promise<Membership | null> {
        const { Items } = await this.ddb.query({
            TableName: Tables.MEMBERSHIPS,
            IndexName: 'InviteTokenIndex',
            KeyConditionExpression: 'inviteToken = :token',
            ExpressionAttributeValues: { ':token': token },
            Limit: 1,
        });
        return (Items?.[0] as Membership) ?? null;
    }

    async createMembership(orgId: string, userId: string, data: Record<string, any>): Promise<void> {
        const now = new Date().toISOString();
        await this.ddb.put(Tables.MEMBERSHIPS, {
            orgId,
            userId,
            ...data,
            createdAt: now,
            updatedAt: now,
        });
    }

    async updateMembership(orgId: string, userId: string, updates: Record<string, any>): Promise<void> {
        const sets: string[] = ['#updatedAt = :updatedAt'];
        const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
        const values: Record<string, any> = { ':updatedAt': new Date().toISOString() };

        for (const [key, val] of Object.entries(updates)) {
            const attr = `#${key}`;
            const placeholder = `:${key}`;
            sets.push(`${attr} = ${placeholder}`);
            names[attr] = key;
            values[placeholder] = val;
        }

        await this.ddb.update(Tables.MEMBERSHIPS, { orgId, userId }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }

    async deleteMembership(orgId: string, userId: string): Promise<void> {
        await this.ddb.delete(Tables.MEMBERSHIPS, { orgId, userId });
    }
}
