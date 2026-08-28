import { FormPgRepo } from './repo.pg';

/**
 * Like ad-campaign, the form repo has no state-machine router: it is a
 * Postgres-only entity (POSTGRES_MIGRATION_PLAN.md §8 reporting-layer rule —
 * submissions exist to be joined against leads and exported) with no DynamoDB
 * implementation to route to. The factory keeps the singleton warm per Lambda
 * container and the call-site symmetric with getAdCampaignRepo() et al.
 */
let singleton: FormPgRepo | null = null;

export function getFormRepo(): FormPgRepo {
    if (!singleton) singleton = new FormPgRepo();
    return singleton;
}
