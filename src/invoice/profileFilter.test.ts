import { expect, test, vi } from 'vitest';
import { InvoiceDynamoRepo } from './repo';
import type { IDdb } from '../ddbPort';
test('Dynamo applies profile/client/overdue filters in the query, retaining empty-page continuation', async () => {
    const key = { orgId: 'org', sk: 'next' };
    const query = vi.fn().mockResolvedValue({ Items: [], LastEvaluatedKey: key });
    const repo = new InvoiceDynamoRepo({ query } as unknown as IDdb);
    expect(await repo.listOrgInvoicesPaginated({ orgId: 'org', businessProfileId: 'profile', clientId: 'client', overdueBefore: '2026-02-01', limit: 7 })).toEqual({ items: [], lastEvaluatedKey: key });
    const input = query.mock.calls[0][0];
    expect(input.FilterExpression).toContain('#businessProfileId = :businessProfileId');
    expect(input.FilterExpression).toContain('#dueDate < :overdueBefore');
    expect(input.FilterExpression).toContain('#overdueStatus IN');
    expect(input.ExpressionAttributeValues).toMatchObject({ ':businessProfileId': 'profile', ':clientId': 'client', ':overdueBefore': '2026-02-01' });
    expect(input.Limit).toBe(7);
});
