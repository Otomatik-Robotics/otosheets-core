import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { sk, dateSk } from '../keys';
import { Trip } from './schema';
import { PaginatedResult } from '../types';

/** Store-agnostic contract — TripDynamoRepo + TripPgRepo; TripRepo (factory) routes. */
export interface ITripRepo {
    getTrip(orgId: string, userId: string, tripId: string): Promise<Trip | null>;
    findTripByIdInOrg(orgId: string, tripId: string): Promise<{ trip: Trip; ownerId: string } | null>;
    listAllOrgTrips(orgId: string): Promise<Trip[]>;
    listUserTrips(orgId: string, userId: string): Promise<Trip[]>;
    listTripsByDate(orgId: string, from: string, to: string): Promise<Trip[]>;
    listOrgTripsPaginated(params: { orgId: string; businessProfileId?: string; limit?: number; exclusiveStartKey?: Record<string, any>; search?: string; purpose?: string; dateFrom?: string; dateTo?: string; }): Promise<PaginatedResult<Trip>>;
    createTrip(orgId: string, userId: string, tripId: string, data: Record<string, any>): Promise<void>;
    deleteTrip(orgId: string, userId: string, tripId: string): Promise<void>;
    upsertTrip(trip: Trip): Promise<void>;
}

export class TripDynamoRepo implements ITripRepo {
    constructor(private ddb: IDdb) {}

    async upsertTrip(trip: Trip): Promise<void> {
        await this.ddb.put(Tables.TRIPS, trip);
    }

    async getTrip(orgId: string, userId: string, tripId: string): Promise<Trip | null> {
        const { Item } = await this.ddb.getItem(Tables.TRIPS, { orgId, sk: sk(userId, tripId) });
        return (Item as Trip) ?? null;
    }

    async findTripByIdInOrg(orgId: string, tripId: string): Promise<{ trip: Trip; ownerId: string } | null> {
        const { Items } = await this.ddb.query({
            TableName: Tables.TRIPS,
            IndexName: 'TripIdIndex',
            KeyConditionExpression: 'orgId = :orgId AND tripId = :tripId',
            ExpressionAttributeValues: { ':orgId': orgId, ':tripId': tripId },
            Limit: 1,
        });
        const item = Items?.[0] as Trip | undefined;
        if (!item) return null;
        return { trip: item, ownerId: item.createdBy };
    }

    async listAllOrgTrips(orgId: string): Promise<Trip[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.TRIPS,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
        });
        return (Items as Trip[]) ?? [];
    }

    async listOrgTripsPaginated(params: {
        orgId: string;
        limit?: number;
        exclusiveStartKey?: Record<string, any>;
        search?: string;
        purpose?: string;
        dateFrom?: string;
        dateTo?: string;
    }): Promise<PaginatedResult<Trip>> {
        const { orgId, limit = 20, exclusiveStartKey, search, purpose, dateFrom, dateTo } = params;

        const filterParts: string[] = [];
        const names: Record<string, string> = {};
        const values: Record<string, any> = { ':orgId': orgId };

        if (search) {
            filterParts.push('(contains(#startAddress, :search) OR contains(#endAddress, :search))');
            names['#startAddress'] = 'startAddress';
            names['#endAddress'] = 'endAddress';
            values[':search'] = search;
        }
        if (purpose) {
            filterParts.push('#purpose = :purpose');
            names['#purpose'] = 'purpose';
            values[':purpose'] = purpose;
        }
        if (dateFrom) {
            filterParts.push('#date >= :dateFrom');
            names['#date'] = 'date';
            values[':dateFrom'] = dateFrom;
        }
        if (dateTo) {
            if (!names['#date']) names['#date'] = 'date';
            filterParts.push('#date <= :dateTo');
            values[':dateTo'] = dateTo;
        }

        const result = await this.ddb.query({
            TableName: Tables.TRIPS,
            IndexName: 'CreatedAtIndex',
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: values,
            ...(Object.keys(names).length > 0 && { ExpressionAttributeNames: names }),
            ...(filterParts.length > 0 && { FilterExpression: filterParts.join(' AND ') }),
            ScanIndexForward: false,
            Limit: limit,
            ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
        });

        return {
            items: (result.Items as Trip[]) ?? [],
            lastEvaluatedKey: result.LastEvaluatedKey,
        };
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
