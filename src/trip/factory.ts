import { resolveRoute, type Route } from '../dataBackend';
import { mirrorWrite, shadowRead } from '../dualWrite';
import { ddb } from '../ddbClient';
import type { IDdb } from '../ddbPort';
import { PaginatedResult } from '../types';
import { Trip } from './schema';
import { TripDynamoRepo, type ITripRepo } from './repo';
import { TripPgRepo } from './repo.pg';

const DOMAIN = 'ops' as const, ENTITY = 'trip';
type PP = { orgId: string; limit?: number; exclusiveStartKey?: Record<string, any>; search?: string; purpose?: string; dateFrom?: string; dateTo?: string };

export class RoutingTripRepo implements ITripRepo {
    constructor(private dynamo: ITripRepo, private pg: ITripRepo) {}
    private pick(r: Route) { return r.primary === 'dynamo' ? this.dynamo : this.pg; }
    private mirrorOf(r: Route) { return !r.mirror ? undefined : (r.mirror === 'dynamo' ? this.dynamo : this.pg); }
    private async mE(route: Route, o: string, u: string, id: string, op: string) { const m = this.mirrorOf(route); if (!m) return; await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op, key: { orgId: o, userId: u, tripId: id } }, async () => { const f = await this.pick(route).getTrip(o, u, id); if (f) await m.upsertTrip(f); else await m.deleteTrip(o, u, id); }); }
    private async rd<T>(op: string, p: () => Promise<T>, s: () => Promise<T>, r: Route): Promise<T> { const res = await p(); if (r.shadow) await shadowRead({ domain: DOMAIN, entity: ENTITY, op }, res, s); return res; }
    async getTrip(o: string, u: string, id: string) { const r = await resolveRoute(DOMAIN); return this.rd('getTrip', () => this.pick(r).getTrip(o, u, id), () => this.pg.getTrip(o, u, id), r); }
    async findTripByIdInOrg(o: string, id: string) { const r = await resolveRoute(DOMAIN); return this.rd('findTripByIdInOrg', () => this.pick(r).findTripByIdInOrg(o, id), () => this.pg.findTripByIdInOrg(o, id), r); }
    async listAllOrgTrips(o: string) { const r = await resolveRoute(DOMAIN); return this.rd('listAllOrgTrips', () => this.pick(r).listAllOrgTrips(o), () => this.pg.listAllOrgTrips(o), r); }
    async listUserTrips(o: string, u: string) { const r = await resolveRoute(DOMAIN); return this.rd('listUserTrips', () => this.pick(r).listUserTrips(o, u), () => this.pg.listUserTrips(o, u), r); }
    async listTripsByDate(o: string, f: string, t: string) { const r = await resolveRoute(DOMAIN); return this.rd('listTripsByDate', () => this.pick(r).listTripsByDate(o, f, t), () => this.pg.listTripsByDate(o, f, t), r); }
    async listOrgTripsPaginated(p: PP): Promise<PaginatedResult<Trip>> { return this.pick(await resolveRoute(DOMAIN)).listOrgTripsPaginated(p); }
    async createTrip(o: string, u: string, id: string, d: Record<string, any>) { const r = await resolveRoute(DOMAIN); await this.pick(r).createTrip(o, u, id, d); await this.mE(r, o, u, id, 'createTrip'); }
    async deleteTrip(o: string, u: string, id: string) { const r = await resolveRoute(DOMAIN); await this.pick(r).deleteTrip(o, u, id); const m = this.mirrorOf(r); if (m) await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'deleteTrip', key: { orgId: o, userId: u, tripId: id } }, () => m.deleteTrip(o, u, id)); }
    async upsertTrip(trip: Trip) { const r = await resolveRoute(DOMAIN); await this.pick(r).upsertTrip(trip); const m = this.mirrorOf(r); if (m) await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'upsertTrip', key: { orgId: (trip as any).orgId, tripId: (trip as any).tripId } }, () => m.upsertTrip(trip)); }
}
export class TripRepo extends RoutingTripRepo { constructor(d: IDdb) { super(new TripDynamoRepo(d), new TripPgRepo()); } }
let s: ITripRepo | undefined; export function getTripRepo(): ITripRepo { if (!s) s = new TripRepo(ddb); return s; }
