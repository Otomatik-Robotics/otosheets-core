import { BasReportingPgRepo } from './inputs.pg';

/**
 * No state-machine router: this is a Postgres-only reporting projection with
 * no DynamoDB implementation to route to (leadReporting precedent). The
 * factory keeps the singleton warm per container.
 */
let singleton: BasReportingPgRepo | null = null;

export function getBasReportingRepo(): BasReportingPgRepo {
    if (!singleton) singleton = new BasReportingPgRepo();
    return singleton;
}
