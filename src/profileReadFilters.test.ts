import { expect, test, vi } from 'vitest';
import { InvoiceDynamoRepo } from './invoice/repo';
import { TripDynamoRepo } from './trip/repo';
import { LeadDynamoRepo } from './lead/repo';
import { ClientDynamoRepo } from './client/repo';
import { TimeEntryDynamoRepo } from './timeEntry/repo';
import type { IDdb } from './ddbPort';

/**
 * The aggregate reads the reports, analytics, home card and desk build on.
 * Each takes an optional business profile; when it is given, the Dynamo
 * route filters on it the same way the Postgres route does, so a second
 * profile in the same org never shows up in the first one's figures.
 */
const ddb = () => {
    const query = vi.fn().mockResolvedValue({ Items: [] });
    return { query, db: { query } as unknown as IDdb };
};
const scoped = (call: any) => {
    expect(call.FilterExpression).toContain('businessProfileId = :businessProfileId');
    expect(call.ExpressionAttributeValues[':businessProfileId']).toBe('prof_a');
};

test('invoice date, draft and overdue reads scope to the profile', async () => {
    const { query, db } = ddb();
    const repo = new InvoiceDynamoRepo(db);
    await repo.listInvoicesByDate('org', '2026-01-01', '2026-06-30', 'prof_a');
    await repo.listDraftInvoices('org', 'prof_a');
    await repo.listOverdueInvoices('org', '2026-09-12', 'prof_a');
    query.mock.calls.forEach(([call]) => scoped(call));
    await repo.listOverdueInvoices('org', '2026-09-12');
    expect(query.mock.calls[3][0].FilterExpression).not.toContain('businessProfileId');
});

test('trip, lead, client and time-entry reads scope to the profile', async () => {
    const { query, db } = ddb();
    await new TripDynamoRepo(db).listTripsByDate('org', '2026-01-01', '2026-06-30', 'prof_a');
    await new LeadDynamoRepo(db).listRecentLeads('org', '2026-09-01T00:00:00.000Z', 'prof_a');
    await new LeadDynamoRepo(db).listAllOrgLeads('org', 'prof_a');
    await new ClientDynamoRepo(db).getTopByUsage('org', 3, 'prof_a');
    await new TimeEntryDynamoRepo(db).listTimeEntries('org', 'user', { uninvoiced: true, businessProfileId: 'prof_a' });
    await new TimeEntryDynamoRepo(db).listOrgTimeEntriesPaginated({ orgId: 'org', businessProfileId: 'prof_a', limit: 5 });
    query.mock.calls.forEach(([call]) => scoped(call));
    expect(query.mock.calls[4][0].FilterExpression).toContain('attribute_not_exists(invoicedAt)');
});
