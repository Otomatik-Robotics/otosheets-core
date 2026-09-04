import { describe, it, expect, beforeEach } from 'vitest';
import { ReceiptDynamoRepo } from './repo';
import { sk } from '../keys';
import type { IDdb } from '../ddbPort';

/**
 * In-memory IDdb stub that evaluates exactly the condition / update grammar
 * the receipt review methods use:
 *   ConditionExpression: `A AND B AND (attribute_not_exists(#x) OR #x = :v)`
 *   UpdateExpression:    `SET #a = :v, #b = if_not_exists(#b, :v)`
 * Anything else throws, so a new expression shape is caught by the test.
 */
function makeStubDdb() {
    const store = new Map<string, any>();
    const keyOf = (key: any) => `${key.orgId}|${key.sk}`;
    const conditionalFailure = () => {
        const err = new Error('The conditional request failed');
        (err as any).name = 'ConditionalCheckFailedException';
        return err;
    };
    const resolveName = (names: Record<string, string>, token: string) => token.startsWith('#') ? names[token] : token;

    function evalTerm(term: string, item: any, names: Record<string, string>, values: Record<string, any>): boolean {
        term = term.trim();
        if (term.startsWith('(') && term.endsWith(')')) {
            return term.slice(1, -1).split(/\s+OR\s+/).some((t) => evalTerm(t, item, names, values));
        }
        let m = /^attribute_exists\((\S+)\)$/.exec(term);
        if (m) return item !== undefined && item[resolveName(names, m[1])] !== undefined;
        m = /^attribute_not_exists\((\S+)\)$/.exec(term);
        if (m) return item === undefined || item[resolveName(names, m[1])] === undefined;
        m = /^(\S+)\s*=\s*(:\S+)$/.exec(term);
        if (m) return item !== undefined && item[resolveName(names, m[1])] === values[m[2]];
        throw new Error(`stub cannot evaluate condition term: ${term}`);
    }

    function evalCondition(expr: string | undefined, item: any, names: Record<string, string>, values: Record<string, any>): boolean {
        if (!expr) return true;
        // Split on top-level AND only (parenthesised OR groups stay intact).
        const terms: string[] = [];
        let depth = 0, cur = '';
        for (let i = 0; i < expr.length; i++) {
            const ch = expr[i];
            if (ch === '(') depth++;
            if (ch === ')') depth--;
            if (depth === 0 && expr.slice(i, i + 5) === ' AND ') { terms.push(cur); cur = ''; i += 4; continue; }
            cur += ch;
        }
        terms.push(cur);
        return terms.every((t) => evalTerm(t, item, names, values));
    }

    const ddb = {
        async getItem(_t: string, key: any) { return { Item: store.get(keyOf(key)) }; },
        async put(_t: string, item: any) { store.set(keyOf(item), { ...item }); return {}; },
        async update(_t: string, key: any, params: Record<string, any>) {
            const names = params.ExpressionAttributeNames ?? {};
            const values = params.ExpressionAttributeValues ?? {};
            const existing = store.get(keyOf(key));
            if (!evalCondition(params.ConditionExpression, existing, names, values)) throw conditionalFailure();
            const item = existing ? { ...existing } : { ...key };
            const body = String(params.UpdateExpression).replace(/^SET\s+/, '');
            // Split assignments on commas at paren depth 0 only — if_not_exists(a, :v) carries its own comma.
            const assignments: string[] = [];
            let depth = 0, cur = '';
            for (const ch of body) {
                if (ch === '(') depth++;
                if (ch === ')') depth--;
                if (ch === ',' && depth === 0) { assignments.push(cur); cur = ''; continue; }
                cur += ch;
            }
            assignments.push(cur);
            for (const assignment of assignments) {
                const m = /^\s*(\S+)\s*=\s*(.+?)\s*$/.exec(assignment);
                if (!m) throw new Error(`stub cannot parse assignment: ${assignment}`);
                const attr = resolveName(names, m[1]);
                const rhs = m[2];
                const inx = /^if_not_exists\((\S+),\s*(:\S+)\)$/.exec(rhs);
                if (inx) {
                    const current = item[resolveName(names, inx[1])];
                    item[attr] = current !== undefined ? current : values[inx[2]];
                } else if (rhs.startsWith(':')) {
                    item[attr] = values[rhs];
                } else {
                    throw new Error(`stub cannot parse rhs: ${rhs}`);
                }
            }
            store.set(keyOf(key), item);
            return {};
        },
        async query(params: any) {
            const orgId = params.ExpressionAttributeValues[':orgId'];
            const receiptId = params.ExpressionAttributeValues[':receiptId'];
            const Items = [...store.values()].filter((i) => i.orgId === orgId && i.receiptId === receiptId);
            return { Items };
        },
    };
    return { ddb: ddb as unknown as IDdb, store };
}

describe('ReceiptDynamoRepo review + asset signals', () => {
    let repo: ReceiptDynamoRepo;
    let store: Map<string, any>;
    const key = `org1|${sk('owner', 'r1')}`;

    beforeEach(() => {
        const stub = makeStubDdb();
        repo = new ReceiptDynamoRepo(stub.ddb);
        store = stub.store;
        store.set(key, { orgId: 'org1', sk: sk('owner', 'r1'), receiptId: 'r1', createdBy: 'owner', category: 'UNCATEGORIZED', aiRiskLevel: 'HIGH' });
    });

    it('markOpened resolves the owner through the id index and stamps only once', async () => {
        expect(await repo.markOpened('org1', 'r1', 'viewer')).toBe(true);
        expect(store.get(key).openedBy).toBe('viewer');
        expect(typeof store.get(key).openedAt).toBe('string');
        expect(await repo.markOpened('org1', 'r1', 'someone-else')).toBe(false); // already opened
        expect(store.get(key).openedBy).toBe('viewer');
        expect(await repo.markOpened('org1', 'missing', 'viewer')).toBe(false);
    });

    it('confirmCategory sets category + confirmation and acknowledges the risk flag only if unacknowledged', async () => {
        expect(await repo.confirmCategory('org1', 'r1', { category: 'TOOLS', userId: 'u1' })).toBe(true);
        const first = store.get(key);
        expect(first.category).toBe('TOOLS');
        expect(first.categoryConfirmedBy).toBe('u1');
        expect(first.reviewedBy).toBe('u1');
        expect(typeof first.reviewedAt).toBe('string');

        expect(await repo.confirmCategory('org1', 'r1', { category: 'PLANT', userId: 'u2' })).toBe(true);
        const second = store.get(key);
        expect(second.category).toBe('PLANT');
        expect(second.categoryConfirmedBy).toBe('u2');
        expect(second.reviewedAt).toBe(first.reviewedAt); // if_not_exists kept the original acknowledgement
        expect(second.reviewedBy).toBe('u1');

        expect(await repo.confirmCategory('org1', 'missing', { category: 'X', userId: 'u1' })).toBe(false);
    });

    it('linkAsset never repoints; a replay with the same asset is fine', async () => {
        expect(await repo.linkAsset('org1', 'r1', 'a1')).toBe(true);
        expect(await repo.linkAsset('org1', 'r1', 'a1')).toBe(true);
        expect(await repo.linkAsset('org1', 'r1', 'a2')).toBe(false);
        expect(store.get(key).assetId).toBe('a1');
        expect(await repo.declineAssetOffer('org1', 'r1')).toBe(false); // already promoted
    });

    it('declineAssetOffer stamps once', async () => {
        expect(await repo.declineAssetOffer('org1', 'r1')).toBe(true);
        expect(typeof store.get(key).assetDeclinedAt).toBe('string');
        expect(await repo.declineAssetOffer('org1', 'r1')).toBe(false);
        expect(await repo.declineAssetOffer('org1', 'missing')).toBe(false);
    });

    it('rethrows anything that is not a conditional failure', async () => {
        const boom = new Error('ProvisionedThroughputExceededException');
        (boom as any).name = 'ProvisionedThroughputExceededException';
        const failing = {
            async query() { return { Items: [store.get(key)] }; },
            async update() { throw boom; },
        } as unknown as IDdb;
        await expect(new ReceiptDynamoRepo(failing).markOpened('org1', 'r1', 'u')).rejects.toBe(boom);
    });
});
