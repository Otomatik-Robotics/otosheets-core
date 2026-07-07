import { BankAccountPgRepo } from './repo.pg';

/**
 * Bank accounts are a Postgres-only domain (open banking via Fiskil) with no
 * DynamoDB implementation to route to — the factory exists only for call-site
 * symmetry with getInvoiceRepo() / getClientRepo() and to keep the singleton
 * warm per Lambda container. Mirror of getClientOverviewRepo().
 */
let singleton: BankAccountPgRepo | null = null;

export function getBankAccountRepo(): BankAccountPgRepo {
    if (!singleton) singleton = new BankAccountPgRepo();
    return singleton;
}
