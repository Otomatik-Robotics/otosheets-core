import { BasPeriodPgRepo } from './repo.pg';

/**
 * Postgres-only, no router (see asset/factory.ts). The factory keeps the
 * singleton warm per Lambda container and the call-site symmetric with the
 * entity repos.
 */
let singleton: BasPeriodPgRepo | null = null;

export function getBasPeriodRepo(): BasPeriodPgRepo {
    if (!singleton) singleton = new BasPeriodPgRepo();
    return singleton;
}
