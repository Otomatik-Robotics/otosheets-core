import { resolveRoute, type Route } from '../dataBackend';
import { mirrorWrite, shadowRead } from '../dualWrite';
import { ddb } from '../ddbClient';
import type { IDdb } from '../ddbPort';
import { PaginatedResult } from '../types';
import { Booking } from './schema';
import { BookingDynamoRepo, type IBookingRepo } from './repo';
import { BookingPgRepo } from './repo.pg';

const DOMAIN = 'leads' as const;
const ENTITY = 'booking';
type PagParams = { orgId: string; limit?: number; exclusiveStartKey?: Record<string, any>; status?: string };

export class RoutingBookingRepo implements IBookingRepo {
    constructor(private dynamo: IBookingRepo, private pg: IBookingRepo) {}
    private pick(r: Route): IBookingRepo { return r.primary === 'dynamo' ? this.dynamo : this.pg; }
    private mirrorOf(r: Route): IBookingRepo | undefined { return !r.mirror ? undefined : (r.mirror === 'dynamo' ? this.dynamo : this.pg); }
    private async mirrorEntity(route: Route, orgId: string, userId: string, bookingId: string, op: string): Promise<void> {
        const m = this.mirrorOf(route); if (!m) return;
        await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op, key: { orgId, userId, bookingId } }, async () => {
            const fresh = await this.pick(route).getBooking(orgId, userId, bookingId);
            if (fresh) await m.upsertBooking(fresh); else await m.deleteBooking(orgId, userId, bookingId);
        });
    }
    private async read<T>(op: string, primary: () => Promise<T>, shadow: () => Promise<T>, r: Route): Promise<T> {
        const res = await primary(); if (r.shadow) await shadowRead({ domain: DOMAIN, entity: ENTITY, op }, res, shadow); return res;
    }
    async getBooking(o: string, u: string, id: string) { const r = await resolveRoute(DOMAIN); return this.read('getBooking', () => this.pick(r).getBooking(o, u, id), () => this.pg.getBooking(o, u, id), r); }
    async findBookingByIdInOrg(o: string, id: string) { const r = await resolveRoute(DOMAIN); return this.read('findBookingByIdInOrg', () => this.pick(r).findBookingByIdInOrg(o, id), () => this.pg.findBookingByIdInOrg(o, id), r); }
    async listAllOrgBookings(o: string) { const r = await resolveRoute(DOMAIN); return this.read('listAllOrgBookings', () => this.pick(r).listAllOrgBookings(o), () => this.pg.listAllOrgBookings(o), r); }
    async listOrgBookingsPaginated(p: PagParams): Promise<PaginatedResult<Booking>> { return this.pick(await resolveRoute(DOMAIN)).listOrgBookingsPaginated(p); }
    async listBookingsByDate(o: string, f: string, t: string) { const r = await resolveRoute(DOMAIN); return this.read('listBookingsByDate', () => this.pick(r).listBookingsByDate(o, f, t), () => this.pg.listBookingsByDate(o, f, t), r); }
    async createBooking(o: string, u: string, id: string, d: Record<string, any>) { const r = await resolveRoute(DOMAIN); await this.pick(r).createBooking(o, u, id, d); await this.mirrorEntity(r, o, u, id, 'createBooking'); }
    async updateBooking(o: string, u: string, id: string, upd: Record<string, any>) { const r = await resolveRoute(DOMAIN); await this.pick(r).updateBooking(o, u, id, upd); await this.mirrorEntity(r, o, u, id, 'updateBooking'); }
    async deleteBooking(o: string, u: string, id: string) { const r = await resolveRoute(DOMAIN); await this.pick(r).deleteBooking(o, u, id); const m = this.mirrorOf(r); if (m) await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'deleteBooking', key: { orgId: o, userId: u, bookingId: id } }, () => m.deleteBooking(o, u, id)); }
    async upsertBooking(booking: Booking) { const r = await resolveRoute(DOMAIN); await this.pick(r).upsertBooking(booking); const m = this.mirrorOf(r); if (m) await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'upsertBooking', key: { orgId: (booking as any).orgId, bookingId: (booking as any).bookingId } }, () => m.upsertBooking(booking)); }
}

export class BookingRepo extends RoutingBookingRepo {
    constructor(dynamoDb: IDdb) { super(new BookingDynamoRepo(dynamoDb), new BookingPgRepo()); }
}
let singleton: IBookingRepo | undefined;
export function getBookingRepo(): IBookingRepo { if (!singleton) singleton = new BookingRepo(ddb); return singleton; }
