import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { VoiceAgent } from './schema';

// Voice agents share the call-records table (PK orgId) under their own sk
// prefix — AGENT#{agentId} never collides with CALL#{leadId}#{callId}.
const skOf = (agentId: string) => `AGENT#${agentId}`;

export class VoiceAgentRepo {
    constructor(private ddb: IDdb) {}

    async get(orgId: string, agentId: string): Promise<VoiceAgent | null> {
        const { Item } = await this.ddb.getItem(Tables.CALL_RECORDS, { orgId, sk: skOf(agentId) });
        return (Item as VoiceAgent) ?? null;
    }

    async put(orgId: string, agentId: string, data: Partial<VoiceAgent>): Promise<void> {
        const now = new Date().toISOString();
        await this.ddb.put(Tables.CALL_RECORDS, {
            orgId,
            sk: skOf(agentId),
            agentId,
            ...data,
            createdAt: data.createdAt ?? now,
            updatedAt: now,
        });
    }

    /** Partial update — only the provided fields are set; key fields are never overwritten. */
    async update(orgId: string, agentId: string, fields: Partial<VoiceAgent>): Promise<void> {
        const entries = Object.entries(fields).filter(
            ([k, v]) => v !== undefined && !['orgId', 'sk', 'agentId', 'createdAt'].includes(k),
        );
        const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
        const values: Record<string, any> = { ':updatedAt': new Date().toISOString() };
        const sets = ['#updatedAt = :updatedAt'];
        for (const [k, v] of entries) {
            names[`#${k}`] = k;
            values[`:${k}`] = v;
            sets.push(`#${k} = :${k}`);
        }
        await this.ddb.update(Tables.CALL_RECORDS, { orgId, sk: skOf(agentId) }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }

    async list(orgId: string, limit = 50): Promise<VoiceAgent[]> {
        const result = await this.ddb.query({
            TableName: Tables.CALL_RECORDS,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': 'AGENT#' },
            Limit: limit,
        });
        return (result.Items as VoiceAgent[]) ?? [];
    }

    async delete(orgId: string, agentId: string): Promise<void> {
        await this.ddb.delete(Tables.CALL_RECORDS, { orgId, sk: skOf(agentId) });
    }
}
