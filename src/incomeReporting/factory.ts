import { IncomeReportingPgRepo } from './income.pg';

/**
 * No state-machine router: this is a Postgres-only reporting projection with
 * no DynamoDB implementation to route to (basReporting precedent). The factory
 * keeps the singleton warm per container.
 */
let singleton: IncomeReportingPgRepo | null = null;

export function getIncomeReportingRepo(): IncomeReportingPgRepo {
    if (!singleton) singleton = new IncomeReportingPgRepo();
    return singleton;
}
