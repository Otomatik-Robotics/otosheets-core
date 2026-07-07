import { ClientOverviewPgRepo } from './repo.pg';

/**
 * Unlike the entity repos, the client-overview repo has no state-machine router:
 * it is a Postgres-only reporting projection (POSTGRES_MIGRATION_PLAN.md §8) with no
 * DynamoDB implementation to route to. The factory exists for call-site symmetry with
 * getInvoiceRepo() / getClientRepo() and to keep the singleton warm per Lambda container.
 */
let singleton: ClientOverviewPgRepo | null = null;

export function getClientOverviewRepo(): ClientOverviewPgRepo {
    if (!singleton) singleton = new ClientOverviewPgRepo();
    return singleton;
}
