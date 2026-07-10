import { and, eq, sql, desc, lt, or, gte, lte } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { bookings } from '../pg/schema/leadsPipelines';
import { keysetFromStartKey, keysetStartKey } from '../pg/cursor';
import { dtoToRow, rowToDto, ownerFromSk } from '../pg/billingRows';
import { PaginatedResult } from '../types';
import { Booking } from './schema';
import type { IBookingRepo } from './repo';

const NUMERIC_KEYS: string[] = [];
const PG_ONLY = ['ownerId'];
const STRIP = ['sk', 'dateSk'];

function toDto(row: any): Booking {
    const dto = rowToDto<any>(row, NUMERIC_KEYS, PG_ONLY);
    dto.sk = `${row.ownerId}#${row.bookingId}`;
    if (row.date) dto.dateSk = `${row.date}#${row.bookingId}`;
    return dto as Booking;
}

export class BookingPgRepo implements IBookingRepo {
    constructor(private injected?: PgDb) {}
    private get db(): PgDb { return this.injected ?? getPg(); }

    async getBooking(orgId: string, _userId: string, bookingId: string): Promise<Booking | null> {
        const rows = await this.db.select().from(bookings).where(and(eq(bookings.orgId, orgId), eq(bookings.bookingId, bookingId))).limit(1);
        return rows[0] ? toDto(rows[0]) : null;
    }
    async findBookingByIdInOrg(orgId: string, bookingId: string): Promise<{ booking: Booking; ownerId: string } | null> {
        const rows = await this.db.select().from(bookings).where(and(eq(bookings.orgId, orgId), eq(bookings.bookingId, bookingId))).limit(1);
        if (!rows[0]) return null;
        return { booking: toDto(rows[0]), ownerId: (rows[0] as any).ownerId };
    }
    async listAllOrgBookings(orgId: string): Promise<Booking[]> {
        const rows = await this.db.select().from(bookings).where(eq(bookings.orgId, orgId));
        return rows.map(toDto);
    }
    async listOrgBookingsPaginated(params: { orgId: string; businessProfileId?: string; limit?: number; exclusiveStartKey?: Record<string, any>; status?: string; }): Promise<PaginatedResult<Booking>> {
        const { orgId, businessProfileId, limit = 20, exclusiveStartKey, status } = params;
        const conds: any[] = [eq(bookings.orgId, orgId)];
        if (businessProfileId) conds.push(eq(bookings.businessProfileId, businessProfileId));
        if (status) conds.push(eq(bookings.status, status));
        const cursor = keysetFromStartKey(exclusiveStartKey, 'bookingId');
        if (cursor) conds.push(or(lt(bookings.createdAt, new Date(cursor.createdAt)), and(eq(bookings.createdAt, new Date(cursor.createdAt)), lt(bookings.bookingId, cursor.id))));
        const rows = await this.db.select().from(bookings).where(and(...conds)).orderBy(desc(bookings.createdAt), desc(bookings.bookingId)).limit(limit);
        const last = rows[rows.length - 1] as any;
        const lastEvaluatedKey = rows.length === limit && last ? keysetStartKey({ createdAt: (last.createdAt as Date).toISOString(), id: last.bookingId }) : undefined;
        return { items: rows.map(toDto), lastEvaluatedKey };
    }
    async listBookingsByDate(orgId: string, from: string, to: string): Promise<Booking[]> {
        const rows = await this.db.select().from(bookings).where(and(eq(bookings.orgId, orgId), gte(bookings.date, from), lte(bookings.date, to)));
        return rows.map(toDto);
    }
    async createBooking(orgId: string, userId: string, bookingId: string, data: Record<string, any>): Promise<void> {
        const now = new Date();
        const row = { ...dtoToRow(data, NUMERIC_KEYS, STRIP), orgId, bookingId, ownerId: userId, createdBy: userId, createdAt: now, updatedAt: now };
        await this.db.insert(bookings).values(row as any);
    }
    async updateBooking(orgId: string, _userId: string, bookingId: string, updates: Record<string, any>): Promise<void> {
        await this.db.update(bookings)
            .set({ ...dtoToRow(updates, NUMERIC_KEYS, STRIP), updatedAt: new Date() } as any)
            .where(and(eq(bookings.orgId, orgId), eq(bookings.bookingId, bookingId)));
    }
    async deleteBooking(orgId: string, _userId: string, bookingId: string): Promise<void> {
        await this.db.delete(bookings).where(and(eq(bookings.orgId, orgId), eq(bookings.bookingId, bookingId)));
    }
    async upsertBooking(booking: Booking): Promise<void> {
        const row = { ...dtoToRow(booking as Record<string, any>, NUMERIC_KEYS, STRIP), ownerId: ownerFromSk(booking as any) };
        await this.db.insert(bookings).values(row as any)
            .onConflictDoUpdate({ target: bookings.bookingId, set: row as any, setWhere: sql`${bookings.updatedAt} <= excluded.updated_at` });
    }
}
