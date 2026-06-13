import { describe, it, expect, beforeEach } from 'vitest';
import { UsageRepo } from './repo';
import { currentUsageMonth } from './schema';
import type { IDdb } from '../ddbPort';

// In-memory IDdb stub supporting the ADD + SET (with if_not_exists) update
// expression the UsageRepo emits for atomic counter increments.
function makeStubDdb() {
    const store = new Map<string, any>();
    const resolveName = (token: string, names: Record<string, string> = {}) =>
        token.startsWith('#') ? names[token] : token;
    // Split on commas that are NOT inside parentheses (if_not_exists(a, b)).
    const splitTopLevel = (s: string) => {
        const out: string[] = [];
        let depth = 0, start = 0;
        for (let i = 0; i < s.length; i++) {
            if (s[i] === '(') depth++;
            else if (s[i] === ')') depth--;
            else if (s[i] === ',' && depth === 0) {
                out.push(s.slice(start, i));
                start = i + 1;
            }
        }
        out.push(s.slice(start));
        return out;
    };

    const ddb = {
        async getItem(_t: string, key: any) {
            return { Item: store.get(`${key.orgId}|${key.sk}`) };
        },
        async update(_t: string, key: any, params: any) {
            const k = `${key.orgId}|${key.sk}`;
            const item = store.get(k) ?? { orgId: key.orgId, sk: key.sk };
            const names = params.ExpressionAttributeNames ?? {};
            const values = params.ExpressionAttributeValues ?? {};
            const expr: string = params.UpdateExpression;

            const addMatch = expr.match(/ADD (.+?)(?: SET |$)/)?.[1];
            const setMatch = expr.match(/SET (.+)$/)?.[1];

            if (addMatch) {
                for (const clause of splitTopLevel(addMatch)) {
                    const [attrTok, valTok] = clause.trim().split(/\s+/);
                    const attr = resolveName(attrTok, names);
                    item[attr] = (item[attr] ?? 0) + values[valTok];
                }
            }
            if (setMatch) {
                for (const clause of splitTopLevel(setMatch)) {
                    const [lhs, rhsRaw] = clause.split('=').map((s) => s.trim());
                    const attr = resolveName(lhs, names);
                    const fn = rhsRaw.match(/if_not_exists\(\s*(\S+)\s*,\s*(\S+)\s*\)/);
                    if (fn) {
                        const existingAttr = resolveName(fn[1], names);
                        item[attr] = item[existingAttr] ?? values[fn[2]];
                    } else {
                        item[attr] = values[rhsRaw];
                    }
                }
            }
            store.set(k, item);
            return {};
        },
    };
    return { ddb: ddb as unknown as IDdb, store };
}

describe('UsageRepo', () => {
    let repo: UsageRepo;

    beforeEach(() => {
        repo = new UsageRepo(makeStubDdb().ddb);
    });

    it('returns null for an untouched meter', async () => {
        expect(await repo.getChatTokens('org1', '2026-06')).toBeNull();
    });

    it('creates a meter on first increment with createdAt + ttl', async () => {
        await repo.incrementChatTokens('org1', { input: 100, output: 40 }, '2026-06');
        const row = await repo.getChatTokens('org1', '2026-06');
        expect(row).toMatchObject({
            orgId: 'org1',
            metric: 'chatTokens',
            month: '2026-06',
            inputTokens: 100,
            outputTokens: 40,
            totalTokens: 140,
        });
        expect(row?.createdAt).toBeTruthy();
        expect(row?.ttl).toBeGreaterThan(0);
    });

    it('accumulates tokens atomically across turns', async () => {
        await repo.incrementChatTokens('org1', { input: 100, output: 40 }, '2026-06');
        const firstTtl = (await repo.getChatTokens('org1', '2026-06'))!.ttl;
        await repo.incrementChatTokens('org1', { input: 10, output: 5 }, '2026-06');
        const row = await repo.getChatTokens('org1', '2026-06');
        expect(row).toMatchObject({ inputTokens: 110, outputTokens: 45, totalTokens: 155 });
        // ttl set once and preserved across increments
        expect(row?.ttl).toBe(firstTtl);
    });

    it('keeps months and orgs isolated', async () => {
        await repo.incrementChatTokens('org1', { input: 100, output: 0 }, '2026-06');
        await repo.incrementChatTokens('org1', { input: 7, output: 0 }, '2026-07');
        await repo.incrementChatTokens('org2', { input: 999, output: 0 }, '2026-06');
        expect((await repo.getChatTokens('org1', '2026-06'))!.totalTokens).toBe(100);
        expect((await repo.getChatTokens('org1', '2026-07'))!.totalTokens).toBe(7);
        expect((await repo.getChatTokens('org2', '2026-06'))!.totalTokens).toBe(999);
    });

    it('currentUsageMonth formats as YYYY-MM', () => {
        expect(currentUsageMonth(new Date('2026-06-13T10:00:00Z'))).toBe('2026-06');
    });
});
