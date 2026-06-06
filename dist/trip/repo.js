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