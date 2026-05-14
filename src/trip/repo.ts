import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { sk, dateSk } from '../keys';
import { Trip } from './schema';

export class TripRepo {
    constructor(private ddb: IDdb) {}

    async getTrip(orgId: string, userId: string, tripId: string): Promise<Trip | null> {
        const { Item } = await this.ddb.getItem(Tables.TRIPS, { orgId, sk: sk(userId, tripId) });
        return (Item as Trip) ?? null;
    }

    async listAllOrgTrips(orgId: string): Promise<Trip[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.TRIPS,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
        });
        return (Items as Trip[]) ?? [];
    }

    async listUserTrips(orgId: string, userId: string): Promise<Trip[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.TRIPS,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': `${userId}#` },
        });
        return (Items as Trip[]) ?? [];
    }

    async listTripsByDate(orgId: string, from: string, to: string): Promise<Trip[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.TRIPS,
            IndexName: 'DateIndex',
            KeyConditionExpression: 'orgId = :orgId AND dateSk BETWEEN :from AND :to',
            ExpressionAttributeValues: { ':orgId': orgId, ':from': from, ':to': `${to}￿` },
        });
        return (Items as Trip[]) ?? [];
    }

    async createTrip(orgId: string, userId: string, tripId: string, data: Record<string, any>): Promise<void> {
        const now = new Date().toISOString();
        await this.ddb.put(Tables.TRIPS, {
            orgId,
            sk: sk(userId, tripId),
            tripId,
            createdBy: userId,
            ...data,
            dateSk: data.date ? dateSk(data.date, tripId) : undefined,
            createdAt: now,
        });
    }

    async deleteTrip(orgId: string, userId: string, tripId: string): Promise<void> {
        await this.ddb.delete(Tables.TRIPS, { orgId, sk: sk(userId, tripId) });
    }
}
