import { describe, expect, it, vi } from 'vitest';
import { AdvisorAuditRepo } from './repo';
import type { IDdb } from '../ddbPort';

const now = Date.parse('2026-09-09T00:00:00.000Z');
function fixture() {
    const rows: any[] = [];
    const ddb = {
        transactWrite: vi.fn(async (writes: any[]) => { rows.push(...writes.map(w => w.Put.Item)); return {}; }),
        getItem: vi.fn(async (_table: string, key: any) => ({ Item: rows.find(r => r.pk === key.pk && r.sk === key.sk) })),
        query: vi.fn(async (q: any) => {
            const v = q.ExpressionAttributeValues;
            const keyed = rows.filter(r => r.pk === v[':pk'] && r.sk.startsWith(v[':prefix']))
                .sort((a, b) => b.sk.localeCompare(a.sk));
            const start = q.ExclusiveStartKey ? keyed.findIndex(r => r.sk === q.ExclusiveStartKey.sk) + 1 : 0;
            const page = keyed.slice(start, start + q.Limit);
            const tail = page[page.length - 1];
            return { Items: page.filter(r => r.orgId === v[':org'] && r.businessProfileId === v[':profile'] && r.ttl > v[':now']),
                LastEvaluatedKey: start + q.Limit < keyed.length ? { pk: tail.pk, sk: tail.sk } : undefined };
        }),
    };
    return { rows, ddb, repo: (org = 'org', profile = 'A') => new AdvisorAuditRepo(ddb as unknown as IDdb, 'portal', { orgId: org, businessProfileId: profile }, () => now) };
}
const entry = { advisorUserId: 'advisor', action: 'categorize', detail: { before: 'old', after: 'new' } };

describe('profile-owned advisor audit repository', () => {
    it('stamps immutable scope, writes conditionally, and reads only the exact scoped key', async () => {
        const f = fixture(); const input: any = { orgId: 'org', businessProfileId: 'A' };
        const repo = new AdvisorAuditRepo(f.ddb as unknown as IDdb, 'portal', input, () => now);
        input.businessProfileId = 'B';
        const record = await repo.append({ ...entry, orgId: 'foreign', businessProfileId: 'B', pk: 'other', ttl: 1 } as any);
        expect(record).toMatchObject({ orgId: 'org', businessProfileId: 'A', ttl: now / 1000 + 400 * 86400 });
        expect(f.ddb.transactWrite.mock.calls[0][0][0].Put.ConditionExpression).toContain('attribute_not_exists');
        expect(await repo.get(record.auditId)).toEqual(record);
        expect(await f.repo('org', 'B').get(record.auditId)).toBeNull();
        expect(await f.repo('other').get(record.auditId)).toBeNull();
        expect(f.ddb.getItem).toHaveBeenCalledWith('portal', expect.objectContaining({ pk: 'ORG#org' }), { ConsistentRead: true });
    });
    it('scopes key selection before pagination and never includes legacy or null-profile rows', async () => {
        const f = fixture(); const a = f.repo();
        const first = await a.append(entry); await a.append(entry);
        await f.repo('org', 'B').append({ ...entry, detail: { secret: 'B' } });
        f.rows.push({ pk: 'ORG#org', sk: 'AUDIT#legacy', ...entry });
        f.rows.push({ ...f.rows[0], sk: f.rows[0].sk.replace(first.auditId, '2026-09-10T00:00:00.000Z#aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), businessProfileId: null });
        const records: any[] = []; let nextToken: string | null = null; let pages = 0;
        do { const page = await a.list({ limit: 1, nextToken }); records.push(...page.items); nextToken = page.nextToken; pages++; } while (nextToken);
        expect(records).toHaveLength(2); expect(pages).toBe(3);
        expect(records.every(r => r.businessProfileId === 'A')).toBe(true);
        expect(f.ddb.query.mock.calls[0][0]).toMatchObject({ KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)', Limit: 1,
            ExpressionAttributeValues: { ':pk': 'ORG#org', ':prefix': 'PROFILE#QQ#AUDIT#', ':profile': 'A' } });
    });
    it('rejects cross-profile, cross-org, legacy and malformed cursors before querying', async () => {
        const f = fixture(); await f.repo().append(entry); await f.repo().append(entry);
        const { nextToken } = await f.repo().list({ limit: 1 }); expect(nextToken).toBeTruthy();
        f.ddb.query.mockClear();
        for (const repo of [f.repo('org', 'B'), f.repo('other')]) await expect(repo.list({ nextToken })).rejects.toThrow('Invalid advisor audit cursor');
        for (const token of ['junk', Buffer.from(JSON.stringify({ pk: 'ORG#org', sk: 'AUDIT#legacy' })).toString('base64url'), nextToken + '=']) {
            await expect(f.repo().list({ nextToken: token })).rejects.toThrow('Invalid advisor audit cursor');
        }
        expect(f.ddb.query).not.toHaveBeenCalled();
    });
    it('quarantines inconsistent or expired records even if the physical key matches', async () => {
        const f = fixture(); const record = await f.repo().append(entry);
        for (const patch of [{ businessProfileId: null }, { businessProfileId: 'B' }, { orgId: 'foreign' }, { ttl: now / 1000 }]) {
            Object.assign(f.rows[0], record, patch);
            expect(await f.repo().get(record.auditId)).toBeNull();
            expect((await f.repo().list()).items).toEqual([]);
        }
    });
    it('validates scope and page bounds before storage calls', async () => {
        const f = fixture(); expect(() => f.repo('org', '')).toThrow('scope');
        for (const limit of [0, -1, 101, NaN, 1.5]) await expect(f.repo().list({ limit })).rejects.toThrow('limit');
        expect(f.ddb.query).not.toHaveBeenCalled();
        expect(await f.repo().get('arbitrary/key')).toBeNull(); expect(f.ddb.getItem).not.toHaveBeenCalled();
    });
});
