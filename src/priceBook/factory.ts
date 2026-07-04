import { resolveRoute, type Route } from '../dataBackend';
import { mirrorWrite, shadowRead } from '../dualWrite';
import { ddb } from '../ddbClient';
import type { IDdb } from '../ddbPort';
import { PriceBookItem } from './schema';
import { PriceBookDynamoRepo, type IPriceBookRepo } from './repo';
import { PriceBookPgRepo } from './repo.pg';

const DOMAIN = 'ops' as const, ENTITY = 'priceBook';

export class RoutingPriceBookRepo implements IPriceBookRepo {
    constructor(private dynamo: IPriceBookRepo, private pg: IPriceBookRepo) {}
    private pick(r: Route) { return r.primary === 'dynamo' ? this.dynamo : this.pg; }
    private mirrorOf(r: Route) { return !r.mirror ? undefined : (r.mirror === 'dynamo' ? this.dynamo : this.pg); }
    private async mE(route: Route, orgId: string, itemId: string, op: string) { const m = this.mirrorOf(route); if (!m) return; await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op, key: { orgId, itemId } }, async () => { const f = await this.pick(route).getItem(orgId, itemId); if (f) await m.upsertPriceBookItem(f); else await m.deleteItem(orgId, itemId); }); }
    async getItem(o: string, id: string) { const r = await resolveRoute(DOMAIN); const res = await this.pick(r).getItem(o, id); if (r.shadow) await shadowRead({ domain: DOMAIN, entity: ENTITY, op: 'getItem' }, res, () => this.pg.getItem(o, id)); return res; }
    async listItems(o: string) { const r = await resolveRoute(DOMAIN); const res = await this.pick(r).listItems(o); if (r.shadow) await shadowRead({ domain: DOMAIN, entity: ENTITY, op: 'listItems' }, res, () => this.pg.listItems(o)); return res; }
    async putItem(item: PriceBookItem) { const r = await resolveRoute(DOMAIN); await this.pick(r).putItem(item); await this.mE(r, item.orgId, item.itemId, 'putItem'); }
    async putItems(items: PriceBookItem[]) { const r = await resolveRoute(DOMAIN); await this.pick(r).putItems(items); const m = this.mirrorOf(r); if (m) for (const it of items) await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'putItems', key: { orgId: it.orgId, itemId: it.itemId } }, () => m.putItem(it)); }
    async deleteItem(o: string, id: string) { const r = await resolveRoute(DOMAIN); await this.pick(r).deleteItem(o, id); const m = this.mirrorOf(r); if (m) await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'deleteItem', key: { orgId: o, itemId: id } }, () => m.deleteItem(o, id)); }
    async upsertPriceBookItem(item: PriceBookItem) { const r = await resolveRoute(DOMAIN); await this.pick(r).upsertPriceBookItem(item); await this.mE(r, item.orgId, item.itemId, 'upsertPriceBookItem'); }
}
export class PriceBookRepo extends RoutingPriceBookRepo { constructor(d: IDdb) { super(new PriceBookDynamoRepo(d), new PriceBookPgRepo()); } }
let s: IPriceBookRepo | undefined; export function getPriceBookRepo(): IPriceBookRepo { if (!s) s = new PriceBookRepo(ddb); return s; }
