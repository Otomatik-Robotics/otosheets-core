import { resolveRoute, type Route } from '../dataBackend';
import { mirrorWrite, shadowRead } from '../dualWrite';
import { ddb } from '../ddbClient';
import type { IDdb } from '../ddbPort';
import { Receipt } from './schema';
import { ReceiptDynamoRepo, type IReceiptRepo } from './repo';
import { ReceiptPgRepo } from './repo.pg';

const DOMAIN = 'ops' as const, ENTITY = 'receipt';

export class RoutingReceiptRepo implements IReceiptRepo {
    constructor(private dynamo: IReceiptRepo, private pg: IReceiptRepo) {}
    private pick(r: Route) { return r.primary === 'dynamo' ? this.dynamo : this.pg; }
    private mirrorOf(r: Route) { return !r.mirror ? undefined : (r.mirror === 'dynamo' ? this.dynamo : this.pg); }
    private async mE(route: Route, o: string, u: string, id: string, op: string) { const m = this.mirrorOf(route); if (!m) return; await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op, key: { orgId: o, userId: u, receiptId: id } }, async () => { const f = await this.pick(route).getReceipt(o, u, id); if (f) await m.upsertReceipt(f); else await m.deleteReceipt(o, u, id); }); }
    private async rd<T>(op: string, p: () => Promise<T>, s: () => Promise<T>, r: Route): Promise<T> { const res = await p(); if (r.shadow) await shadowRead({ domain: DOMAIN, entity: ENTITY, op }, res, s); return res; }
    async getReceipt(o: string, u: string, id: string) { const r = await resolveRoute(DOMAIN); return this.rd('getReceipt', () => this.pick(r).getReceipt(o, u, id), () => this.pg.getReceipt(o, u, id), r); }
    async findReceiptByIdInOrg(o: string, id: string) { const r = await resolveRoute(DOMAIN); return this.rd('findReceiptByIdInOrg', () => this.pick(r).findReceiptByIdInOrg(o, id), () => this.pg.findReceiptByIdInOrg(o, id), r); }
    async findReceiptByDescriptionPrefix(o: string, p: string) { const r = await resolveRoute(DOMAIN); return this.rd('findReceiptByDescriptionPrefix', () => this.pick(r).findReceiptByDescriptionPrefix(o, p), () => this.pg.findReceiptByDescriptionPrefix(o, p), r); }
    async findReceiptByContentHash(o: string, h: string) { const r = await resolveRoute(DOMAIN); return this.rd('findReceiptByContentHash', () => this.pick(r).findReceiptByContentHash(o, h), () => this.pg.findReceiptByContentHash(o, h), r); }
    async findReceiptsByDuplicateOf(o: string, id: string) { const r = await resolveRoute(DOMAIN); return this.rd('findReceiptsByDuplicateOf', () => this.pick(r).findReceiptsByDuplicateOf(o, id), () => this.pg.findReceiptsByDuplicateOf(o, id), r); }
    async findReceiptsByVendorAndAmount(o: string, v: string, a: number) { const r = await resolveRoute(DOMAIN); return this.rd('findReceiptsByVendorAndAmount', () => this.pick(r).findReceiptsByVendorAndAmount(o, v, a), () => this.pg.findReceiptsByVendorAndAmount(o, v, a), r); }
    async listAllOrgReceipts(o: string) { const r = await resolveRoute(DOMAIN); return this.rd('listAllOrgReceipts', () => this.pick(r).listAllOrgReceipts(o), () => this.pg.listAllOrgReceipts(o), r); }
    async listUserReceipts(o: string, u: string) { const r = await resolveRoute(DOMAIN); return this.rd('listUserReceipts', () => this.pick(r).listUserReceipts(o, u), () => this.pg.listUserReceipts(o, u), r); }
    async listReceiptsByDate(o: string, f: string, t: string, proj?: string) { const r = await resolveRoute(DOMAIN); return this.rd('listReceiptsByDate', () => this.pick(r).listReceiptsByDate(o, f, t, proj), () => this.pg.listReceiptsByDate(o, f, t, proj), r); }
    async createReceipt(o: string, u: string, id: string, d: Record<string, any>) { const r = await resolveRoute(DOMAIN); await this.pick(r).createReceipt(o, u, id, d); await this.mE(r, o, u, id, 'createReceipt'); }
    async updateReceipt(o: string, u: string, id: string, upd: Record<string, any>) { const r = await resolveRoute(DOMAIN); await this.pick(r).updateReceipt(o, u, id, upd); await this.mE(r, o, u, id, 'updateReceipt'); }
    async deleteReceipt(o: string, u: string, id: string) { const r = await resolveRoute(DOMAIN); await this.pick(r).deleteReceipt(o, u, id); const m = this.mirrorOf(r); if (m) await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'deleteReceipt', key: { orgId: o, userId: u, receiptId: id } }, () => m.deleteReceipt(o, u, id)); }
    async upsertReceipt(rec: Receipt) { const r = await resolveRoute(DOMAIN); await this.pick(r).upsertReceipt(rec); const m = this.mirrorOf(r); if (m) await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'upsertReceipt', key: { orgId: (rec as any).orgId, receiptId: (rec as any).receiptId } }, () => m.upsertReceipt(rec)); }
}
export class ReceiptRepo extends RoutingReceiptRepo { constructor(d: IDdb) { super(new ReceiptDynamoRepo(d), new ReceiptPgRepo()); } }
let s: IReceiptRepo | undefined; export function getReceiptRepo(): IReceiptRepo { if (!s) s = new ReceiptRepo(ddb); return s; }
