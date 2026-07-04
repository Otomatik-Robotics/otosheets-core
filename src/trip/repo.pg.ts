import { and, eq, sql, desc, lt, or, gte, lte } from 'drizzle-orm';
import { getPg, type PgDb } from '../pg/client';
import { trips } from '../pg/schema/opsEntities';
import { keysetFromStartKey, keysetStartKey } from '../pg/cursor';
import { dtoToRow, rowToDto, ownerFromSk } from '../pg/billingRows';
import { PaginatedResult } from '../types';
import { Trip } from './schema';
import type { ITripRepo } from './repo';

const NUM = ['distanceKm'];
const PG_ONLY = ['ownerId'];
const STRIP = ['sk', 'dateSk'];
function toDto(row: any): Trip {
    const d = rowToDto<any>(row, NUM, PG_ONLY);
    d.sk = `${row.ownerId}#${row.tripId}`;
    if (row.date) d.dateSk = `${row.date}#${row.tripId}`;
    return d as Trip;
}

export class TripPgRepo implements ITripRepo {
    constructor(private injected?: PgDb) {}
    private get db(): PgDb { return this.injected ?? getPg(); }

    async getTrip(o: string, _u: string, id: string) { const r = await this.db.select().from(trips).where(and(eq(trips.orgId, o), eq(trips.tripId, id))).limit(1); return r[0] ? toDto(r[0]) : null; }
    async findTripByIdInOrg(o: string, id: string) { const r = await this.db.select().from(trips).where(and(eq(trips.orgId, o), eq(trips.tripId, id))).limit(1); return r[0] ? { trip: toDto(r[0]), ownerId: (r[0] as any).ownerId } : null; }
    async listAllOrgTrips(o: string) { return (await this.db.select().from(trips).where(eq(trips.orgId, o))).map(toDto); }
    async listUserTrips(o: string, userId: string) { return (await this.db.select().from(trips).where(and(eq(trips.orgId, o), eq(trips.ownerId, userId)))).map(toDto); }
    async listTripsByDate(o: string, from: string, to: string) { return (await this.db.select().from(trips).where(and(eq(trips.orgId, o), gte(trips.date, from), lte(trips.date, to)))).map(toDto); }
    async listOrgTripsPaginated(params: { orgId: string; limit?: number; exclusiveStartKey?: Record<string, any>; search?: string; purpose?: string; dateFrom?: string; dateTo?: string; }): Promise<PaginatedResult<Trip>> {
        const { orgId, limit = 20, exclusiveStartKey, search, purpose, dateFrom, dateTo } = params;
        const conds: any[] = [eq(trips.orgId, orgId)];
        if (search) { const like = `%${search}%`; conds.push(or(sql`${trips.startAddress} ILIKE ${like}`, sql`${trips.endAddress} ILIKE ${like}`)); }
        if (purpose) conds.push(eq(trips.purpose, purpose));
        if (dateFrom) conds.push(gte(trips.date, dateFrom));
        if (dateTo) conds.push(lte(trips.date, dateTo));
        const cur = keysetFromStartKey(exclusiveStartKey, 'tripId');
        if (cur) conds.push(or(lt(trips.createdAt, new Date(cur.createdAt)), and(eq(trips.createdAt, new Date(cur.createdAt)), lt(trips.tripId, cur.id))));
        const rows = await this.db.select().from(trips).where(and(...conds)).orderBy(desc(trips.createdAt), desc(trips.tripId)).limit(limit);
        const last = rows[rows.length - 1] as any;
        const lek = rows.length === limit && last ? keysetStartKey({ createdAt: (last.createdAt as Date).toISOString(), id: last.tripId }) : undefined;
        return { items: rows.map(toDto), lastEvaluatedKey: lek };
    }
    async createTrip(o: string, u: string, id: string, data: Record<string, any>) { await this.db.insert(trips).values({ ...dtoToRow(data, NUM, STRIP), orgId: o, tripId: id, ownerId: u, createdBy: u, createdAt: new Date() } as any); }
    async deleteTrip(o: string, _u: string, id: string) { await this.db.delete(trips).where(and(eq(trips.orgId, o), eq(trips.tripId, id))); }
    async upsertTrip(trip: Trip) { const row = { ...dtoToRow(trip as Record<string, any>, NUM, STRIP), ownerId: ownerFromSk(trip as any) }; await this.db.insert(trips).values(row as any).onConflictDoUpdate({ target: trips.tripId, set: row as any }); }
}
