import { BankTransactionPgRepo } from './repo.pg';

/** Postgres-only domain — factory keeps the singleton warm per Lambda container
 *  and gives call-site symmetry with the routed repos. See getBankAccountRepo(). */
let singleton: BankTransactionPgRepo | null = null;

export function getBankTransactionRepo(): BankTransactionPgRepo {
    if (!singleton) singleton = new BankTransactionPgRepo();
    return singleton;
}
