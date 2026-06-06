"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TripRepo = void 0;
const tables_1 = require("../tables");
const keys_1 = require("../keys");
class TripRepo {
    ddb;
    constructor(ddb) {
        this.ddb = ddb;
    }
    async getTrip(orgId, userId, tripId) {
        const { Item } = await this.ddb.getItem(tables_1.Tables.TRIPS, { orgId, sk: (0, keys_1.sk)(userId, tripId) });
        return Item ?? null;
    }
    async findTripByIdInOrg(orgId, tripId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.TRIPS,
            IndexName: 'TripIdIndex',
            KeyConditionExpression: 'orgId = :orgId AND tripId = :tripId',
            ExpressionAttributeValues: { ':orgId': orgId, ':tripId': tripId },
            Limit: 1,
        });
        const item = Items?.[0];
        if (!item)
            return null;
        return { trip: item, ownerId: item.createdBy };
    }
    async listAllOrgTrips(orgId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.TRIPS,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
        });
        return Items ?? [];
    }
    async listOrgTripsPaginated(params) {
        const { orgId, limit = 20, exclusiveStartKey, search, purpose, dateFrom, dateTo } = params;
        const filterParts = [];
        const names = {};
        const values = { ':orgId': orgId };
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
            if (!names['#date'])
                names['#date'] = 'date';
            filterParts.push('#date <= :dateTo');
            values[':dateTo'] = dateTo;
        }
        const result = await this.ddb.query({
            TableName: tables_1.Tables.TRIPS,
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
            items: result.Items ?? [],
            lastEvaluatedKey: result.LastEvaluatedKey,
        };
    }
    async listUserTrips(orgId, userId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.TRIPS,
            KeyConditionExpression: 'orgId = :orgId AND begins_with(sk, :prefix)',
            ExpressionAttributeValues: { ':orgId': orgId, ':prefix': `${userId}#` },
        });
        return Items ?? [];
    }
    async listTripsByDate(orgId, from, to) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.TRIPS,
            IndexName: 'DateIndex',
            KeyConditionExpression: 'orgId = :orgId AND dateSk BETWEEN :from AND :to',
            ExpressionAttributeValues: { ':orgId': orgId, ':from': from, ':to': `${to}￿` },
        });
        return Items ?? [];
    }
    async createTrip(orgId, userId, tripId, data) {
        const now = new Date().toISOString();
        await this.ddb.put(tables_1.Tables.TRIPS, {
            orgId,
            sk: (0, keys_1.sk)(userId, tripId),
            tripId,
            createdBy: userId,
            ...data,
            dateSk: data.date ? (0, keys_1.dateSk)(data.date, tripId) : undefined,
            createdAt: now,
        });
    }
    async deleteTrip(orgId, userId, tripId) {
        await this.ddb.delete(tables_1.Tables.TRIPS, { orgId, sk: (0, keys_1.sk)(userId, tripId) });
    }
}
exports.TripRepo = TripRepo;
//# sourceMappingURL=repo.js.map