import { resolveRoute, type Route } from '../dataBackend';
import { mirrorWrite, shadowRead } from '../dualWrite';
import { ddb } from '../ddbClient';
import type { IDdb } from '../ddbPort';
import { VoiceCreditLedgerEntry } from './schema';
import { VoiceCreditDynamoRepo, type IVoiceCreditRepo } from './repo';
import { VoiceCreditPgRepo } from './repo.pg';

const DOMAIN = 'voice-credit' as const, ENTITY = 'voiceCredit';

export class RoutingVoiceCreditRepo implements IVoiceCreditRepo {
    constructor(private dynamo: IVoiceCreditRepo, private pg: IVoiceCreditRepo) {}
    private pick(r: Route) { return r.primary === 'dynamo' ? this.dynamo : this.pg; }
    private mirrorOf(r: Route) { return !r.mirror ? undefined : (r.mirror === 'dynamo' ? this.dynamo : this.pg); }
    private async rd<T>(op: string, p: () => Promise<T>, s: () => Promise<T>, r: Route): Promise<T> { const res = await p(); if (r.shadow) await shadowRead({ domain: DOMAIN, entity: ENTITY, op }, res, s); return res; }

    async getBalance(o: string) { const r = await resolveRoute(DOMAIN); return this.rd('getBalance', () => this.pick(r).getBalance(o), () => this.pg.getBalance(o), r); }
    async getPeriodGrant(o: string, p: string) { const r = await resolveRoute(DOMAIN); return this.rd('getPeriodGrant', () => this.pick(r).getPeriodGrant(o, p), () => this.pg.getPeriodGrant(o, p), r); }
    async listLedger(o: string, limit?: number) { const r = await resolveRoute(DOMAIN); return this.rd('listLedger', () => this.pick(r).listLedger(o, limit), () => this.pg.listLedger(o, limit), r); }

    // Compound wallet writes: replay the same idempotent op on the mirror (deterministic
    // ledger key ⇒ no double-apply), like recordPayment.
    async credit(o: string, amt: number, meta: { stripeSessionId: string; description?: string }) {
        const r = await resolveRoute(DOMAIN); const bal = await this.pick(r).credit(o, amt, meta);
        const m = this.mirrorOf(r); if (m) await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'credit', key: { orgId: o, stripeSessionId: meta.stripeSessionId } }, () => m.credit(o, amt, meta).then(() => {}));
        return bal;
    }
    async debit(o: string, amt: number, meta: { callId: string; description?: string }) {
        const r = await resolveRoute(DOMAIN); const bal = await this.pick(r).debit(o, amt, meta);
        const m = this.mirrorOf(r); if (m) await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'debit', key: { orgId: o, callId: meta.callId } }, () => m.debit(o, amt, meta).then(() => {}));
        return bal;
    }
    async grantMonthlyAllowance(o: string, period: string, amt: number) {
        const r = await resolveRoute(DOMAIN); const bal = await this.pick(r).grantMonthlyAllowance(o, period, amt);
        const m = this.mirrorOf(r); if (m) await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'grant', key: { orgId: o, period } }, () => m.grantMonthlyAllowance(o, period, amt).then(() => {}));
        return bal;
    }
    async upsertWalletItem(item: Record<string, any>) {
        const r = await resolveRoute(DOMAIN); await this.pick(r).upsertWalletItem(item);
        const m = this.mirrorOf(r); if (m) await mirrorWrite({ domain: DOMAIN, entity: ENTITY, op: 'upsertWalletItem', key: { orgId: item.orgId, sk: item.sk } }, () => m.upsertWalletItem(item));
    }
}

export class VoiceCreditRepo extends RoutingVoiceCreditRepo { constructor(d: IDdb) { super(new VoiceCreditDynamoRepo(d), new VoiceCreditPgRepo()); } }
let s: IVoiceCreditRepo | undefined; export function getVoiceCreditRepo(): IVoiceCreditRepo { if (!s) s = new VoiceCreditRepo(ddb); return s; }
export type { VoiceCreditLedgerEntry };
