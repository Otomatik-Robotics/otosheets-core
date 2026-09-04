import { AssetPgRepo } from './repo.pg';

/**
 * Like forms and ad-campaigns, the asset register has no state-machine
 * router: it is a Postgres-only entity (the reporting-layer rule — an asset
 * exists to be folded into a depreciation schedule and the BAS capital
 * figures) with no DynamoDB implementation to route to. The factory keeps the
 * singleton warm per Lambda container and the call-site symmetric with
 * getFormRepo() et al.
 */
let singleton: AssetPgRepo | null = null;

export function getAssetRepo(): AssetPgRepo {
    if (!singleton) singleton = new AssetPgRepo();
    return singleton;
}
