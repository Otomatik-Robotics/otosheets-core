import { AdCampaignPgRepo } from './repo.pg';

/**
 * Like client-overview, the ad-campaign repo has no state-machine router: it is
 * a Postgres-only entity (POSTGRES_MIGRATION_PLAN.md §8 reporting-layer rule —
 * campaigns exist to be joined against leads + analytics_events) with no
 * DynamoDB implementation to route to. The factory keeps the singleton warm per
 * Lambda container and the call-site symmetric with getInvoiceRepo() et al.
 */
let singleton: AdCampaignPgRepo | null = null;

export function getAdCampaignRepo(): AdCampaignPgRepo {
    if (!singleton) singleton = new AdCampaignPgRepo();
    return singleton;
}
