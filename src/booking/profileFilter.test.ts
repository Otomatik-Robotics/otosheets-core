import { expect, test, vi } from 'vitest';
import { BookingDynamoRepo } from './repo';
import type { IDdb } from '../ddbPort';
test('booking page filters profile and dates in Dynamo, retaining empty-page continuation', async () => {
    const key = { orgId: 'org', sk: 'next' };
    const query = vi.fn().mockResolvedValue({ Items: [], LastEvaluatedKey: key });
    const repo = new BookingDynamoRepo({ query } as unknown as IDdb);
    expect(await repo.listOrgBookingsPaginated({ orgId: 'org', businessProfileId: 'a', from: '2026-01-01', to: '2026-01-31', limit: 7 })).toEqual({ items: [], lastEvaluatedKey: key });
    const input = query.mock.calls[0][0];
    expect(input.FilterExpression).toContain('#businessProfileId = :businessProfileId');
    expect(input.FilterExpression).toContain('#date >= :from');
    expect(input.FilterExpression).toContain('#date <= :to');
    expect(input.ExpressionAttributeValues).toMatchObject({ ':businessProfileId': 'a', ':from': '2026-01-01', ':to': '2026-01-31' });
});
test('date-range query includes a supplied profile', async () => {
    const query = vi.fn().mockResolvedValue({ Items: [] });
    await new BookingDynamoRepo({ query } as unknown as IDdb).listBookingsByDate('org', '2026-01-01', '2026-01-31', 'a');
    expect(query.mock.calls[0][0]).toMatchObject({ FilterExpression: 'businessProfileId = :profile', ExpressionAttributeValues: { ':profile': 'a' } });
});
