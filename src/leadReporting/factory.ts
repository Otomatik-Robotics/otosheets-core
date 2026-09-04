import { LeadReportingPgRepo } from './repo.pg';

/**
 * No state-machine router: these are Postgres-only reporting projections with
 * no DynamoDB implementation to route to. The factory exists for call-site
 * symmetry with the entity repos and to keep the singleton warm per container.
 */
let singleton: LeadReportingPgRepo | null = null;

export function getLeadReportingRepo(): LeadReportingPgRepo {
    if (!singleton) singleton = new LeadReportingPgRepo();
    return singleton;
}
