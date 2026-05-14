"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookingRepo = void 0;
const tables_1 = require("../tables");
const keys_1 = require("../keys");
class BookingRepo {
    ddb;
    constructor(ddb) {
        this.ddb = ddb;
    }
    async getBooking(orgId, userId, bookingId) {
        const { Item } = await this.ddb.getItem(tables_1.Tables.BOOKINGS, { orgId, sk: (0, keys_1.sk)(userId, bookingId) });
        return Item ?? null;
    }
    async listAllOrgBookings(orgId) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.BOOKINGS,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
        });
        return Items ?? [];
    }
    async deleteBooking(orgId, userId, bookingId) {
        await this.ddb.delete(tables_1.Tables.BOOKINGS, { orgId, sk: (0, keys_1.sk)(userId, bookingId) });
    }
    async listBookingsByDate(orgId, from, to) {
        const { Items } = await this.ddb.query({
            TableName: tables_1.Tables.BOOKINGS,
            IndexName: 'DateIndex',
            KeyConditionExpression: 'orgId = :orgId AND dateSk BETWEEN :from AND :to',
            ExpressionAttributeValues: { ':orgId': orgId, ':from': from, ':to': `${to}￿` },
        });
        return Items ?? [];
    }
    async createBooking(orgId, userId, bookingId, data) {
        const now = new Date().toISOString();
        await this.ddb.put(tables_1.Tables.BOOKINGS, {
            orgId,
            sk: (0, keys_1.sk)(userId, bookingId),
            bookingId,
            createdBy: userId,
            ...data,
            dateSk: data.date ? (0, keys_1.dateSk)(data.date, bookingId) : undefined,
            createdAt: now,
            updatedAt: now,
        });
    }
    async updateBooking(orgId, userId, bookingId, updates) {
        const sets = ['#updatedAt = :updatedAt'];
        const names = { '#updatedAt': 'updatedAt' };
        const values = { ':updatedAt': new Date().toISOString() };
        if (updates.date) {
            updates.dateSk = (0, keys_1.dateSk)(updates.date, bookingId);
        }
        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }
        await this.ddb.update(tables_1.Tables.BOOKINGS, { orgId, sk: (0, keys_1.sk)(userId, bookingId) }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }
}
exports.BookingRepo = BookingRepo;
//# sourceMappingURL=repo.js.map