import { IDdb } from '../ddbPort';
import { Tables } from '../tables';
import { sk, dateSk } from '../keys';
import { Booking } from './schema';

export class BookingRepo {
    constructor(private ddb: IDdb) {}

    async getBooking(orgId: string, userId: string, bookingId: string): Promise<Booking | null> {
        const { Item } = await this.ddb.getItem(Tables.BOOKINGS, { orgId, sk: sk(userId, bookingId) });
        return (Item as Booking) ?? null;
    }

    async findBookingByIdInOrg(orgId: string, bookingId: string): Promise<{ booking: Booking; ownerId: string } | null> {
        const { Items } = await this.ddb.query({
            TableName: Tables.BOOKINGS,
            IndexName: 'BookingIdIndex',
            KeyConditionExpression: 'orgId = :orgId AND bookingId = :bookingId',
            ExpressionAttributeValues: { ':orgId': orgId, ':bookingId': bookingId },
            Limit: 1,
        });
        const item = Items?.[0] as Booking | undefined;
        if (!item) return null;
        return { booking: item, ownerId: item.createdBy };
    }

    async listAllOrgBookings(orgId: string): Promise<Booking[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.BOOKINGS,
            KeyConditionExpression: 'orgId = :orgId',
            ExpressionAttributeValues: { ':orgId': orgId },
        });
        return (Items as Booking[]) ?? [];
    }

    async deleteBooking(orgId: string, userId: string, bookingId: string): Promise<void> {
        await this.ddb.delete(Tables.BOOKINGS, { orgId, sk: sk(userId, bookingId) });
    }

    async listBookingsByDate(orgId: string, from: string, to: string): Promise<Booking[]> {
        const { Items } = await this.ddb.query({
            TableName: Tables.BOOKINGS,
            IndexName: 'DateIndex',
            KeyConditionExpression: 'orgId = :orgId AND dateSk BETWEEN :from AND :to',
            ExpressionAttributeValues: { ':orgId': orgId, ':from': from, ':to': `${to}￿` },
        });
        return (Items as Booking[]) ?? [];
    }

    async createBooking(orgId: string, userId: string, bookingId: string, data: Record<string, any>): Promise<void> {
        const now = new Date().toISOString();
        await this.ddb.put(Tables.BOOKINGS, {
            orgId,
            sk: sk(userId, bookingId),
            bookingId,
            createdBy: userId,
            ...data,
            dateSk: data.date ? dateSk(data.date, bookingId) : undefined,
            createdAt: now,
            updatedAt: now,
        });
    }

    async updateBooking(orgId: string, userId: string, bookingId: string, updates: Record<string, any>): Promise<void> {
        const sets: string[] = ['#updatedAt = :updatedAt'];
        const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
        const values: Record<string, any> = { ':updatedAt': new Date().toISOString() };

        if (updates.date) {
            updates.dateSk = dateSk(updates.date, bookingId);
        }

        for (const [key, val] of Object.entries(updates)) {
            sets.push(`#${key} = :${key}`);
            names[`#${key}`] = key;
            values[`:${key}`] = val;
        }

        await this.ddb.update(Tables.BOOKINGS, { orgId, sk: sk(userId, bookingId) }, {
            UpdateExpression: `SET ${sets.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
        });
    }
}
